import { createDeepAgent, type DeepAgent } from "deepagents";
import { todoListMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import type { Provider } from "@/types";
import type { ContentPart } from "@/lib/llm";
import { buildSystemPrompt } from "@/lib/llm";
import { createChatModel } from "@/lib/agent/models";
import { buildAgentTools, type ToolProfile } from "@/lib/agent/tools";
import type { AgentSandbox } from "@/lib/agent/sandbox";
import { loadMcpTools, type McpToolsResult } from "@/lib/agent/mcp";
import { loadSkillFiles, type SkillFile } from "@/lib/agent/skills";
import type { RunContext } from "@/lib/agent/run-context";
import {
  resolveHistoryBudget,
  truncateMessagesToBudget,
} from "@/lib/agent/history";
import type {
  AgentEvent,
  AgentMode,
  StructuredInputRequest,
  TodoItem,
} from "@/lib/agent/types";

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
}

export interface AgentSessionOptions {
  provider: Provider;
  modelName: string;
  instructions?: string;
  mode: AgentMode;
  webFetchEnabled: boolean;
  projectDir?: string | null;
  /** "chat" (default) = chat tools; "task" = + run_command/run_coding_task (+ read_file/write_file with enableFileTools); "setup" = + create_agent. */
  toolProfile?: ToolProfile;
  /** Task profile: set false to withhold run_command/run_coding_task (sandboxed agents without terminal). */
  enableCommandTools?: boolean;
  /** Task profile: set true to add read_file/write_file (agents with the local-files capability). */
  enableFileTools?: boolean;
  /** Restrict loaded skills to these names (sandboxed agents). undefined = all installed. */
  skillNames?: string[];
  /** Restrict MCP connectors to these opencode.json config keys. undefined = all enabled; [] = none. */
  mcpNames?: string[];
  /** Saved-agent runs: identity + filesystem sandbox + chat-history access. */
  sandbox?: AgentSandbox;
}

const CORE_BEHAVIOR_PROMPT = `
You are a helpful assistant in a local chat app. Answer exactly what the user asked:
- Be concise and direct. No preamble ("Sure!", "Great question!") and no narration of what
  you are about to do — just do it.
- Do not append unsolicited offers ("If you'd like, I can also…") or follow-up menus.
  Give the answer; the user will ask for more if they want it.
- For simple questions and summaries, just answer — no tools, no todos, no artifacts.
`.trim();

const RICH_FORMAT_PROMPT = `
You can generate rich content inline in your markdown replies:
- Math and symbols: LaTeX via $inline$ and $$block$$ delimiters (KaTeX). LaTeX tables are supported.
- Diagrams: fenced \`\`\`mermaid blocks (flowcharts, sequence diagrams, gantt, …).
- Data charts: fenced \`\`\`chart blocks containing a Vega-Lite JSON spec (bar, line, scatter, pie, …).
- Vector images: fenced \`\`\`svg blocks with a complete <svg> element.
- Regular markdown tables, images, and formatted text as usual.

Side panel artifacts:
- For substantial code (python, html, jsx/react, javascript) or long markdown documents
  (research briefs, reports, plans), call create_artifact with the full content so the user
  gets an editable, runnable copy in the side panel. Do NOT repeat the content in your reply —
  instead write a brief 1-2 sentence summary of what you created and mention the user can
  view, edit, and download it.

Other tools:
- When you need specific structured parameters from the user (research topic and depth, a code
  task spec, document requirements), call request_structured_input with a short form instead of
  asking in prose.
- You can run Python on the user's machine with run_python to execute or verify code.
`.trim();

