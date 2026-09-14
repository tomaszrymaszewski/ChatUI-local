import { useSyncExternalStore } from "react";
import type { Provider, ReasoningEffort } from "@/types";
import type { Artifact } from "@/lib/artifacts";
import type { AgentSandbox } from "@/lib/agent/sandbox";
import { DeepAgentSession, type AgentMessage } from "@/lib/agent/runtime";
import { runDeepResearch } from "@/lib/agent/deep-research";
import { runDiscuss } from "@/lib/agent/discuss";
import { setRetrievedDocIds } from "@/lib/agent/run-context";
import { buildRunThoughts, toHistoryMessage, resolveContextWindow } from "@/lib/agent/history";
import { getModelCost, priceUsage, type ModelPrices } from "@/lib/model-capabilities";
import { ensureDeliverablesDir } from "@/lib/deliverables";
import { loadMessages } from "@/hooks/use-messages";
import { loadUserSettings } from "@/hooks/use-user-settings";
import { notifyIfBackground } from "@/lib/notify";
import { scheduleKnowledgeSweep } from "@/lib/knowledge-index";
import { retrieveKnowledgeContext } from "@/lib/knowledge-retrieval";
import { estimateTokens, recordAgentUsage } from "@/lib/agent-usage";
import type {
  ActivityItem,
  AgentEvent,
  AgentMode,
  AgentRunResult,
  ApprovalRequest,
  ReasoningStream,
  SharedFile,
  SuggestionRequest,
  StructuredInputRequest,
  TodoItem,
} from "@/lib/agent/types";

export interface DeepAgentRunOptions {
  provider: Provider;
  modelName: string;
  messages: AgentMessage[];
  instructions?: string;
  mode?: AgentMode;
  webFetchEnabled: boolean;
  projectDir?: string | null;
  /** Reasoning effort for reasoning-capable models ("default" = provider default). */
  reasoningEffort?: ReasoningEffort;
  /** All configured models (name → providerId), used by discuss mode for per-role model assignment. */
  availableModels?: Array<{ name: string; providerId: string; displayName?: string }>;
  /** All providers, used by discuss mode to resolve per-role model → ChatOpenAI. */
  providers?: Provider[];
  /** Agent-mode ("task") runs: which extra tools the run gets. */
  taskProfile?: {
    toolProfile: "task" | "setup";
    /** false withholds run_command/run_coding_task (sandboxed agents without terminal). */
    enableCommandTools?: boolean;
    /** true adds read_local_file/write_local_file (agents with the local-files capability). */
    enableFileTools?: boolean;
    /** Restrict skills to these names (sandboxed agents). */
    skillNames?: string[];
    /** Restrict MCP connectors to these connector store keys (sandboxed agents). */
    mcpNames?: string[];
    /** Saved-agent runs: identity + filesystem sandbox + chat-history access. */
    sandbox?: AgentSandbox;
  };
  /**
   * True for headless (scheduler/workflow) runs: structured-input requests are
   * auto-skipped and — in "ask" terminal-approval mode — commands are
   * auto-denied, so an unattended run can never hang on the UI.
   */
  unattended?: boolean;
}

/**
 * Safety cap on automatic continuations per run: a model that keeps ending its
 * turn without finishing (or a persistently failing provider) cannot loop
 * forever — after this many the run ends and the last output/error surfaces.
 */
const MAX_AUTO_CONTINUES = 5;

/** Cumulative token usage of a session (all runs, all model calls). */
export interface SessionUsage {
  /** Sum of prompt tokens processed across every model call. */
  inputTokens: number;
  /** Sum of prompt tokens served from the provider's cache. */
  cachedTokens: number;
  /** Sum of completion tokens produced. */
  outputTokens: number;
  /** Tokens in context at the most recent model call (its input + output) — the "how full is the window" figure. */
  contextTokens: number;
  /** Estimated session spend in USD at models.dev list prices (0 when unpriced). */
  costDollars: number;
}

const ZERO_USAGE: SessionUsage = {
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  contextTokens: 0,
  costDollars: 0,
};

const USAGE_KEY_PREFIX = "chatui:session-usage:";

