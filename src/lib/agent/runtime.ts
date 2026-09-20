import { createDeepAgent, registerHarnessProfile, type DeepAgent } from "deepagents";
import {
  countTokensApproximately,
  summarizationMiddleware,
  todoListMiddleware,
} from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import type { Provider, ReasoningEffort } from "@/types";
import type { ContentPart } from "@/lib/llm";
import type { Artifact } from "@/lib/artifacts";
import { buildSystemPrompt } from "@/lib/llm";
import { createChatModel } from "@/lib/agent/models";
import { buildAgentTools, type ToolProfile } from "@/lib/agent/tools";
import type { AgentSandbox } from "@/lib/agent/sandbox";
import { homeDir, normalizePath } from "@/lib/agent/sandbox";
import { loadMcpTools, createMcpProxy, type McpProxy, type McpToolsResult } from "@/lib/agent/mcp";
import { loadSkillFiles, type SkillFile } from "@/lib/agent/skills";
import type { RunContext } from "@/lib/agent/run-context";
import {
  resolveCompactionThreshold,
  resolveHistoryBudget,
  truncateMessagesToBudget,
} from "@/lib/agent/history";
import { compactionNoticeMiddleware } from "@/lib/agent/compaction";
import type {
  ActivityItem,
  AgentEvent,
  AgentMode,
  ReasoningStream,
  StructuredInputRequest,
  TodoItem,
  TokenUsage,
} from "@/lib/agent/types";
import {
  compressHistoryMessages,
  toolCompressionMiddleware,
} from "@/lib/agent/compression";
import { emptyResponseGuardMiddleware } from "@/lib/agent/empty-response-guard";
import { subagentErrorCaptureMiddleware } from "@/lib/agent/subagent-error-capture";

/**
 * deepagents ships its own filesystem tools (ls, read_file, write_file, …)
 * backed by an in-memory StateBackend. Ours (read_local_file /
 * write_local_file) are the sandboxed Tauri-backed ones, so hide the
 * built-ins — otherwise the model sees two file toolsets and the sandbox can
 * be bypassed. Registration merges (set union) with the library's own
 * profiles; our models are all ChatOpenAI instances (hint "openai"), the
 * other hints are covered for safety.
 *
 * read_file is the exception: deepagents force-re-adds it (it is required by
 * the skills middleware's read-on-demand flow) and StateBackend reads are
 * virtual-only — skills and run state, never the user's disk. The model is
 * told to use it for /skills/<name>/SKILL.md; read_local_file additionally
 * maps /skills/ paths onto the real skills folder as a fallback.
 */
const HIDDEN_BUILTIN_FILESYSTEM_TOOLS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "delete",
  "glob",
  "grep",
  "execute",
];
for (const providerHint of ["openai", "anthropic", "google"]) {
  registerHarnessProfile(providerHint, {
    excludedTools: HIDDEN_BUILTIN_FILESYSTEM_TOOLS,
  });
}

/**
 * Run metadata stored on an assistant message: the thought process, sub-agent
 * outputs, and artifacts the run produced. These are shown in the UI but are
 * not part of the message text — without them, a follow-up prompt ("continue
 * the report", "dig deeper into X") reaches the model with only the short
 * visible reply. History replay folds them back into the context as a capped
 * digest (see buildRunDigest in history.ts).
 */
export interface AgentMessageRunMeta {
  reasoning?: string;
  reasoningStreams?: ReasoningStream[];
  activities?: ActivityItem[];
  artifacts?: Artifact[];
}

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
  /** Assistant-only: metadata from the run that produced this message. */
  meta?: AgentMessageRunMeta;
}

