import type { AgentAvatarShape, AgentDefinition } from "@/types";
import { setItemOrThrowFriendly } from "./storage-pressure";
import { invoke } from "@tauri-apps/api/core";
import { chatUiBaseDir, remapLegacyChatUiPath } from "@/lib/agent/sandbox";

// Saved agents (created via the agent builder) — localStorage-backed, same
// pattern as sessions/settings. The use-agents hook mirrors this storage into
// React state via the AGENTS_EVENT notification.

const STORAGE_KEY = "chatui:agents";
const AGENTS_EVENT = "chatui:agents-changed";
const PATHS_REMAPPED_KEY = "chatui:agents:paths-remapped";
const COMPUTER_USE_MIGRATED_KEY = "chatui:agents:computer-use-migrated";

/** Palette the agent face avatars draw from (see AgentAvatar). */
export const AGENT_FACE_COLORS = [
  "#f87171",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#2dd4bf",
  "#38bdf8",
  "#818cf8",
  "#c084fc",
  "#f472b6",
  "#e879f9",
];

export const AGENT_AVATAR_SHAPES: AgentAvatarShape[] = [
  "circle",
  "rounded-square",
  "inverted-rounded-triangle",
  "rounded-star",
  "rounded-hexagon",
];

export const AGENT_AVATAR_SHAPE_LABELS: Record<AgentAvatarShape, string> = {
  circle: "Circle",
  "rounded-square": "Rounded square",
  "inverted-rounded-triangle": "Inverted rounded triangle",
  "rounded-star": "Rounded star",
  "rounded-hexagon": "Rounded hexagon",
};

/**
 * Pick a face color no existing agent uses, so every agent is visually
 * distinct at creation. When the palette is exhausted (>10 agents), the
 * least-used color wins so duplicates spread out.
 */
function pickAgentColor(agents: AgentDefinition[]): string {
  const used = new Map<string, number>();
  for (const a of agents) {
    if (a.color) used.set(a.color, (used.get(a.color) ?? 0) + 1);
  }
  const free = AGENT_FACE_COLORS.filter((c) => !used.has(c));
  const pool =
    free.length > 0
      ? free
      : AGENT_FACE_COLORS.filter(
          (c) => (used.get(c) ?? 0) === Math.min(...AGENT_FACE_COLORS.map((x) => used.get(x) ?? 0)),
        );
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickAgentShape(agents: AgentDefinition[]): AgentAvatarShape {
  const used = new Map<AgentAvatarShape, number>();
  for (const agent of agents) {
    if (agent.shape && AGENT_AVATAR_SHAPES.includes(agent.shape)) {
      used.set(agent.shape, (used.get(agent.shape) ?? 0) + 1);
    }
  }
  const leastUsed = Math.min(...AGENT_AVATAR_SHAPES.map((shape) => used.get(shape) ?? 0));
  const pool = AGENT_AVATAR_SHAPES.filter((shape) => (used.get(shape) ?? 0) === leastUsed);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * The agent's stored face color, assigning (and persisting + syncing) one for
 * agents created before colors existed. Idempotent; safe to call repeatedly.
 */
export function ensureAgentColor(id: string): string {
  const agents = loadAgentDefinitions();
  const found = agents.find((a) => a.id === id);
  if (found?.color) return found.color;
  const color = pickAgentColor(agents);
  if (found) updateAgentDefinition(id, { color });
  return color;
}

/** Assign and persist a stable shape for agents created before shape support. */
export function ensureAgentShape(id: string): AgentAvatarShape {
  const agents = loadAgentDefinitions();
  const found = agents.find((agent) => agent.id === id);
  if (found?.shape && AGENT_AVATAR_SHAPES.includes(found.shape)) return found.shape;
  const shape = pickAgentShape(agents);
  if (found) updateAgentDefinition(id, { shape });
  return shape;
}

/** The agent's stored face color, or undefined when the id is unknown. */
export function agentColor(id: string): string | undefined {
  return loadAgentDefinitions().find((a) => a.id === id)?.color;
}

export function loadAgentDefinitions(): AgentDefinition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as AgentDefinition[];
    if (!Array.isArray(data)) return [];
    const valid = data.filter(
      (a) => a && typeof a.id === "string" && typeof a.name === "string",
    );
    // One-time migration: "read past chats" used to grant access to every
    // session. After the own/external split, legacy agents keep that reach
    // by upgrading to externalChats: "all" (users can narrow it per agent).
    // Records saved before updatedAt existed backfill it from createdAt so
    // cloud-sync merges can order them.
    let migrated = false;
    // The computerUse rollout runs once (flag-guarded): false was the reserved
    // default before browser automation shipped, so flipping it on every load
    // would also re-enable agents the user deliberately turned off afterwards.
    const migrateComputerUse = !localStorage.getItem(COMPUTER_USE_MIGRATED_KEY);
    const next = valid.map((a) => {
      let rec = a;
      if ((a as AgentDefinition).readChats && a.externalChats === undefined) {
        migrated = true;
        rec = { ...rec, externalChats: "all" as const };
      }
      if (typeof (rec as Partial<AgentDefinition>).updatedAt !== "string") {
        migrated = true;
        rec = { ...rec, updatedAt: rec.createdAt };
      }
      // computerUse was reserved but had no effect before browser automation
      // shipped. Enable the isolated browser for existing agents; users can
      // turn it off in the access settings.
      if (migrateComputerUse && rec.capabilities && !rec.capabilities.computerUse) {
        migrated = true;
        rec = { ...rec, capabilities: { ...rec.capabilities, computerUse: true } };
      }
      return rec;
    });
    if (migrated) persistAgents(next);
    if (migrateComputerUse) localStorage.setItem(COMPUTER_USE_MIGRATED_KEY, "1");
    void remapLegacySandboxFolders();
    return next;
  } catch {
    return [];
  }
}