/** Load a session's persisted usage (zeros when absent/corrupt). */
function loadSessionUsage(sessionId: string): SessionUsage {
  try {
    const raw = localStorage.getItem(USAGE_KEY_PREFIX + sessionId);
    if (!raw) return { ...ZERO_USAGE };
    const data = JSON.parse(raw) as Partial<SessionUsage>;
    if (
      typeof data.inputTokens !== "number" ||
      typeof data.cachedTokens !== "number" ||
      typeof data.outputTokens !== "number" ||
      typeof data.contextTokens !== "number"
    ) {
      return { ...ZERO_USAGE };
    }
    return {
      inputTokens: data.inputTokens,
      cachedTokens: data.cachedTokens,
      outputTokens: data.outputTokens,
      contextTokens: data.contextTokens,
      // Sessions persisted before spend tracking have no cost field.
      costDollars: typeof data.costDollars === "number" ? data.costDollars : 0,
    };
  } catch {
    return { ...ZERO_USAGE };
  }
}

function persistSessionUsage(sessionId: string, usage: SessionUsage) {
  try {
    localStorage.setItem(USAGE_KEY_PREFIX + sessionId, JSON.stringify(usage));
  } catch {
    // storage full/unavailable — usage is best-effort
  }
}

/**
 * Synthetic user turn injected when a run ends on its own with unfinished
 * todos (or dies mid-task): it continues the SAME thread, so the model keeps
 * its todo list, files, and prior tool results.
 */
const AUTO_CONTINUE_PROMPT =
  "[Automatic continuation — your previous turn ended before the task was finished; this was " +
  "not the user. The todo list still has unfinished items. Continue exactly where you left " +
  "off: do not restart or repeat completed work, keep the todo statuses updated, and keep " +
  "going until every item is done. If the work is actually already complete, mark the " +
  "remaining todos completed and give the final summary instead.]";

/** Synthetic user turn after a stream ended on the output token limit. */
const TRUNCATION_CONTINUE_PROMPT =
  "[Automatic continuation — your previous turn hit the model's output token limit and was cut off, " +
  "possibly mid tool call; this was not the user. Do not restart or repeat completed work. If a file " +
  "write or artifact was cut off, do NOT re-issue the same oversized call: split the remaining content " +
  "into smaller pieces (write_local_file with append=true for the next chunk, or a shorter artifact) " +
  "and continue until the task and every todo item is finished.]";

/** Best-effort char count of the run input (text parts only; images excluded). */
function inputChars(messages: AgentMessage[]): number {
  let n = 0;
  for (const m of messages) {
    const c = m.content;
    if (typeof c === "string") {
      n += c.length;
    } else if (Array.isArray(c)) {
      for (const part of c) {
        const p: unknown = part;
        if (typeof p === "string") n += p.length;
        else if (p && typeof p === "object" && "text" in p) {
          n += String((p as { text: unknown }).text ?? "").length;
        }
      }
    }
  }
  return n;
}

/**
 * Whether a finished stream should be followed by an automatic continuation
 * on the same thread: the run ended with unfinished todos, or it was cut off
 * by the model's output token limit (finish_reason "length"), possibly mid
 * tool call. Exported for tests.
 */
export function shouldAutoContinue(
  attempt: number,
  todosUnfinished: boolean,
  truncated: boolean,
): boolean {
  return attempt < MAX_AUTO_CONTINUES && (todosUnfinished || truncated);
}

/**
 * The synthetic user turn to inject for an automatic continuation. A
 * truncation cut gets the more specific resume-with-chunking instruction;
 * a clean early stop gets the todo-focused one. Exported for tests.
 */
export function continuationPrompt(truncated: boolean): string {
  return truncated ? TRUNCATION_CONTINUE_PROMPT : AUTO_CONTINUE_PROMPT;
}

type InputResolution =
  | { cancelled: true }
  | { values: Record<string, unknown> };

type ApprovalResolution = { approved: boolean };

/** Text of the newest user message — the retrieval query for a run. */
function lastUserText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content.slice(0, 2000);
    let text = "";
    for (const part of m.content) {
      const p: unknown = part;
      if (typeof p === "string") text += p;
      else if (p && typeof p === "object" && "text" in p) {
        text += String((p as { text: unknown }).text ?? "");
      }
    }
    return text.slice(0, 2000);
  }
  return "";
}

