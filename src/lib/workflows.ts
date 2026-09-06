import type { AgentWorkflow, WorkflowStep } from "@/types";

// Linear agent workflows (step chains) — localStorage-backed, same pattern as
// schedules.ts. The headless runner (headless-run.ts) executes steps in order;
// each step's prompt may reference the previous step's output via {{previous}}.

const STORAGE_KEY = "chatui:workflows";
const WORKFLOWS_EVENT = "chatui:workflows-changed";

export function loadWorkflows(): AgentWorkflow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as AgentWorkflow[];
    if (!Array.isArray(data)) return [];
    return data.filter(
      (w) => w && typeof w.id === "string" && Array.isArray(w.steps),
    );
  } catch {
    return [];
  }
}

function persistWorkflows(workflows: AgentWorkflow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
  window.dispatchEvent(new Event(WORKFLOWS_EVENT));
}

export function saveWorkflow(def: Omit<AgentWorkflow, "createdAt"> & { createdAt?: string }): AgentWorkflow {
  const workflows = loadWorkflows();
  const existing = workflows.find((w) => w.id === def.id);
  if (existing) {
    const next: AgentWorkflow = { ...existing, ...def, id: existing.id, createdAt: existing.createdAt };
    persistWorkflows(workflows.map((w) => (w.id === existing.id ? next : w)));
    return next;
  }
  const full: AgentWorkflow = { ...def, id: def.id || crypto.randomUUID(), createdAt: new Date().toISOString() };
  persistWorkflows([full, ...workflows]);
  return full;
}

export function deleteWorkflow(id: string) {
  persistWorkflows(loadWorkflows().filter((w) => w.id !== id));
}

export function subscribeToWorkflows(fn: () => void): () => void {
  window.addEventListener(WORKFLOWS_EVENT, fn);
  return () => window.removeEventListener(WORKFLOWS_EVENT, fn);
}

export const PREVIOUS_PLACEHOLDER = "{{previous}}";

/**
 * A step's final prompt: `{{previous}}` (all occurrences) replaced with the
 * prior step's output. Pure — unit-testable.
 */
export function renderStepPrompt(step: WorkflowStep, previousOutput: string | null): string {
  if (!previousOutput) {
    return step.prompt.split(PREVIOUS_PLACEHOLDER).join("");
  }
  return step.prompt.split(PREVIOUS_PLACEHOLDER).join(previousOutput);
}