const SUGGESTIONS_PROMPT = `
Chat modes — the user can activate special modes by starting their message with a keyword:
- "discuss …"  → Discuss mode (a panel of agents deliberating, chairman synthesizes the answer)
- "teach me …" or "i want to learn …" → Learn mode (structured tutoring with a comprehension check)
- "research …" → Research mode (multi-round, search-driven cited report)
You can also suggest a mode to the user via the suggest tool when their request would clearly benefit from one.

Skills and connectors — proactive discovery:
- Installed skills are listed in the Skills System section above. But the user may not have the
  right skill installed yet. When the user's task might benefit from a capability they don't have
  (creating Word/Excel/PPT/PDF files, frontend design, testing, etc.), call search_skills first to
  find matching skills in the catalog. If one is found and not installed, call suggest with
  kind=skill to show an actionable install card.
- Similarly, when the user wants to interact with an external app (email, calendar, docs, project
  tracker, etc.) and no matching connector is connected, call search_connectors to find one. If a
  match is found and not connected, call suggest with kind=connector. For Google Workspace (Gmail,
  Google Calendar, Google Docs, Drive) and Microsoft 365 (Outlook, Excel, Word), the Zapier
  connector covers all of them — search for "gmail", "office", or "google" to find it.
- Never suggest something that is already installed or connected (the search results show status).
- After calling suggest, continue your reply naturally — the card is shown to the user automatically.

Agent mode — handing off hands-on work:
- When the conversation clearly turns into a task the Agents tab handles better — running terminal
  commands, editing local files, multi-step local execution, or producing a deliverable that needs
  tools the chat doesn't have — call suggest with kind=agent_mode and target="task". The card moves
  this conversation to the Agents tab with its full history. Only suggest this once per
  conversation, and never when you can already complete the request yourself.
`.trim();

const TASK_MANAGER_PROMPT = `
You are a task manager agent running locally on the user's Mac. You plan and execute tasks
end-to-end with your tools, and you have access to the user's computer.

Working style:
- Plan first with write_todos, then execute step by step, keeping the list updated.
- Spawn subagents with the task tool for independent research or verification work — in parallel
  when the steps don't depend on each other — and synthesize their reports.
- Use web_search / web_fetch for anything current or external. Read installed skills under
  /skills/ when a task matches one.
- When a task would benefit from a skill or connector the user doesn't have yet, find it with
  search_skills / search_connectors and propose it with the suggest tool.
- Connected external apps are available as mcp__… tools.
- Be transparent: say what you are about to do, and report what you did.
`.trim();

const TASK_COMMAND_TOOLS_PROMPT = `
Local execution:
- run_command executes shell commands on the user's machine (login shell, their PATH). Use it for
  file operations, git, builds, tests, system inspection — anything a terminal can do. Prefer
  short, safe, targeted commands, and explain why each is needed. The user approves commands
  depending on their settings; if one is denied, don't retry it.
- run_python runs Python for calculations and data processing.

Coding tasks:
- NEVER write application code files yourself for real coding work. Delegate to the coding agent
  with run_coding_task: it runs opencode (a local coding agent) inside a project folder and
  returns its summary and diff.
- ALWAYS confirm the project folder with the user via request_structured_input (use a 'directory'
  field so they get a folder picker) before the first run_coding_task in a task, then reuse that
  folder.
- Quick explanations or tiny snippets are fine to answer directly.
`.trim();

const TASK_FILE_TOOLS_PROMPT = `
Local files:
- read_file reads a file from the user's Mac — text files directly, PDFs as extracted text, and a
  folder path as a listing. Use it whenever the user points you at a local document or folder
  (e.g. a report, paper, or project directory).
- write_file creates or overwrites a file with the full content. When editing an existing file,
  read it first, then write the complete new content.
- The user approves every file access with an approve/deny card; if one is denied, don't retry —
  ask what to do instead.
`.trim();

/**
 * Sandbox + self-configuration section for saved-agent runs: where the agent
 * may work on disk, and how it can change its own settings via chat.
 */