export interface AgentSessionOptions {
  provider: Provider;
  modelName: string;
  /** Reasoning effort for reasoning-capable models ("default" = provider default). */
  reasoningEffort?: ReasoningEffort;
  instructions?: string;
  mode: AgentMode;
  webFetchEnabled: boolean;
  projectDir?: string | null;
  /** "chat" (default) = chat tools; "task" = + run_command/run_coding_task (+ read_local_file/write_local_file with enableFileTools); "setup" = + create_agent. */
  toolProfile?: ToolProfile;
  /** Task profile: set false to withhold run_command/run_coding_task (sandboxed agents without terminal). */
  enableCommandTools?: boolean;
  /** Task profile: set true to add read_local_file/write_local_file (agents with the local-files capability). */
  enableFileTools?: boolean;
  /** Restrict loaded skills to these names (sandboxed agents). undefined = all installed. */
  skillNames?: string[];
  /** Restrict MCP connectors to these connector store keys. undefined = all enabled; [] = none. */
  mcpNames?: string[];
  /** Saved-agent runs: identity + filesystem sandbox + chat-history access. */
  sandbox?: AgentSandbox;
  /** This run's deliverables folder — run_python's default cwd; files here are shareable. */
  deliverablesDir?: string;
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
  gets an editable, runnable copy in the side panel. Do NOT repeat the artifact content in your reply —
  instead write a brief 1-2 sentence summary of what you created and mention the user can
  view, edit, and download it.
- Artifact content counts against your output token limit — a single oversized create_artifact call can
  be cut off mid-call. Keep each artifact within what one response can reliably produce; if a call was
  cut off, continue with the remaining content as a follow-up artifact titled "… (continued)" instead of
  re-issuing the same oversized call.

Other tools:
- Skills live in your virtual filesystem at /skills/<name>/SKILL.md. Read them with read_file on the
  exact path from the skill list (limit=1000). They are NOT real disk paths — shell commands (cat)
  will not find them; read_local_file understands /skills/ paths too. Each skill's real folder on
  disk is stated in a "Disk location" note at the top of its SKILL.md — run its scripts and read
  its supporting files from there (run_python / run_command). Only recently used skills are listed;
  if a skill you expect is missing from the list, call search_skills — it sees the full library.
- When you need specific structured parameters from the user (research topic and depth, a code
  task spec, document requirements), call request_structured_input with a short form instead of
  asking in prose.
- You can run Python on the user's machine with run_python to execute or verify code.
- You can run Node.js on the user's machine with run_node (CommonJS) — only for the rare skill script
  that genuinely needs Node. For creating Office documents (Word, PowerPoint, Excel), use the skills'
  Python workflow with run_python (python-docx, python-pptx, openpyxl): it is much faster and needs no
  package downloads. Never use the skills' npm/Node creation paths (docx-js, pptxgenjs).
- Files you create on disk (a .pptx built with python-pptx, a report, a dataset, an image) are
  invisible to the user until you share them: call share_files with the absolute paths and a
  download card is attached to your message. Never say a file is "ready to download" without
  calling share_files first.
- Automations: for recurring or future work ("every weekday at 9am …", "weekly on Monday …",
  "in 2 hours remind me to …", "every morning …"), set it up with schedule_task (a self-contained
  prompt or a multi-step workflow via create_workflow) instead of only answering in the moment.
  Confirm the cadence with the user before creating. Runs happen only while the app is open;
  the user manages everything in the Agent Console's Automations section (list_schedules,
  update_schedule to pause/adjust, delete_schedule to remove).
`.trim();

const SUGGESTIONS_PROMPT = `
Chat modes — the user can activate special modes by starting their message with a keyword:
- "discuss …"  → Discuss mode (a panel of agents deliberating, chairman synthesizes the answer)
- "teach me …" or "i want to learn …" → Learn mode (structured tutoring with a comprehension check)
- "research …" → Research mode (multi-round, search-driven cited report)
You can also suggest a mode to the user via the suggest tool when their request would clearly benefit from one.

Skills and connectors — proactive discovery:
- Every catalog skill is discoverable and installs on demand — the user never downloads anything.
  When the user's task might benefit from a capability (creating Word/Excel/PPT/PDF files, frontend
  design, testing, etc.), call search_skills to find the matching skill and use it directly. If the
  best match is NOT installed yet, search_skills installs it on the spot and returns its SKILL.md —
  follow it in this run. Only if that install fails, call suggest with kind=skill to show an install card.
