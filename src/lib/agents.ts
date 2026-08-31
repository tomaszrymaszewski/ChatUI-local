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

export function subscribeToAgents(fn: () => void): () => void {
  window.addEventListener(AGENTS_EVENT, fn);
  return () => window.removeEventListener(AGENTS_EVENT, fn);
}
