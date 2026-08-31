import type { Artifact } from "@/lib/artifacts";

export type ActivityKind = "tool" | "subagent" | "todo" | "input" | "source";
export type ActivityStatus = "running" | "done" | "error";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  name: string;
  status: ActivityStatus;
  detail?: string;
  /** Character offset into the assistant content at the moment the action started — used to interleave activities inline with the markdown. */
  textOffset?: number;
  /** Short human label shown in the inline chip, e.g. 'Searching "X"…'. */
  label?: string;
  /** For source activities: the URL to open when clicked. */
  url?: string;
  /** For source activities: the page/site title shown in the tooltip. */
  title?: string;
  /** Groups this activity (tool call, source) inside a parent sub-agent box. */
  parentId?: string;
  /** Final output text of a sub-agent, rendered inside its box. */
  output?: string;
  /** Monotonic creation order shared with reasoning streams — used to interleave
   *  thoughts and sub-agent boxes chronologically. Absent on legacy messages. */
  seq?: number;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface StructuredInputField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "checkbox" | "directory";
  description?: string;
  options?: string[];
  required?: boolean;
  default?: string | number | boolean;
}

export interface StructuredInputRequest {
  title: string;
  description?: string;
  fields: StructuredInputField[];
  submitLabel?: string;
}

export interface SuggestionRequest {
  kind: "skill" | "connector" | "mode";
  /** Skill name, connector id, or mode name (council/learn/research). */
  target: string;
  /** Short headline shown on the card. */
  title: string;
  /** 1–2 sentence explanation of why this is being suggested. */
  reason: string;
}

/** A local action (shell command / file access / coding-agent permission) awaiting user approval. */
export interface ApprovalRequest {
  /** What wants to run: the shell command, the file path, or a human-readable description. */
  command: string;
  /** Working directory, when the action is scoped to one. */
  cwd?: string;
  /** Where the request came from: "run_command", "local_file", or "opencode". */
  source: string;
  /** For local_file requests: whether the agent wants to read or write. */
  action?: "read" | "write";
  /** Why the agent wants to run it (its own one-liner). */
  reason?: string;
}

export type AgentMode = "chat" | "council" | "research" | "task";

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string; id?: string; label?: string }
  | { type: "activity"; activity: ActivityItem }
  | { type: "todos"; todos: TodoItem[] }
  | { type: "artifact"; artifact: Artifact }
  | { type: "suggestion"; suggestion: SuggestionRequest };

export interface ReasoningStream {
  id: string;
  label: string;
  text: string;
  ms?: number;
  /** Monotonic creation order shared with activities — used to interleave
   *  thoughts and sub-agent boxes chronologically. Absent on legacy messages. */
  seq?: number;
}

export interface AgentRunResult {
  content: string;
  reasoning: string;
  reasoningMs?: number;
  reasoningStreams?: ReasoningStream[];
  cancelled: boolean;
  interrupted: boolean;
  activities: ActivityItem[];
  todos: TodoItem[];
  artifacts: Artifact[];
  /** For research/council modes: whether the pipeline ran to full completion.
   * False when the run ended early (clarification cancelled or aborted).
   * Chat mode leaves this unset (treated as complete). */
  completed?: boolean;
}
