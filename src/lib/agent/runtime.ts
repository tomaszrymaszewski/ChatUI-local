import { createDeepAgent, type DeepAgent } from "deepagents";
import { todoListMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import type { Provider } from "@/types";
import type { ContentPart } from "@/lib/llm";
import { buildSystemPrompt } from "@/lib/llm";
import { createChatModel } from "@/lib/agent/models";
import { buildAgentTools } from "@/lib/agent/tools";
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
}

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

 Working style:
- For multi-step tasks, use write_todos to plan and keep the todo list updated as you progress.
- For work that benefits from isolation or parallelism (broad research, comparing perspectives,
  independent subtasks), use the task tool to spawn subagents — in parallel when independent —
  and synthesize their reports.
- When you need specific structured parameters from the user (research topic and depth, a code
  task spec, document requirements), call request_structured_input with a short form instead of
  asking in prose.
- You can run Python on the user's machine with run_python to execute or verify code.
- Installed skills are available under /skills/ — read a skill's SKILL.md when a task matches it.
`.trim();

const SUGGESTIONS_PROMPT = `
Chat modes — the user can activate special modes by starting their message with a keyword:
- "discuss …"  → Discuss mode (a panel of agents deliberates, chairman synthesizes the answer)
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
`.trim();

function buildAgentSystemPrompt(opts: AgentSessionOptions): string {
  const parts: string[] = [];
  const base = buildSystemPrompt(opts.instructions);
  if (base) parts.push(base);
  parts.push(RICH_FORMAT_PROMPT);
  parts.push(SUGGESTIONS_PROMPT);
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
        ? { type: "image_url", image_url: { url: part.image_url?.url ?? "" } }
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
    const mcp = await loadMcpTools(opts.projectDir);
    const skillFiles = withBuiltinSkill(await loadSkillFiles(opts.projectDir));
    const historyBudget = await resolveHistoryBudget(opts.provider, opts.modelName);

    const runCtx: { current: RunContext | null } = { current: null };
    const tools = buildAgentTools(opts.webFetchEnabled, () => runCtx.current);

    const agent = await createDeepAgent({
      model,
      tools: [...tools, ...mcp.tools],
      systemPrompt: buildAgentSystemPrompt(opts),
      middleware: [todoListMiddleware()],
      skills: ["/skills/"],
      checkpointer: new MemorySaver(),
      name: "chatui-assistant",
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
  ): Promise<StreamOutcome> {
    this.runCtx.current = { emit, requestInput };
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
