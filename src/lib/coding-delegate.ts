import { invoke } from "@tauri-apps/api/core";
import { runCommand } from "@/lib/run-command";

/**
 * Coding-task delegation to whichever local coding agent the user has
 * installed (OpenCode, Claude Code, Codex — detected on the user's PATH).
 * Each agent runs headlessly in the target project folder via its own CLI;
 * when none is installed the manager agent handles the task itself with its
 * own file and shell tools (see run_coding_task in src/lib/agent/tools.ts).
 */

export interface CodingAgentInfo {
  id: string;
  name: string;
  path: string;
}

export async function detectCodingAgents(): Promise<CodingAgentInfo[]> {
  try {
    const agents = await invoke<CodingAgentInfo[]>("detect_coding_agents");
    return Array.isArray(agents) ? agents : [];
  } catch {
    return [];
  }
}

/** Pure pick of the delegation backend from the detected agents. */
export type CodingAgentChoice =
  | { status: "ok"; agent: CodingAgentInfo }
  | { status: "none" }
  | { status: "ask"; options: CodingAgentInfo[] }
  | { status: "missing"; requested: string };

export function resolveCodingAgent(
  available: CodingAgentInfo[],
  requested?: string,
): CodingAgentChoice {
  if (requested) {
    const agent = available.find((a) => a.id === requested);
    return agent ? { status: "ok", agent } : { status: "missing", requested };
  }
  if (available.length === 0) return { status: "none" };
  if (available.length === 1) return { status: "ok", agent: available[0] };
  return { status: "ask", options: available };
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Headless CLI invocation per coding agent. */
export function codingAgentCommand(id: string, prompt: string): string {
  const quoted = shellQuote(prompt);
  switch (id) {
    case "claude":
      return `claude -p ${quoted} --permission-mode acceptEdits --output-format text`;
    case "codex":
      return `codex exec ${quoted}`;
    case "opencode":
    default:
      return `opencode run ${quoted}`;
  }
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface CodingTaskOptions {
  prompt: string;
  /** Absolute path of the project folder the coding agent works in. */
  directory: string;
  /** Detected agent to delegate to (from resolveCodingAgent). */
  agentId: string;
  timeoutMs?: number;
}

export interface CodingTaskResult {
  /** The coding agent's final output (stdout, falling back to stderr). */
  summary: string;
  timedOut: boolean;
  exitCode: number;
}

export async function runCodingTaskWithAgent(
  opts: CodingTaskOptions,
): Promise<CodingTaskResult> {
  const command = codingAgentCommand(opts.agentId, opts.prompt);
  const result = await runCommand(command, opts.directory, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  // Some CLIs print progress to stderr; prefer real output, fall back to it.
  const summary = stdout || stderr || "(no output)";
  return { summary, timedOut: result.timedOut, exitCode: result.exitCode };
}