function buildAgentSandboxPrompt(sandbox: AgentSandbox): string {
  const dirs = (sandbox.allowedDirectories ?? []).filter(Boolean);
  const workspace = sandbox.workspace;
  const folders = workspace ? dirs.filter((d) => d !== workspace) : dirs;
  const lines: string[] = [
    `Your sandbox and configuration (your agent id: ${sandbox.agentId}):`,
  ];
  if (workspace) {
    lines.push(
      `- Private workspace: ${workspace} — your own persistent folder on the user's Mac. ` +
        "You can always read and write files there; use it for your notes and deliverables.",
    );
  }
  if (folders.length > 0) {
    lines.push(
      `- Allowed folders (read_file / write_file / run_coding_task): ${folders.join(", ")}`,
    );
  } else {
    lines.push(
      "- No extra folders granted yet. If you need to work on a codebase or read documents " +
        "outside your workspace, ask the user to add the folder in your agent settings (Permissions).",
    );
  }
  lines.push(
    "- Every local action (file access, shell command) still shows the user an approve/deny card.",
    "- Self-configuration: when the user asks you to change your own setup by chatting " +
      "(instructions, purpose, model, skills, connectors, terminal/web/files/read-chats " +
      "permissions), call update_agent with only the fields that change. When you merely think " +
      "a change would help, propose it with suggest (kind=agent_config + agent_patch) so the " +
      "user can apply it with one click. Folder, project, and knowledge-file access is " +
      "user-only — never claim to change it yourself.",
  );
  return lines.join("\n");
}

const AGENT_BUILDER_PROMPT = `
You are the agent builder. The user just clicked "New agent" and this chat sets up a new
persistent, sandboxed agent.

Your job — interview the user, then create the agent:
1. Find out what the user wants the agent to do. Ask short follow-up questions with
   request_structured_input forms (2-4 fields, simple language). If their first message is
   already specific, confirm the scope in one form instead of interrogating them.
2. Suggest add-ons: call search_skills and search_connectors for capabilities that match the
   purpose, and show the best matches with suggest cards. Never suggest anything already
   installed or connected.
3. Final form: confirm the agent's name (suggest 2-3 good names), the skills/connectors to
   include, and whether it needs local file access (read_file/write_file on the user's Mac,
   each access user-approved) and terminal/command access.
4. Call create_agent exactly once with the agreed definition, then confirm to the user that the
   agent is ready and that they can start sessions with it from the sidebar (Agents).

The created agent is focused and self-contained: it runs only on its own system prompt, the
skills and connectors chosen here, and the tools it needs. It does not share the user's
universal memory.
`.trim();

function buildAgentSystemPrompt(opts: AgentSessionOptions): string {
  const parts: string[] = [];
  if (opts.toolProfile === "task") {
    // Agent-mode runs are deliberately isolated from the user's global
    // settings/memory: they run on the task/agent prompt below plus whatever
    // instructions the caller passes (the saved agent's own system prompt).
    parts.push(TASK_MANAGER_PROMPT);
    if (opts.enableCommandTools !== false) {
      parts.push(TASK_COMMAND_TOOLS_PROMPT);
    }
    if (opts.enableFileTools) {
      parts.push(TASK_FILE_TOOLS_PROMPT);
    }
    if (opts.sandbox?.agentId) {
      parts.push(buildAgentSandboxPrompt(opts.sandbox));
    }
    if (opts.instructions) parts.push(opts.instructions);
  } else {
    parts.push(CORE_BEHAVIOR_PROMPT);
    if (opts.toolProfile === "setup") parts.push(AGENT_BUILDER_PROMPT);
    const base = buildSystemPrompt(opts.instructions);
    if (base) parts.push(base);
  }
  parts.push(RICH_FORMAT_PROMPT);
  if (opts.toolProfile !== "task") parts.push(SUGGESTIONS_PROMPT);
  return parts.join("\n\n");
}

function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t): TodoItem => ({
      content: typeof t.content === "string" ? t.content : String(t.content ?? ""),
      status:
        t.status === "completed" || t.status === "in_progress"
          ? t.status
          : "pending",
    }))
    .filter((t) => t.content);
}

function toLangChainMessages(
  messages: AgentMessage[],
): Array<{ role: string; content: unknown }> {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    const blocks = m.content.map((part) =>
      part.type === "image_url"
        ? { type: "image_url", image_url: { url: part.image_url?.url ?? "", detail: part.image_url?.detail } }
        : { type: "text", text: part.text ?? "" },
    );
    return { role: m.role, content: blocks };
  });
}

