import type { AgentEvent, ApprovalRequest, StructuredInputRequest } from "@/lib/agent/types";

/**
 * Single active agent run context. The app only ever runs one generation at a
 * time, so tools (create_artifact, request_structured_input, …) reach the UI
 * through this module instead of threading callbacks through LangChain internals.
 */
export interface RunContext {
  emit: (event: AgentEvent) => void;
  /** Pause the tool until the user fills (or skips) a structured-input form. */
  requestInput?: (
    request: StructuredInputRequest,
  ) => Promise<{ cancelled: true } | { values: Record<string, unknown> }>;
  /** Pause the tool until the user approves (or denies) a local action. */
  requestApproval?: (request: ApprovalRequest) => Promise<{ approved: boolean }>;
}

let current: RunContext | null = null;

export function setRunContext(ctx: RunContext | null) {
  current = ctx;
}

export function getRunContext(): RunContext | null {
  return current;
}

/**
 * Doc ids auto-injected into the current run's instructions by pre-prompt
 * retrieval. search_knowledge excludes them so the agent can always dig
 * broader than what it was handed. Module-level (not on RunContext) because
 * only one generation runs at a time — same reason as RunContext itself.
 */
let currentRetrievedDocIds: string[] = [];

export function setRetrievedDocIds(ids: string[]) {
  currentRetrievedDocIds = ids;
}

export function getRetrievedDocIds(): string[] {
  return currentRetrievedDocIds;
}