/** A local action awaiting a decision, with its approval-card/activity id. */
export interface PendingApproval {
  id: string;
  request: ApprovalRequest;
}

export interface AgentControllerApi {
  isRunning: boolean;
  streamingContent: string;
  streamingReasoning: string;
  activities: ActivityItem[];
  todos: TodoItem[];
  artifacts: Artifact[];
  files: SharedFile[];
  pendingInput: StructuredInputRequest | null;
  pendingSuggestion: SuggestionRequest | null;
  /** All local actions awaiting a decision — one approve/deny card each. */
  pendingApprovals: PendingApproval[];
  reasoningStreams: ReasoningStream[];
  /** Agent created during the most recent run (agent-builder setup), if any. */
  createdAgent: { agentId: string; agentName: string } | null;
  /** Cumulative token usage for this session — feeds the context widget. */
  usage: SessionUsage;
  /** The session model's context window (tokens), null until a run resolves it. */
  contextLimit: number | null;
  run: (opts: DeepAgentRunOptions) => Promise<AgentRunResult>;
  submitInput: (values: Record<string, unknown>) => void;
  skipInput: () => void;
  dismissSuggestion: () => void;
  approveCommand: (id: string) => void;
  rejectCommand: (id: string) => void;
  stop: () => void;
}

class AgentController implements AgentControllerApi {
  readonly sessionId: string;

  isRunning = false;
  streamingContent = "";
  streamingReasoning = "";
  activities: ActivityItem[] = [];
  todos: TodoItem[] = [];
  artifacts: Artifact[] = [];
  files: SharedFile[] = [];
  pendingInput: StructuredInputRequest | null = null;
  pendingSuggestion: SuggestionRequest | null = null;
  pendingApprovals: PendingApproval[] = [];
  reasoningStreams: ReasoningStream[] = [];
  createdAgent: { agentId: string; agentName: string } | null = null;
  /** Cumulative token usage for this session — feeds the context widget. */
  usage: SessionUsage;
  /** The session model's context window (tokens), null until a run resolves it. */
  contextLimit: number | null = null;
  /** This run's models.dev list prices (per M tokens), null when unpriced. */
  private pricingRef: ModelPrices | null = null;

  private version = 0;
  private listeners = new Set<() => void>();
  private notifyQueued = false;

