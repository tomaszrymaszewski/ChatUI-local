import { useSyncExternalStore } from "react";
import type { Provider } from "@/types";
import type { Artifact } from "@/lib/artifacts";
import { DeepAgentSession, type AgentMessage } from "@/lib/agent/runtime";
import { runDeepResearch } from "@/lib/agent/deep-research";
import { runDiscuss } from "@/lib/agent/discuss";
import { loadUserSettings } from "@/hooks/use-user-settings";
import type {
  ActivityItem,
  AgentEvent,
  AgentMode,
  AgentRunResult,
  ApprovalRequest,
  ReasoningStream,
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
  /** All configured models (name → providerId), used by discuss mode for per-role model assignment. */
  availableModels?: Array<{ name: string; providerId: string; displayName?: string }>;
  /** All providers, used by discuss mode to resolve per-role model → ChatOpenAI. */
  providers?: Provider[];
  /** Agent-mode ("task") runs: which extra tools the run gets. */
  taskProfile?: {
    toolProfile: "task" | "setup";
    /** false withholds run_command/run_coding_task (sandboxed agents without terminal). */
    enableCommandTools?: boolean;
    /** true adds read_file/write_file (agents with the local-files capability). */
    enableFileTools?: boolean;
    /** Restrict skills to these names (sandboxed agents). */
    skillNames?: string[];
    /** Restrict MCP connectors to these opencode.json keys (sandboxed agents). */
    mcpNames?: string[];
  };
}

type InputResolution =
  | { cancelled: true }
  | { values: Record<string, unknown> };

type ApprovalResolution = { approved: boolean };

export interface AgentControllerApi {
  isRunning: boolean;
  streamingContent: string;
  streamingReasoning: string;
  activities: ActivityItem[];
  todos: TodoItem[];
  artifacts: Artifact[];
  pendingInput: StructuredInputRequest | null;
  pendingSuggestion: SuggestionRequest | null;
  pendingApproval: ApprovalRequest | null;
  reasoningStreams: ReasoningStream[];
  run: (opts: DeepAgentRunOptions) => Promise<AgentRunResult>;
  submitInput: (values: Record<string, unknown>) => void;
  skipInput: () => void;
  dismissSuggestion: () => void;
  approveCommand: () => void;
  rejectCommand: () => void;
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
  pendingInput: StructuredInputRequest | null = null;
  pendingSuggestion: SuggestionRequest | null = null;
  pendingApproval: ApprovalRequest | null = null;
  reasoningStreams: ReasoningStream[] = [];

  private version = 0;
  private listeners = new Set<() => void>();
  private notifyQueued = false;

  private contentRef = "";
  private reasoningRef = "";
  private activitiesRef = new Map<string, ActivityItem>();
  private todosRef: TodoItem[] = [];
  private artifactsRef: Artifact[] = [];
  private abortRef: AbortController | null = null;
  private inputResolverRef: ((r: InputResolution) => void) | null = null;
  private approvalResolverRef: ((approved: boolean) => void) | null = null;
  /** Session-level: the user approved one command in "task" approval mode. */
  private commandsApprovedForTask = false;
  private reasoningStartRef: number | null = null;
  private reasoningMsRef = 0;
  private reasoningStreamsRef = new Map<string, { text: string; label: string; startTime: number; endTime?: number; seq: number }>();
  /** Shared monotonic counter so activities and reasoning streams can be
   *  interleaved chronologically in the UI. */
  private seqCounter = 0;
  constructor(sessionId: string) {
    this.sessionId = sessionId;
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
    setTimeout(() => {
      this.reasoningStreamsNotifyQueued = false;
      this.publishReasoningStreams();
    }, 50);
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
            label: existing.label ?? event.activity.label,
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
      case "suggestion":
        this.pendingSuggestion = event.suggestion;
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
    this.reasoningStartRef = null;
    this.reasoningMsRef = 0;
    this.reasoningStreamsRef = new Map();
    this.seqCounter = 0;
    this.streamingContent = "";
    this.streamingReasoning = "";
    this.activities = [];
    this.todos = [];
    this.artifacts = [];
    this.pendingInput = null;
    this.pendingSuggestion = null;
    this.pendingApproval = null;
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
   * permissions). Applies the user's terminal-approval setting:
   * - "auto": approve immediately.
   * - "task": approve after the first approval in this session.
   * - "ask": show an approve/deny card every time.
   */
  private promptForApproval = (request: ApprovalRequest): Promise<ApprovalResolution> => {
    const mode = loadUserSettings().terminalApproval;
    if (mode === "auto" || (mode === "task" && this.commandsApprovedForTask)) {
      return Promise.resolve({ approved: true });
    }
    const label = request.command.split("\n")[0].slice(0, 60);
    this.emit({
      type: "activity",
      activity: {
        id: "command-approval",
        kind: "input",
        name: label,
        status: "running",
        label: "Waiting for your approval",
      },
    });
    this.pendingApproval = request;
    this.notify();
    return new Promise((resolve) => {
      this.approvalResolverRef = (approved: boolean) => {
        if (approved && mode === "task") this.commandsApprovedForTask = true;
        this.emit({
          type: "activity",
          activity: {
            id: "command-approval",
            kind: "input",
            name: label,
            status: "done",
            label: approved ? "Approved" : "Denied",
          },
        });
        resolve({ approved });
      };
    });
  };