export interface StreamOutcome {
  interrupted: boolean;
  inputRequest?: StructuredInputRequest;
}

const BUILTIN_SKILL_CONTENT = `---
name: web-research
description: When to use web_search and web_fetch tools for live/external information.
---
## Web Research — always use tools for live facts

If the question needs **current, external, or factual** information that you don't already know
with certainty (prices, news, documentation, policies, statistics, recent events):
1. Call **web_search** with a concise query (1–3 queries, broad → narrow).
2. From the results, pick the 1–3 most authoritative URLs (official docs, papers, reputable sources).
3. Call **web_fetch** on each to read the full content.
4. Cross-check key claims across at least two independent sources when possible.

**Never** answer a live-fact question from memory alone — always search first.
**Never** narrate research attempts in prose without actually making the tool calls.
If a source blocks the fetch, returns junk, or is unhelpful, **try a different source** — don't
give up or repeat the failed approach. Only state you couldn't find something after genuinely
trying multiple sources via the tools.`;

/**
 * Merges installed skill files with a built-in web-research skill that is
 * always present (no installation required), so the agent always has search
 * guidance even when the user has zero skills installed.
 */
function withBuiltinSkill(
  skillFiles: Record<string, SkillFile>,
): Record<string, SkillFile> {
  const now = new Date().toISOString();
  return {
    ...skillFiles,
    "/skills/web-research/SKILL.md": {
      content: BUILTIN_SKILL_CONTENT.split("\n"),
      created_at: now,
      modified_at: now,
    },
  };
}

/**
 * Derive a short label for an inline activity chip from the tool name + args.
 */
function toolCallLabel(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const args = input as Record<string, unknown>;
  if (name === "web_search" && typeof args.query === "string") {
    return `Searching "${args.query.slice(0, 60)}"`;
  }
  if (name === "web_fetch" && typeof args.url === "string") {
    try {
      const host = new URL(args.url).host;
      return `Fetching ${host}`;
    } catch {
      return `Fetching ${String(args.url).slice(0, 60)}`;
    }
  }
  if (name === "run_python") return "Running Python";
  if (name === "create_artifact" && typeof args.title === "string") {
    return `Creating "${args.title.slice(0, 40)}"`;
  }
  return undefined;
}

/**
 * One deep-agent conversation run. A fresh thread is used per user send
 * (history is replayed from the message tree).
 */