  private contentRef = "";
  private reasoningRef = "";
  private activitiesRef = new Map<string, ActivityItem>();
  private todosRef: TodoItem[] = [];
  private artifactsRef: Artifact[] = [];
  private filesRef: SharedFile[] = [];
  private abortRef: AbortController | null = null;
  private inputResolverRef: ((r: InputResolution) => void) | null = null;
  /** One resolver per pending approval card, keyed by its activity id. */
  private approvalResolvers = new Map<string, (approved: boolean) => void>();
  /** Monotonic id for approval activity rows (one row per requested action). */
  private approvalSeq = 0;
  /** Session-level: the user approved one command in "task" approval mode. */
  private commandsApprovedForTask = false;
  /** Headless runs never surface prompts — see DeepAgentRunOptions.unattended. */
  private unattended = false;
  /**
   * Id of the assistant message the current run streams into (set by the
   * caller before run()): loadThoughts skips it, since the crash-safety save
   * keeps this run's own partial output in storage where it would otherwise
   * shadow the previous run's thoughts.
   */
  inProgressMessageId: string | null = null;
  private reasoningStartRef: number | null = null;
  private reasoningMsRef = 0;
  private reasoningStreamsRef = new Map<string, { text: string; label: string; startTime: number; endTime?: number; seq: number }>();
  /** Shared monotonic counter so activities and reasoning streams can be
   *  interleaved chronologically in the UI. */
  private seqCounter = 0;
  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.usage = loadSessionUsage(sessionId);
  }

  // ── React subscription ────────────────────────────────────────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getSnapshot = () => this.version;
  private notify() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /**
   * Throttled notify for high-frequency events (tokens, reasoning). Batches
   * all notifications within a ~50ms window so React re-renders at most
   * ~20fps during streaming instead of on every single token, which would
   * otherwise overwhelm the main thread and freeze the UI.
   */
  private scheduleNotify() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    setTimeout(() => {
      this.notifyQueued = false;
      this.notify();
    }, 50);
  }

  private publishActivities() {
    this.activities = Array.from(this.activitiesRef.values());
    this.notify();
  }

  private publishReasoningStreams() {
    this.reasoningStreams = Array.from(this.reasoningStreamsRef.entries()).map(([id, s]) => ({
      id,
      label: s.label,
      text: s.text,
      ms: s.endTime ? s.endTime - s.startTime : undefined,
      seq: s.seq,
    }));
    this.notify();
  }

  private reasoningStreamsNotifyQueued = false;
  private schedulePublishReasoningStreams() {
    if (this.reasoningStreamsNotifyQueued) return;
    this.reasoningStreamsNotifyQueued = true;
    // 100ms (~10fps): reasoning streams can be numerous (one per sub-agent)
    // and each one re-renders a ThinkingBlock on publish, so they get a
    // wider batch window than token events to keep the main thread free.
    setTimeout(() => {
      this.reasoningStreamsNotifyQueued = false;
      this.publishReasoningStreams();
    }, 100);
  }

  private emit = (event: AgentEvent) => {
    switch (event.type) {
      case "token":
        if (this.reasoningStartRef !== null) {
          this.reasoningMsRef = Date.now() - this.reasoningStartRef;
          this.reasoningStartRef = null;
        }
        this.contentRef += event.text;
        this.streamingContent = this.contentRef;
        this.scheduleNotify();
        break;
      case "reasoning": {
        if (event.id) {
          const existing = this.reasoningStreamsRef.get(event.id);
          if (!existing) {
            this.reasoningStreamsRef.set(event.id, {
              text: event.text,
              label: event.label ?? event.id,
              startTime: Date.now(),
              seq: ++this.seqCounter,
            });
          } else {
            existing.text += event.text;
          }
          this.schedulePublishReasoningStreams();
        } else {
          if (this.reasoningStartRef === null) {
            this.reasoningStartRef = Date.now();
          }
          this.reasoningRef += event.text;
          this.streamingReasoning = this.reasoningRef;
          this.scheduleNotify();
        }
        break;
      }
      case "activity": {
        const existing = this.activitiesRef.get(event.activity.id);
        if (!existing) {
          this.activitiesRef.set(event.activity.id, {
            ...event.activity,
            textOffset: this.contentRef.length,
            seq: ++this.seqCounter,
          });
        } else {
          this.activitiesRef.set(event.activity.id, {
            ...event.activity,
            textOffset: existing.textOffset,
            seq: existing.seq,
            label: event.activity.label ?? existing.label,
          });
        }
        if (event.activity.status === "done" || event.activity.status === "error") {
          const stream = this.reasoningStreamsRef.get(event.activity.id);
          if (stream && !stream.endTime) {
            stream.endTime = Date.now();
            this.publishReasoningStreams();
          }
        }
        this.publishActivities();
        break;
      }
      case "todos":
        this.todosRef = event.todos;
        this.todos = event.todos;
        this.notify();
        break;
      case "artifact":
        this.artifactsRef.push(event.artifact);
        this.artifacts = [...this.artifactsRef];
        this.notify();
        break;
      case "files":
        // Dedupe by path — a re-share of the same file updates nothing.
        for (const file of event.files) {
          if (!this.filesRef.some((f) => f.path === file.path)) {
            this.filesRef.push(file);
          }
        }
        this.files = [...this.filesRef];
        this.notify();
        break;
      case "suggestion":
        this.pendingSuggestion = event.suggestion;
        this.notify();
        break;
      case "agent_created":
        this.createdAgent = { agentId: event.agentId, agentName: event.agentName };
        break;
      case "usage":
        // Accumulate across runs and model calls; contextTokens tracks the
        // most recent call (its input is what actually filled the window).
        // Spend is priced with the run's models.dev list prices (resolved at
        // run start); unpriced models simply add 0.
        this.usage = {
          inputTokens: this.usage.inputTokens + event.usage.inputTokens,
          cachedTokens: this.usage.cachedTokens + event.usage.cachedTokens,
          outputTokens: this.usage.outputTokens + event.usage.outputTokens,
          contextTokens: event.usage.inputTokens + event.usage.outputTokens,
          costDollars:
            this.usage.costDollars + priceUsage(event.usage, this.pricingRef),
        };
        persistSessionUsage(this.sessionId, this.usage);
        this.notify();
        break;
    }
  };

  private resetState() {
    this.contentRef = "";
    this.reasoningRef = "";
    this.activitiesRef = new Map();
    this.todosRef = [];
    this.artifactsRef = [];
    this.filesRef = [];
    this.reasoningStartRef = null;
    this.reasoningMsRef = 0;
    this.reasoningStreamsRef = new Map();
    this.seqCounter = 0;
    this.streamingContent = "";
    this.streamingReasoning = "";
    this.activities = [];
    this.todos = [];
    this.artifacts = [];
    this.files = [];
    this.pendingInput = null;
    // NOTE: pendingSuggestion is deliberately never cleared by run
    // lifecycle (here or when the run ends below) — a suggestion card stays
    // up until the user explicitly connects or dismisses it.
    this.pendingApprovals = [];
    this.approvalResolvers.clear();
    this.createdAgent = null;
    this.reasoningStreams = [];
    this.notify();
  }

  /** Normalize unfinished state so loading animations always terminate. */
  private normalizeOnEnd() {
    let changed = false;
    for (const [, item] of this.activitiesRef) {
      if (item.status === "running") {
        this.activitiesRef.set(item.id, { ...item, status: "done" });
        changed = true;
      }
    }
    if (changed) this.publishActivities();

    let streamsChanged = false;
    for (const [, stream] of this.reasoningStreamsRef) {
      if (!stream.endTime) {
        stream.endTime = Date.now();
        streamsChanged = true;
      }
    }
    if (streamsChanged) this.publishReasoningStreams();
  }

  private promptForInput = (request: StructuredInputRequest): Promise<InputResolution> => {
    if (this.unattended) {
      this.emit({
        type: "activity",
        activity: {
          id: "structured-input",
          kind: "input",
          name: request.title,
          status: "done",
          label: "Skipped — unattended run",
        },
      });
      return Promise.resolve({ cancelled: true });
    }
    this.emit({
      type: "activity",
      activity: {
        id: "structured-input",
        kind: "input",
        name: request.title,
        status: "running",
        label: request.title,
      },
    });
    this.pendingInput = request;
    this.notify();
    return new Promise((resolve) => {
      this.inputResolverRef = resolve;
    });
  };

  /**
   * Approval gate for local shell commands (run_command / run_coding_task
   * permissions) and local file access. Applies the user's terminal-approval
   * setting:
   * - "auto": approve immediately.
   * - "task": approve after the first approval in this session.
   * - "ask": show an approve/deny card every time.
   *
   * Tool calls in one turn run in parallel (ToolNode Promise.all), so several
   * approval-gated actions can arrive at once. Each gets its OWN card —
   * pendingApprovals holds them all and each is decided independently by id.
   */
  private promptForApproval = (request: ApprovalRequest): Promise<ApprovalResolution> => {
    const mode = loadUserSettings().terminalApproval;
    if (mode === "auto" || (mode === "task" && this.commandsApprovedForTask)) {
      return Promise.resolve({ approved: true });
    }
    if (this.unattended) {
      // "ask" mode with nobody at the keyboard — deny instead of hanging.
      const label = request.command.split("\n")[0].slice(0, 60);
      this.emit({
        type: "activity",
        activity: {
          id: `command-approval-${++this.approvalSeq}`,
          kind: "input",
          name: label,
          status: "done",
          label: "Denied — unattended run",
        },
      });
      return Promise.resolve({ approved: false });
    }
    if (this.abortRef?.signal.aborted) {
      // The run was stopped before this card could be answered — deny
      // instead of showing a card for a dead run.
      return Promise.resolve({ approved: false });
    }
    const id = `command-approval-${++this.approvalSeq}`;
    const label = request.command.split("\n")[0].slice(0, 60);
    this.emit({
      type: "activity",
      activity: {
        id,
        kind: "input",
        name: label,
        status: "running",
        label: "Waiting for your approval",
      },
    });
    this.pendingApprovals = [...this.pendingApprovals, { id, request }];
    this.notify();
    return new Promise<ApprovalResolution>((resolve) => {
      this.approvalResolvers.set(id, (approved: boolean) => {
        if (approved && mode === "task") this.commandsApprovedForTask = true;
        this.emit({
          type: "activity",
          activity: {
            id,
            kind: "input",
            name: label,
            status: "done",
            label: approved ? "Approved" : "Denied",
          },
        });
        resolve({ approved });
      });
    });
  };

  /**
   * Full (uncapped) replay of the most recent previous run's thought process
   * in this chat — the backing for the get_task_thoughts tool. History replay
   * only folds a short digest into context, so a run resuming after a stop or
   * interruption pulls the complete reasoning here instead.
   */
  private loadThoughts = async (): Promise<string> => {
    const messages = loadMessages(this.sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant" || m.id === this.inProgressMessageId) continue;
      const meta = toHistoryMessage(m).meta;
      if (!meta) continue;
      const thoughts = buildRunThoughts(meta);
      if (thoughts) return thoughts;
    }
    return "No recorded thought process was found in this chat yet.";
  };

  run = async (opts: DeepAgentRunOptions): Promise<AgentRunResult> => {
    this.resetState();
    this.isRunning = true;
    this.unattended = opts.unattended ?? false;
    registryNotify();
    // Resolve the model's context window for the usage widget (async, best-effort).
    void resolveContextWindow(opts.provider, opts.modelName)
      .then((limit) => {
        this.contextLimit = limit;
        this.notify();
      })
      .catch(() => {});
    // List prices for session-spend math (cached catalog: no extra fetch).
    this.pricingRef = await getModelCost(opts.provider, opts.modelName).catch(() => null);
    const controller = new AbortController();
    this.abortRef = controller;

    let cancelled = false;
    let failedMessage: string | null = null;
    let pipelineCompleted = true;
    let session: DeepAgentSession | null = null;
    try {
      const mode = opts.mode ?? "chat";
      // Mode-aware effort: research/council pipelines deliberate deeper by
      // default. A user-selected effort always wins; "default" (or unset)
      // picks "high" for the deep pipelines and stays untouched for plain
      // chat/task runs (GLM maps "high" to its "max" tier in models.ts).
      const reasoningEffort =
        opts.reasoningEffort && opts.reasoningEffort !== "default"
          ? opts.reasoningEffort
          : mode === "research" || mode === "council"
            ? "high"
            : opts.reasoningEffort;

      if (mode === "research") {
        const pipeline = await runDeepResearch(
          {
            provider: opts.provider,
            modelName: opts.modelName,
            messages: opts.messages,
            instructions: opts.instructions,
            webFetchEnabled: opts.webFetchEnabled,
            projectDir: opts.projectDir,
            reasoningEffort,
          },
          this.emit,
          controller.signal,
          this.promptForInput,
        );
        pipelineCompleted = pipeline.completed;
      } else if (mode === "council") {
        const pipeline = await runDiscuss(
          {
            provider: opts.provider,
            modelName: opts.modelName,
            messages: opts.messages,
            instructions: opts.instructions,
            webFetchEnabled: opts.webFetchEnabled,
            projectDir: opts.projectDir,
            availableModels: opts.availableModels ?? [],
            providers: opts.providers ?? [],
            reasoningEffort,
          },
          this.emit,
          controller.signal,
          this.promptForInput,
        );
        pipelineCompleted = pipeline.completed;
      } else {
        // Knowledge retrieval (RAG): top hits from the persistent index ride
        // along in the instructions; their ids are remembered so the agent's
        // search_knowledge tool can look beyond them.
        let instructions = opts.instructions;
        const retrieval = await retrieveKnowledgeContext(lastUserText(opts.messages));
        setRetrievedDocIds(retrieval.ids);
        if (retrieval.block) {
          instructions = [instructions, retrieval.block].filter(Boolean).join("\n\n");
        }
        session = await DeepAgentSession.create({
          provider: opts.provider,
          modelName: opts.modelName,
          reasoningEffort,
          instructions,
          mode: mode === "task" ? "task" : "chat",
          webFetchEnabled: opts.webFetchEnabled,
          projectDir: opts.projectDir,
          toolProfile: opts.taskProfile?.toolProfile,
          enableCommandTools: opts.taskProfile?.enableCommandTools,
          enableFileTools: opts.taskProfile?.enableFileTools,
          skillNames: opts.taskProfile?.skillNames,
          mcpNames: opts.taskProfile?.mcpNames,
          sandbox: opts.taskProfile?.sandbox,
          deliverablesDir: await ensureDeliverablesDir(this.sessionId),
        });

        // A run must not stop on its own while the todo list still has work:
        // when the model ends its turn early (or the stream dies mid-task), it
        // is continued on the same thread — todos, files, and tool results all
        // persist — until the list is done. Only a user stop (or the
        // continuation cap) ends the run unfinished.
        let input: unknown = await session.firstInput(opts.messages);
        let lastError: unknown = null;
        let lastFinishReason: string | undefined;
        for (let attempt = 0; ; attempt++) {
          try {
            const outcome = await session.stream(
              input,
              this.emit,
              controller.signal,
              this.promptForInput,
              this.promptForApproval,
              this.loadThoughts,
            );
            lastError = null;
            lastFinishReason = outcome.finishReason;
          } catch (err) {
            if (controller.signal.aborted) {
              cancelled = true;
              break;
            }
            lastError = err;
            lastFinishReason = undefined;
          }
          if (controller.signal.aborted) {
            cancelled = true;
            break;
          }
          const todosUnfinished = this.todosRef.some((t) => t.status !== "completed");
          const truncated = lastFinishReason === "length";
          if (!shouldAutoContinue(attempt, todosUnfinished, truncated)) {
            break;
          }
          this.emit({
            type: "activity",
            activity: {
              id: `auto-continue-${attempt}`,
              kind: "tool",
              name: "auto_continue",
              status: "done",
              label: lastError
                ? "Run failed mid-task — continuing"
                : truncated
                  ? "Output limit hit — continuing"
                  : "Run stopped with unfinished todos — continuing",
            },
          });
          if (lastError) {
            // Brief pause before retrying a failed stream; the error still
            // surfaces once the cap is hit with the task unfinished.
            await new Promise((resolve) => setTimeout(resolve, 2000));
            if (controller.signal.aborted) {
              cancelled = true;
              break;
            }
          }
          // On an error the failed input is resent — it may never have reached
          // the thread; otherwise a synthetic turn continues it (truncation
          // cuts get the chunking-specific instruction).
          if (!lastError) {
            input = {
              messages: [{ role: "user" as const, content: continuationPrompt(truncated) }],
            };
          }
        }
        if (lastError) throw lastError;
      }
    } catch (err) {
      if (controller.signal.aborted) {
        cancelled = true;
      } else {
        failedMessage = err instanceof Error ? err.message : String(err);
        throw err;
      }
    } finally {
      const wasUnattended = this.unattended;
      this.normalizeOnEnd();
      if (session) {
        try { await session.dispose(); } catch { /* best-effort */ }
      }
      this.inputResolverRef = null;
      this.approvalResolvers.clear();
      this.abortRef = null;
      this.isRunning = false;
      this.unattended = false;
      this.pendingInput = null;
      // NOTE: pendingSuggestion survives run end (see resetState) — only an
      // explicit connect/dismiss (dismissSuggestion) clears the card.
      this.pendingApprovals = [];
      setRetrievedDocIds([]);
      // The run changed (or added) chats/messages/files — re-index shortly.
      scheduleKnowledgeSweep();
      this.notify();
      registryNotify();
      // Background ping for interactive runs finishing while the window is
      // hidden (headless/scheduled runs notify from runHeadlessTask instead).
      if (!wasUnattended) {
        void notifyIfBackground(
          cancelled ? "Task stopped" : failedMessage ? "Task failed" : "Task finished",
          (failedMessage ?? this.contentRef ?? "Done.").slice(0, 200),
        );
      }
    }

    const finalActivities = Array.from(this.activitiesRef.values());
    const finalReasoningStreams = Array.from(this.reasoningStreamsRef.entries())
      .filter(([, s]) => s.text.length > 0)
      .map(([id, s]) => ({
        id,
        label: s.label,
        text: s.text,
        ms: s.endTime ? s.endTime - s.startTime : undefined,
        seq: s.seq,
      }));
    const todoActivities: ActivityItem[] = this.todosRef.map((t, i) => ({
      id: `todo-${i}`,
      kind: "todo",
      name: t.content,
      status: t.status === "completed" ? "done" : t.status === "in_progress" ? "running" : "pending" as ActivityItem["status"],
    }));

    const usageAgentId = opts.taskProfile?.sandbox?.agentId;
    if (usageAgentId && (this.contentRef || this.reasoningRef)) {
      // No provider reports token counts through this pipeline, so log a
      // chars/4 estimate (the usage chart labels values as estimated).
      // The sandbox id is set for every saved-agent run (interactive and
      // headless); plain chat/standalone runs have none and log nothing.
      recordAgentUsage(
        usageAgentId,
        estimateTokens(inputChars(opts.messages) + this.contentRef.length + this.reasoningRef.length),
      );
    }

    return {
      content: this.contentRef,
      reasoning: this.reasoningRef,
      reasoningMs: this.reasoningMsRef || undefined,
      reasoningStreams: finalReasoningStreams.length > 0 ? finalReasoningStreams : undefined,
      cancelled,
      interrupted: false,
      activities: [...finalActivities, ...todoActivities],
      todos: this.todosRef,
      artifacts: this.artifactsRef,
      files: this.filesRef.length > 0 ? [...this.filesRef] : undefined,
      completed: pipelineCompleted && !cancelled,
    };
  };

  submitInput = (values: Record<string, unknown>) => {
    this.inputResolverRef?.({ values });
    this.inputResolverRef = null;
    this.pendingInput = null;
    this.notify();
  };

  skipInput = () => {
    this.inputResolverRef?.({ cancelled: true });
    this.inputResolverRef = null;
    this.pendingInput = null;
    this.notify();
  };

  dismissSuggestion = () => {
    this.pendingSuggestion = null;
    this.notify();
  };

  approveCommand = (id: string) => {
    this.approvalResolvers.get(id)?.(true);
    this.settleApproval(id);
  };

  rejectCommand = (id: string) => {
    this.approvalResolvers.get(id)?.(false);
    this.settleApproval(id);
  };

  /** Remove a decided card (the resolver already fired and emitted its row). */
  private settleApproval(id: string) {
    this.approvalResolvers.delete(id);
    this.pendingApprovals = this.pendingApprovals.filter((p) => p.id !== id);
    this.notify();
  }

  stop = () => {
    if (this.inputResolverRef) {
      this.inputResolverRef({ cancelled: true });
      this.inputResolverRef = null;
    }
    // Deny every outstanding approval card, not just one.
    for (const resolve of this.approvalResolvers.values()) resolve(false);
    this.approvalResolvers.clear();
    this.pendingApprovals = [];
    this.abortRef?.abort();
  };
}