  run = async (opts: DeepAgentRunOptions): Promise<AgentRunResult> => {
    this.resetState();
    this.isRunning = true;
    registryNotify();
    const controller = new AbortController();
    this.abortRef = controller;

    let cancelled = false;
    let pipelineCompleted = true;
    let session: DeepAgentSession | null = null;
    try {
      const mode = opts.mode ?? "chat";

      if (mode === "research") {
        const pipeline = await runDeepResearch(
          {
            provider: opts.provider,
            modelName: opts.modelName,
            messages: opts.messages,
            instructions: opts.instructions,
            webFetchEnabled: opts.webFetchEnabled,
            projectDir: opts.projectDir,
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
          },
          this.emit,
          controller.signal,
          this.promptForInput,
        );
        pipelineCompleted = pipeline.completed;
      } else {
        session = await DeepAgentSession.create({
          provider: opts.provider,
          modelName: opts.modelName,
          instructions: opts.instructions,
          mode: mode === "task" ? "task" : "chat",
          webFetchEnabled: opts.webFetchEnabled,
          projectDir: opts.projectDir,
          toolProfile: opts.taskProfile?.toolProfile,
          enableCommandTools: opts.taskProfile?.enableCommandTools,
          enableFileTools: opts.taskProfile?.enableFileTools,
          skillNames: opts.taskProfile?.skillNames,
          mcpNames: opts.taskProfile?.mcpNames,
        });

        await session.stream(
          session.firstInput(opts.messages),
          this.emit,
          controller.signal,
          this.promptForInput,
          this.promptForApproval,
        );
      }
    } catch (err) {
      if (controller.signal.aborted) {
        cancelled = true;
      } else {
        throw err;
      }
    } finally {
      this.normalizeOnEnd();
      if (session) {
        try { await session.dispose(); } catch { /* best-effort */ }
      }
      this.inputResolverRef = null;
      this.approvalResolverRef = null;
      this.abortRef = null;
      this.isRunning = false;
      this.pendingInput = null;
      this.pendingSuggestion = null;
      this.pendingApproval = null;
      this.notify();
      registryNotify();
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

  approveCommand = () => {
    this.approvalResolverRef?.(true);
    this.approvalResolverRef = null;
    this.pendingApproval = null;
    this.notify();
  };

  rejectCommand = () => {
    this.approvalResolverRef?.(false);
    this.approvalResolverRef = null;
    this.pendingApproval = null;
    this.notify();
  };

  stop = () => {
    if (this.inputResolverRef) {
      this.inputResolverRef({ cancelled: true });
      this.inputResolverRef = null;
    }
    if (this.approvalResolverRef) {
      this.approvalResolverRef(false);
      this.approvalResolverRef = null;
      this.pendingApproval = null;
    }
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