- Similarly, when the user wants to interact with an external app (email, calendar, docs, project
  tracker, etc.), call search_connectors to find one. Connectors that are connected or need no
  sign-in are usable IMMEDIATELY: list their tools with list_mcp_tools, call them with call_mcp_tool —
  in this run, no restart needed. For a connector that needs sign-in, call suggest with kind=connector
  — the card lets the user connect and sign in with one click, and afterwards call_mcp_tool works in
  the same run. Connectors that surface in the "Relevant knowledge" context work the same way. For
  Google Workspace (Gmail, Google Calendar, Google Docs, Drive) and Microsoft 365 (Outlook, Excel,
  Word), the Zapier connector covers all of them — search for "gmail", "office", or "google" to find it.
- Never suggest something that is already installed or connected (the search results show status).
- After calling suggest, continue your reply naturally — the card is shown to the user automatically.

Task mode — handing off hands-on work:
- When the conversation clearly turns into hands-on work — running terminal
  commands, editing local files, multi-step local execution, or producing a deliverable that needs
  tools the chat doesn't have — call suggest with kind=mode and target="task". The card turns on
  Task mode for this conversation with its full history. Only suggest this once per
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
  /skills/ when a task matches one; search_skills finds the whole catalog and installs a
  matching skill on the spot — use it instead of asking the user to download anything.
- Connectors (external apps) work the same way: search_connectors finds them, connected or
  auth-free ones are usable immediately via list_mcp_tools + call_mcp_tool in this run, and a
  connector needing sign-in gets a suggest kind=connector card — after the user connects,
  call_mcp_tool works in the same run. The most recently used connectors also expose native
  mcp__… tools.
- Be transparent: say what you are about to do, and report what you did.
`.trim();

const TASK_COMMAND_TOOLS_PROMPT = `
Local execution:
- run_command executes shell commands on the user's machine (login shell, their PATH). Use it for
  file operations, git, builds, tests, system inspection — anything a terminal can do. Prefer
  short, safe, targeted commands, and explain why each is needed. The user approves commands
  depending on their settings; if one is denied, don't retry it.
- run_python runs Python for calculations and data processing.
- open_app opens a Mac app by name so the user can continue there; run_applescript automates
  scriptable Mac apps (Mail, Calendar, Finder, Music, …) and returns the result. Both need user
  approval like run_command.

Coding tasks:
- NEVER write application code files yourself for real coding work. Delegate to a local coding
  agent with run_coding_task: it detects which of opencode, Claude Code, or Codex is installed,
  asks the user to pick one when several are installed, and returns the agent's output. When
  none is installed, do the work yourself with your own file and shell tools instead.
- ALWAYS confirm the project folder with the user via request_structured_input (use a 'directory'
  field so they get a folder picker) before the first run_coding_task in a task, then reuse that
  folder.
- Quick explanations or tiny snippets are fine to answer directly.
`.trim();

const TASK_FILE_TOOLS_PROMPT = `
Local files:
- read_local_file reads a file from the user's Mac — text files directly, PDFs as extracted text, and a
  folder path as a listing. Use it whenever the user points you at a local document or folder
  (e.g. a report, paper, or project directory).
- write_local_file creates or overwrites a file with the full content. With append=true it adds the
  content to the END of the existing file instead. A single oversized write can be cut off mid-call by
  the output token limit — for files longer than roughly 400 lines, write in chunks: first call with the
  initial portion, then subsequent calls with append=true. When editing an existing file, read it first,
  then write the complete new content.
- share_files gives the user download buttons for files you created — any file deliverable
  (deck, document, dataset, image, zip) must be shared this way before you wrap up, or the user
  cannot get it out of your workspace.