// ── Registry ──────────────────────────────────────────────────────────────
const controllers = new Map<string, AgentController>();
const registryListeners = new Set<() => void>();
let registryVersion = 0;
let runningIdsCache = new Set<string>();

function registryNotify() {
  const newRunning = new Set<string>();
  for (const [, ctrl] of controllers) {
    if (ctrl.isRunning) newRunning.add(ctrl.sessionId);
  }
  runningIdsCache = newRunning;
  registryVersion++;
  registryListeners.forEach((l) => l());
}

const noopSubscribe = () => () => {};
const noopSnapshot = () => 0;

export function getAgentController(sessionId: string): AgentController {
  let ctrl = controllers.get(sessionId);
  if (!ctrl) {
    ctrl = new AgentController(sessionId);
    controllers.set(sessionId, ctrl);
  }
  return ctrl;
}

export function disposeAgentController(sessionId: string) {
  const ctrl = controllers.get(sessionId);
  if (ctrl) {
    ctrl.stop();
    controllers.delete(sessionId);
    registryNotify();
  }
}

export function useAgentController(sessionId: string | null): AgentControllerApi | null {
  const ctrl = sessionId ? getAgentController(sessionId) : null;
  useSyncExternalStore(ctrl?.subscribe ?? noopSubscribe, ctrl?.getSnapshot ?? noopSnapshot);
  return ctrl;
}

export function useRunningSessionIds(): Set<string> {
  useSyncExternalStore(
    (fn) => {
      registryListeners.add(fn);
      return () => { registryListeners.delete(fn); };
    },
    () => registryVersion,
  );
  return runningIdsCache;
}

// Re-exported for backward compatibility (legacy callers).
export function useDeepAgent(): AgentControllerApi {
  const ctrl = useAgentController("__global__");
  return ctrl ?? getAgentController("__global__");
}