export class DeepAgentSession {
  private constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private agent: DeepAgent<any>,
    private threadId: string,
    private skillFiles: Record<string, SkillFile>,
    private historyBudget: number,
    private mcp: McpToolsResult,
    private runCtx: { current: RunContext | null } = { current: null },
  ) {}

  static async create(opts: AgentSessionOptions): Promise<DeepAgentSession> {
    const model = await createChatModel(opts.provider, opts.modelName);
    const mcp = await loadMcpTools(opts.projectDir, opts.mcpNames);
    let skillFiles = await loadSkillFiles(opts.projectDir);
    if (opts.skillNames) {
      // Sandboxed agents only see the skills chosen at setup time.
      const allowed = new Set(opts.skillNames);
      skillFiles = Object.fromEntries(
        Object.entries(skillFiles).filter(([path]) => {
          const m = path.match(/^\/skills\/([^/]+)\/SKILL\.md$/);
          return !m || allowed.has(m[1]);
        }),
      );
    }
    skillFiles = withBuiltinSkill(skillFiles);
    const historyBudget = await resolveHistoryBudget(opts.provider, opts.modelName);

    const runCtx: { current: RunContext | null } = { current: null };
    const profile = opts.toolProfile ?? "chat";
    let tools = buildAgentTools(
      opts.webFetchEnabled,
      () => runCtx.current,
      profile,
      opts.enableFileTools ?? false,
      opts.sandbox,
    );
    if (profile === "task" && opts.enableCommandTools === false) {
      tools = tools.filter((t) => t.name !== "run_command" && t.name !== "run_coding_task");
    }

    const agent = await createDeepAgent({
      model,
      tools: [...tools, ...mcp.tools],
      systemPrompt: buildAgentSystemPrompt(opts),
      middleware: [todoListMiddleware()],
      skills: ["/skills/"],
      checkpointer: new MemorySaver(),
      name: profile === "chat" ? "chatui-assistant" : `chatui-${profile}`,
    });

    return new DeepAgentSession(agent, crypto.randomUUID(), skillFiles, historyBudget, mcp, runCtx);
  }

  /** Close MCP clients opened for this session. */
  async dispose(): Promise<void> {
    await this.mcp.dispose();
  }

  firstInput(messages: AgentMessage[]): Record<string, unknown> {
    return {
      messages: toLangChainMessages(
        truncateMessagesToBudget(messages, this.historyBudget),
      ),
      files: this.skillFiles,
    };
  }

  async stream(
    input: unknown,
    emit: (event: AgentEvent) => void,
    signal?: AbortSignal,
    requestInput?: RunContext["requestInput"],
    requestApproval?: RunContext["requestApproval"],
  ): Promise<StreamOutcome> {
    this.runCtx.current = { emit, requestInput, requestApproval };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const run = await (this.agent as any).streamEvents(input, {
        version: "v3",
        configurable: { thread_id: this.threadId },
        signal,
      });

      const consumeMessages = (async () => {
        for await (const msg of run.messages) {
          await Promise.all([
            (async () => {
              for await (const token of msg.text) {
                emit({ type: "token", text: token });
              }
            })(),
            (async () => {
              for await (const token of msg.reasoning) {
                emit({ type: "reasoning", text: token });
              }
            })(),
          ]);
        }
      })();

      const consumeToolCalls = (async () => {
        for await (const call of run.toolCalls) {
          const id = `tool-${call.callId || call.name}-${Date.now()}`;
          const label = toolCallLabel(call.name, call.input);
          emit({
            type: "activity",
            activity: {
              id,
              kind: "tool",
              name: call.name,
              status: "running",
              label,
            },
          });
          void call.status.then(async (status: "running" | "finished" | "error") => {
            let detail: string | undefined;
            if (status === "finished") {
              try {
                const out = await call.output;
                detail = (typeof out === "string" ? out : JSON.stringify(out))?.slice(0, 300);
              } catch {
                // no detail
              }
            } else {
              detail = await call.error.catch(() => undefined);
            }
            emit({
              type: "activity",
              activity: {
                id,
                kind: "tool",
                name: call.name,
                status: status === "finished" ? "done" : "error",
                detail,
                label,
              },
            });
          });
        }
      })();

      const consumeSubagents = (async () => {
        for await (const sub of run.subagents) {
          const id = `sub-${sub.name}-${Date.now()}`;
          emit({
            type: "activity",
            activity: { id, kind: "subagent", name: sub.name, status: "running" },
          });
          void sub.output
            .then(() =>
              emit({
                type: "activity",
                activity: { id, kind: "subagent", name: sub.name, status: "done" },
              }),
            )
            .catch(() =>
              emit({
                type: "activity",
                activity: { id, kind: "subagent", name: sub.name, status: "error" },
              }),
            );
        }
      })();

      const consumeValues = (async () => {
        for await (const snapshot of run.values) {
          const todos = (snapshot as { todos?: unknown }).todos;
          if (todos !== undefined) {
            emit({ type: "todos", todos: normalizeTodos(todos) });
          }
        }
      })();

      const settled = await Promise.allSettled([
        consumeMessages,
        consumeToolCalls,
        consumeSubagents,
        consumeValues,
      ]);

      let streamError: unknown;
      for (const r of settled) {
        if (r.status === "rejected") {
          streamError = r.reason;
          break;
        }
      }

      try {
        await run.output;
      } catch (err) {
        streamError ??= err;
      }

      // Surface failures instead of silently returning an empty run —
      // the caller's catch turns this into a visible error toast.
      if (streamError && !signal?.aborted) {
        throw streamError;
      }

      return { interrupted: false };
    } finally {
      this.runCtx.current = null;
    }
  }
}