- The user approves every file read/write with an approve/deny card; if one is denied, don't retry —
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
        "You can always read and write files there; use it for your notes and deliverables. " +
        "The chat cannot see into your workspace — call share_files for every deliverable " +
        "you save there, or the user has no way to download it.",
    );
  }
  lines.push(
    "- Skills: the shared skills folder is always inside your sandbox (every catalog skill is " +
      "auto-installed there at launch). Skill contents are NOT preloaded into your context — " +
      "they are read on demand, so open a skill's SKILL.md whenever its topic matches your task.",
  );
  if (folders.length > 0) {
    lines.push(
      `- Allowed folders (read_local_file / write_local_file / run_coding_task): ${folders.join(", ")}`,
    );
  } else {
    lines.push(
      "- No extra folders granted yet. If you need to work on a codebase or read documents " +
        "outside your workspace, ask the user to add the folder in your agent settings (Access).",
    );
  }
  // Own sessions are always readable; externalChats widens the reach.
  const chatAccess: string[] = ["your own past sessions"];
  if (sandbox.externalChats === "all") chatAccess.push("every chat and task in the app");
  else if (sandbox.externalChats === "selected") chatAccess.push("the specific chats and tasks the user selected");
  lines.push(`- search_chats: you may search and read ${chatAccess.join(" and ")}.`);
  lines.push(
    "- File access inside your workspace and granted folders is trusted (no approval cards); " +
      "shell commands still show the user an approve/deny card.",
    "- Self-configuration: when the user asks you to change your own setup by chatting " +
      "(instructions, purpose, model, connectors, terminal/web/read-chats permissions), call " +
      "update_agent with only the fields that change. When you merely think a change would " +
      "help, propose it with suggest (kind=agent_config + agent_patch) so the user can apply " +
      "it with one click. Folder, project, and knowledge-file access is user-only — never " +
      "claim to change it yourself.",
  );
  return lines.join("\n");
}

