import type { AgentDefinition } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { chatUiBaseDir, remapLegacyChatUiPath } from "@/lib/agent/sandbox";

// Saved agents (created via the agent builder) — localStorage-backed, same
// pattern as sessions/settings. The use-agents hook mirrors this storage into
// React state via the AGENTS_EVENT notification.

const STORAGE_KEY = "chatui:agents";
const AGENTS_EVENT = "chatui:agents-changed";
const PATHS_REMAPPED_KEY = "chatui:agents:paths-remapped";

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
    let migrated = false;
    const next = valid.map((a) => {
      if ((a as AgentDefinition).readChats && a.externalChats === undefined) {
        migrated = true;
        return { ...a, externalChats: "all" as const };
      }
      return a;
    });
    if (migrated) persistAgents(next);
    void remapLegacySandboxFolders();
    return next;
  } catch {
    return [];
  }
}

function persistAgents(agents: AgentDefinition[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
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
  def: Omit<AgentDefinition, "id" | "createdAt">,
): AgentDefinition {
  const agents = loadAgentDefinitions();
  const full: AgentDefinition = {
    ...def,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  persistAgents([full, ...agents]);
  return full;
}

export function deleteAgentDefinition(id: string) {
  persistAgents(loadAgentDefinitions().filter((a) => a.id !== id));
}

/** Fields callers may patch on a saved agent (identity/config only). */
export type AgentUpdatePatch = Partial<
  Omit<AgentDefinition, "id" | "createdAt" | "capabilities">
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
    // Never let a patch move or recreate the record.
    id: prev.id,
    createdAt: prev.createdAt,
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