function persistAgents(agents: AgentDefinition[]) {
  setItemOrThrowFriendly(STORAGE_KEY, JSON.stringify(agents));
  window.dispatchEvent(new Event(AGENTS_EVENT));
}

/**
 * One-time remap of stored sandbox allowlist folders after the app moved its
 * data out of ~/Documents/chatUI into the OS app-data dir: granted folders
 * pointing into the old base would silently fall outside every sandbox.
 * Idempotent; guarded by a localStorage flag so it parses once.
 */
async function remapLegacySandboxFolders(): Promise<void> {
  if (localStorage.getItem(PATHS_REMAPPED_KEY)) return;
  try {
    const base = await chatUiBaseDir();
    if (!base) return;
    const home = await invoke<string>("get_home_dir").catch(() => null);
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as AgentDefinition[];
    let changed = false;
    const next = (Array.isArray(data) ? data : []).map((a) => {
      const allowed = a.allowedFolders;
      if (!allowed?.length) return a;
      const remapped = allowed.map((f) => remapLegacyChatUiPath(f, home, base));
      if (remapped.some((f, i) => f !== allowed[i])) {
        changed = true;
        return { ...a, allowedFolders: remapped };
      }
      return a;
    });
    localStorage.setItem(PATHS_REMAPPED_KEY, "1");
    if (changed) persistAgents(next);
  } catch {
    // best effort — retried on the next load while the flag is unset
  }
}

export function saveAgentDefinition(
  def: Omit<AgentDefinition, "id" | "createdAt" | "updatedAt">,
): AgentDefinition {
  const agents = loadAgentDefinitions();
  const now = new Date().toISOString();
  const full: AgentDefinition = {
    ...def,
    // Distinct face color per agent, chosen at creation (callers may pin one).
    color: def.color ?? pickAgentColor(agents),
    shape: def.shape ?? pickAgentShape(agents),
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  persistAgents([full, ...agents]);
  return full;
}

export function deleteAgentDefinition(id: string) {
  persistAgents(loadAgentDefinitions().filter((a) => a.id !== id));
}

/** Fields callers may patch on a saved agent (identity/config only). */
export type AgentUpdatePatch = Partial<
  Omit<AgentDefinition, "id" | "createdAt" | "updatedAt" | "capabilities">
> & {
  /** Merged into the existing capabilities (partial allowed). */
  capabilities?: Partial<AgentDefinition["capabilities"]>;
};

/**
 * Update a saved agent in place. Returns the updated definition, or null when
 * the id is unknown. Fires the change event so sidebars/dialogs re-render.
 */
export function updateAgentDefinition(
  id: string,
  patch: AgentUpdatePatch,
): AgentDefinition | null {
  const agents = loadAgentDefinitions();
  const idx = agents.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const prev = agents[idx];
  const next: AgentDefinition = {
    ...prev,
    ...patch,
    // Never let a patch move or recreate the record (updatedAt always stamps
    // now so cloud-sync merges order edits — a forged stamp is overwritten).
    id: prev.id,
    createdAt: prev.createdAt,
    updatedAt: new Date().toISOString(),
    capabilities: { ...prev.capabilities, ...(patch.capabilities ?? {}) },
  };
  agents[idx] = next;
  persistAgents(agents);
  return next;
}

export function subscribeToAgents(fn: () => void): () => void {
  window.addEventListener(AGENTS_EVENT, fn);
  return () => window.removeEventListener(AGENTS_EVENT, fn);
}