export const AGENT_BUILDER_PROMPT = `
You are the agent builder. The user just clicked "New agent" and this chat sets up a new
persistent, sandboxed agent.

Your job — grill the user, then create the agent. Their first message is only the starting
point: you do not know the project until you have asked. Interview one topic at a time with
request_structured_input forms (2-4 fields, simple language) and cover every topic below,
even when the first message looks specific — a specific-sounding request still hides
decisions. Do not skip to creation early.
1. Job: what the agent produces or does, in the user's own words. Pin down the concrete
   deliverable or outcome, not just a domain ("help with email" → reading, drafting,
   sending? which accounts?).
2. Inputs: where its material comes from (which apps, files, folders, accounts, formats).
3. Rhythm: one-off on demand, or recurring — how often, on what trigger, at what time.
4. Scope: what is explicitly NOT its job. Record at least one non-goal before creating.
5. Integrations: call search_connectors for capabilities that match the purpose, and show
   the best matches with suggest cards. Never suggest anything already connected. Skills need
   no setup — every agent automatically discovers installed skills when it needs them, so do
   not interview about skills.
6. Permissions: every agent always gets terminal/command access and web
   search/fetch — do not ask about them, just leave both on. Local file access needs no
   permission either — the agent can always work in its private workspace, and the user grants
   extra folders in the agent's settings after creation.
7. Done means: how the user will tell the agent did its job. Record the success check.
8. Final form: confirm the agent's name plus the settled job, rhythm, and scope
   back to the user.
Then call create_agent exactly once with the agreed definition — and write everything
settled above into its system_prompt (identity, inputs, rhythm, non-goals, success check),
so the agent knows the whole project, not just the first message. Afterwards confirm to the
user in one short sentence that the agent is ready and that they can start sessions with it
from the sidebar (Agents).

The created agent is focused and self-contained: it runs only on its own system prompt, the
connectors chosen here, and the tools it needs. It does not share the user's universal memory.
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
  if (opts.deliverablesDir) {
    parts.push(
      `Deliverables folder: ${opts.deliverablesDir}\n` +
        `run_python and run_node run in this folder by default. Save every file the user should ` +
        `receive there (use absolute paths when saving), then call share_files with the absolute ` +
        `path so a download card appears in the chat.`,
    );
  }
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
  /**
   * finish_reason of the last assembled model message in this stream.
   * "length" means the model hit its output token limit — the turn (possibly
   * mid tool call) was cut off and the caller should continue the thread.
   */
  finishReason?: string;
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

/** Final path segment of a POSIX-ish path (works for ~/… and absolute paths). */
function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/**
 * Builds the files-widget entry for a finished write_local_file call from
 * the raw tool-call path and its result text. The path is normalized exactly
 * like share_files normalizes (~/… expansion, ./… resolution) so both flows
 * land on the same string and merge into one widget row; the byte count is
 * parsed from both the create/overwrite ("(N bytes)") and append
 * ("(now N bytes)") result formats. Exported for tests.
 */
export function writeLocalFileActivity(
  path: string,
  detail: string | undefined,
  home: string | null,
): NonNullable<ActivityItem["file"]> {
  const bytesMatch = detail ? /\((?:now )?(\d+) bytes\)/.exec(detail) : null;
  const normalized = normalizePath(path, home);
  return {
    path: normalized,
    name: basename(normalized),
    ...(bytesMatch ? { bytes: Number(bytesMatch[1]) } : {}),
  };
}

/**
 * Provider-reported token counts of an assembled model message
 * (AIMessage.usage_metadata). Null when the message carries none — providers
 * that omit usage in streaming simply report nothing. Exported for tests and
 * the research/council pipelines, which consume the same v3 message stream.
 */
export function usageOfMessage(finalMessage: unknown): TokenUsage | null {
  const meta = (
    finalMessage as { usage_metadata?: { input_tokens?: unknown; output_tokens?: unknown; input_token_details?: { cache_read?: unknown } } } | undefined
  )?.usage_metadata;
  if (!meta) return null;
  const input = Number(meta.input_tokens);
  const output = Number(meta.output_tokens);
  if (!Number.isFinite(input) || !Number.isFinite(output) || (input <= 0 && output <= 0)) {
    return null;
  }
  const cached = Number(meta.input_token_details?.cache_read);
  return {
    inputTokens: input,
    cachedTokens: Number.isFinite(cached) && cached > 0 ? cached : 0,
    outputTokens: output,
  };
}

/**
 * Derive a short label for an inline activity chip from the tool name + args.
 * Exported for tests.
 */
export function toolCallLabel(name: string, input: unknown): string | undefined {
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
  if (name === "run_node") return "Running Node";
  if (name === "open_app" && typeof args.app === "string") {
    return `Opening ${args.app.slice(0, 40)}`;
  }
  if (name === "run_applescript") return "Running AppleScript";
  if (name === "create_artifact" && typeof args.title === "string") {
    return `Creating "${args.title.slice(0, 40)}"`;
  }
  if (name === "write_local_file" && typeof args.path === "string") {
    return `Writing ${basename(args.path)}`;
  }
  if (name === "read_local_file" && typeof args.path === "string") {
    return `Reading ${basename(args.path)}`;
  }
  return undefined;
}

/**
 * Argument caps for the per-chip preview: enough of a file write / artifact /
 * script to see what the agent is doing, small enough that persisting one per
 * tool call never bloats message storage (localStorage) meaningfully.
 */
const ARGS_PREVIEW_CHARS = 4000;
const ARGS_PREVIEW_COMMAND_CHARS = 2000;
const ARGS_PREVIEW_JSON_CHARS = 500;

function clipPreview(text: string, limit = ARGS_PREVIEW_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… truncated (${text.length} chars total)`;
}

/**
 * Bounded, human-readable preview of a tool call's arguments for the
 * expandable activity chip — e.g. the file path plus the head of the content
 * being written. Exported for tests. Returns undefined when there is nothing
 * worth showing (no input, or stringify failed).
 */
