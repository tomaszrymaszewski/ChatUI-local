import type { AgentDefinition } from "@/types";

// Saved agents (created via the agent builder) — localStorage-backed, same
// pattern as sessions/settings. The use-agents hook mirrors this storage into
// React state via the AGENTS_EVENT notification.

const STORAGE_KEY = "chatui:agents";
const AGENTS_EVENT = "chatui:agents-changed";

export function loadAgentDefinitions(): AgentDefinition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as AgentDefinition[];
    if (!Array.isArray(data)) return [];
    return data.filter(
      (a) => a && typeof a.id === "string" && typeof a.name === "string",
    );
  } catch {
    return [];
  }
}

function persistAgents(agents: AgentDefinition[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  window.dispatchEvent(new Event(AGENTS_EVENT));
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