export function toolCallArgsPreview(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const args = input as Record<string, unknown>;
  if (name === "write_local_file") {
    if (typeof args.path !== "string") return undefined;
    const content = typeof args.content === "string" ? args.content : "";
    const header = `${args.path}${args.append === true ? " (append)" : ""}`;
    return `${header}\n\n${clipPreview(content)}`;
  }
  if (name === "create_artifact") {
    const title = typeof args.title === "string" ? args.title : "artifact";
    const language = typeof args.language === "string" ? args.language : "";
    const content = typeof args.content === "string" ? args.content : "";
    return `${title} (${language})\n\n${clipPreview(content)}`;
  }
  if (name === "run_python" || name === "run_node") {
    return typeof args.code === "string" ? clipPreview(args.code) : undefined;
  }
  if (name === "run_command") {
    return typeof args.command === "string" ? clipPreview(args.command, ARGS_PREVIEW_COMMAND_CHARS) : undefined;
  }
  if (name === "run_applescript") {
    return typeof args.script === "string" ? clipPreview(args.script, ARGS_PREVIEW_COMMAND_CHARS) : undefined;
  }
  if (name === "read_local_file") {
    return typeof args.path === "string" ? args.path : undefined;
  }
  // Fallback (MCP tools, suggest, schedules, …): compact JSON, tightly capped.
  try {
    const json = JSON.stringify(input);
    if (json.length <= ARGS_PREVIEW_JSON_CHARS) return json;
    return `${json.slice(0, ARGS_PREVIEW_JSON_CHARS)}…`;
  } catch {
    return undefined;
  }
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
    private modelName: string,
    private mcp: McpToolsResult,
    private mcpProxy: McpProxy | null,
    private runCtx: { current: RunContext | null } = { current: null },
  ) {}

  static async create(opts: AgentSessionOptions): Promise<DeepAgentSession> {
    const model = await createChatModel(opts.provider, opts.modelName, opts.reasoningEffort);
    const mcp = await loadMcpTools(opts.projectDir, opts.mcpNames);
    // On-demand proxy for the non-hot connectors — including ones connected
    // mid-run from a suggestion card (usable in the SAME run).
    const mcpProxy = createMcpProxy(opts.projectDir, opts.mcpNames);
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
    const compactionTokens = await resolveCompactionThreshold(opts.provider, opts.modelName);

    const runCtx: { current: RunContext | null } = { current: null };
    const profile = opts.toolProfile ?? "chat";
    let tools = buildAgentTools(
      opts.webFetchEnabled,
      () => runCtx.current,
      profile,
      opts.enableFileTools ?? false,
      opts.sandbox,
      opts.deliverablesDir,
    );
    if (profile === "task" && opts.enableCommandTools === false) {
      tools = tools.filter(
        (t) =>
          t.name !== "run_command" &&
          t.name !== "run_coding_task" &&
          t.name !== "open_app" &&
          t.name !== "run_applescript",
      );
    }

    // No `subagents` option: createDeepAgent auto-adds the general-purpose
    // subagent (the `task` tool), which dedicated agents need for delegation.
    // Keep it that way — see subagents.test.ts.
    const agent = await createDeepAgent({
      model,
      tools: [...tools, ...mcp.tools, ...(mcpProxy?.tools ?? [])],
      systemPrompt: buildAgentSystemPrompt(opts),
      middleware: [
        todoListMiddleware(),
        // Runs before the summarizer (beforeModel hooks chain in middleware
        // order) so it sees the pre-compaction state and can announce the
        // compaction as an activity chip.
        compactionNoticeMiddleware(compactionTokens, () => runCtx.current),
        summarizationMiddleware({
          model,
          // Absolute token counts only — fractional triggers require a model
          // profile that our custom-baseURL ChatOpenAI instances don't have
          // (the middleware throws without one).
          trigger: { tokens: compactionTokens },
          keep: { tokens: Math.max(2048, Math.floor(compactionTokens / 2)) },
          // Wrapped: the middleware's TokenCounter takes rest args, and
          // countTokensApproximately's optional second (tools) parameter
          // doesn't widen to that signature directly.
          tokenCounter: (messages) => countTokensApproximately(messages),
        }),
        toolCompressionMiddleware(opts.modelName),
        emptyResponseGuardMiddleware(),
        // Subagent (task tool) failures become tool results instead of
        // aborting the run — parallel subagent failures used to surface as
        // "Multiple errors occurred during superstep N".
        subagentErrorCaptureMiddleware(),
      ],
      skills: ["/skills/"],
      checkpointer: new MemorySaver(),
      name: profile === "chat" ? "chatui-assistant" : `chatui-${profile}`,
    });

    return new DeepAgentSession(agent, crypto.randomUUID(), skillFiles, historyBudget, opts.modelName, mcp, mcpProxy, runCtx);
  }

  /** Close MCP clients opened for this session. */
  async dispose(): Promise<void> {
    await this.mcp.dispose();
    await this.mcpProxy?.dispose();
  }

  async firstInput(messages: AgentMessage[]): Promise<Record<string, unknown>> {
    const bounded = truncateMessagesToBudget(messages, this.historyBudget);
    const compressed = await compressHistoryMessages(bounded, this.modelName);
    return {
      messages: toLangChainMessages(compressed),
      files: this.skillFiles,
    };
  }

  async stream(
    input: unknown,
    emit: (event: AgentEvent) => void,
    signal?: AbortSignal,
    requestInput?: RunContext["requestInput"],
    requestApproval?: RunContext["requestApproval"],
    loadThoughts?: RunContext["loadThoughts"],
  ): Promise<StreamOutcome> {
    this.runCtx.current = { emit, requestInput, requestApproval, loadThoughts };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const run = await (this.agent as any).streamEvents(input, {
        version: "v3",
        configurable: { thread_id: this.threadId },
        signal,
      });

      // finish_reason of the most recent assembled model message — "length"
      // means the turn was cut off by the output token limit (possibly mid
      // tool call), which the caller can continue from.
      let lastFinishReason: string | undefined;

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
          try {
            // Same pattern as deep-research.ts: the assembled message's
            // response_metadata carries the provider's finish_reason.
            const final = await (msg as { output?: unknown }).output;
            const reason = (final as { response_metadata?: { finish_reason?: unknown } })
              ?.response_metadata?.finish_reason;
            if (typeof reason === "string") lastFinishReason = reason;
            // Usage rides on the same assembled message — one event per model
            // call feeds the session's context-usage widget.
            const usage = usageOfMessage(final);
            if (usage) emit({ type: "usage", usage });
          } catch {
            // no assembled message (e.g. aborted mid-stream)
          }
        }
      })();

      const consumeToolCalls = (async () => {
        for await (const call of run.toolCalls) {
          const id = `tool-${call.callId || call.name}-${Date.now()}`;
          const label = toolCallLabel(call.name, call.input);
          const argsPreview = toolCallArgsPreview(call.name, call.input);
          // Visited websites carry their url so the UI can show a favicon.
          const input = call.input as Record<string, unknown> | undefined;
          const url =
            call.name === "web_fetch" && typeof input?.url === "string"
              ? input.url
              : undefined;
          emit({
            type: "activity",
            activity: {
              id,
              kind: "tool",
              name: call.name,
              status: "running",
              label,
              url,
              argsPreview,
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
            // A completed write_local_file names the file it produced —
            // remember it so the session files widget can offer a download.
            // The path is normalized exactly like share_files normalizes
            // (~/… expansion, ./… resolution) so both flows land on the same
            // string and the widget merges them into one row instead of
            // showing the same file twice.
            let file: ActivityItem["file"];
            if (
              status === "finished" &&
              call.name === "write_local_file" &&
              typeof input?.path === "string"
            ) {
              const home = await homeDir().catch(() => null);
              file = writeLocalFileActivity(input.path, detail, home);
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
                url,
                argsPreview,
                ...(file ? { file } : {}),
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

      return { interrupted: false, finishReason: lastFinishReason };
    } finally {
      this.runCtx.current = null;
    }
  }
}
