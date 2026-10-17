import type { ActivityItem, ReasoningStream, SharedFile, WorkSegment } from "@/lib/agent/types";
import type { Artifact } from "@/lib/artifacts";

export type MessageRole = "user" | "assistant" | "system";

export interface MessageAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Runtime-only image preview (blob URL) — dies on reload; rehydrated from storageId. */
  previewUrl?: string;
  /** Key into the IndexedDB file store — makes the attachment persist across restarts. */
  storageId?: string;
  /** Native absolute directory path; folders are passed to agent mode by path, never embedded. */
  folderPath?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  /** Last write time (epoch ms). Sync merges message records by this instead
   *  of the creation timestamp, so two contexts streaming into the same chat
   *  resolve deterministically instead of flip-flopping versions. */
  updatedAt?: number;
  model?: string;
  attachments?: MessageAttachment[];
  session_id?: string;
  parent_id?: string | null;
  is_temporary?: boolean;
  reasoning?: string;
  reasoningStreams?: ReasoningStream[];
  workStartedAt?: number;
  workEndedAt?: number;
  workDurationMs?: number;
  workSegments?: WorkSegment[];
  activities?: ActivityItem[];
  artifacts?: Artifact[];
  /** Files the agent shared for download (share_files tool). */
  files?: SharedFile[];
}

export interface ProjectFile {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Key into the IndexedDB file store (content persists across restarts). */
  storageId?: string;
}

export interface ProjectImage {
  id: string;
  name: string;
  /** Runtime-only blob URL — rehydrated from storageId after reload. */
  url?: string;
  /** Key into the IndexedDB file store. */
  storageId?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  files: ProjectFile[];
  images: ProjectImage[];
  directory?: string | null;
}

/** Composer mode for a chat session; "none" is the plain chat (see ChatView).
 *  "temporary" is legacy — temporary is a whole-chat flag (isTemporary) now,
 *  orthogonal to the mode. Kept in the union so old stored sessions parse. */
export type SessionChatMode =
  | "none"
  | "temporary"
  | "learn"
  | "research"
  | "council"
  | "task";

/**
 * Reasoning effort sent as reasoning_effort on chat-completions requests for
 * reasoning-capable models. "default" (unset) resolves to the model's middle
 * tier at send time — never the provider's often-off default; the other
 * values come from models.dev reasoning_options (e.g. none/low/high/xhigh/
 * max) and are validated against the model's catalog entry before send.
 */
export type ReasoningEffort = "default" | (string & {});

export interface ChatSession {
  id: string;
  title: string;
  /** Creation timestamp; older stored chats may only have updatedAt. */
  createdAt?: Date;
  updatedAt: Date;
  projectId?: string;
  type: "chat" | "agent";
  /** Whole-chat temporary flag: the conversation is forgotten on leave. */
  isTemporary?: boolean;
  /** Composer mode persisted per chat — learn mode stays on until turned off. */
  chatMode?: SessionChatMode;
  /** Reasoning effort persisted per chat — used for the session's runs. */
  reasoningEffort?: ReasoningEffort;
  /** The saved agent this session belongs to (type "agent" only; undefined = agent-builder setup chat — standalone tasks are type "chat" with chatMode "task"). */
  agentId?: string;
  /** True while this session is an agent-builder setup interview. */
  isSetup?: boolean;
  /**
   * Legacy: true for sessions moved from the Chat tab to the Agents tab back
   * when unassigned tasks lived there. type is "agent"; the chat sidebar
   * keeps listing them grayed out with a redirect notice. Nothing sets this
   * anymore — unassigned tasks are chat-tab task-mode sessions now.
   */
  movedToAgent?: boolean;
}

export interface AgentCapabilities {
  /** May run shell commands and delegate coding tasks (run_command / run_coding_task). */
  terminal: boolean;
  /** Deprecated: superseded by folder-based access (allowedFolders). Kept so legacy records parse. */
  files?: boolean;
  /** May use web search/fetch. */
  web: boolean;
  /** May operate the isolated Playwright browser for interactive web tasks. */
  computerUse: boolean;
}

export type AgentAvatarShape =
  | "circle"
  | "rounded-square"
  | "inverted-rounded-triangle"
  | "rounded-star"
  | "rounded-hexagon";

/** A knowledge file/image attached to a saved agent (bytes in IndexedDB). */
export interface AgentAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Key into the IndexedDB file store. */
  storageId?: string;
}

/** A user-defined sandboxed agent created via the agent builder. */
export interface AgentDefinition {
  id: string;
  name: string;
  /** One-line purpose shown in the sidebar. */
  purpose: string;
  /** Avatar face color (hex) — picked at creation, unique among agents. */
  color?: string;
  /** Face silhouette — picked at creation and synced with the agent definition. */
  shape?: AgentAvatarShape;
  /** The agent's own system prompt — besides skills/connectors, all it knows. */
  systemPrompt: string;
  /** Installed skill names this agent may use. */
  skills: string[];
  /** Connector ids (the app's connector store) this agent may use. */
  connectors: string[];
  capabilities: AgentCapabilities;
  /** Model name (from the providers list) this agent always runs on. undefined = the composer/global default. */
  model?: string;
  /** Deprecated: own sessions are always readable now. Kept so legacy records parse. */
  readChats?: boolean;
  /** May read sessions that are not this agent's own (chats from the Chat tab, other agents' tasks): "all" | "selected" (undefined = off). */
  externalChats?: "all" | "selected";
  /** Session ids the agent may read when externalChats === "selected". */
  allowedExternalSessions?: string[];
  /** Absolute folder paths on the user's Mac this agent may access (plus its workspace). */
  allowedFolders?: string[];
  /** Project ids whose folders this agent may work in (ignored when allProjects). */
  allowedProjects?: string[];
  /** May work in every project's folder, including projects created later. */
  allProjects?: boolean;
  /** Knowledge files/images sent with every run of this agent. */
  attachments?: AgentAttachment[];
  createdAt: string;
  /** Last user- or agent-driven edit (bumped on every update; feeds cloud-sync merge). */
  updatedAt: string;
}

/**
 * The subset of an agent's settings the agent itself may change via chat
 * (update_agent tool; also carried on suggestion cards). Folder, project, and
 * attachment access stays user-only — an agent can never widen its own
 * filesystem sandbox.
 */
export interface AgentConfigPatch {
  name?: string;
  purpose?: string;
  systemPrompt?: string;
  /** Model name; undefined/null clears back to the global default. */
  model?: string | null;
  skills?: string[];
  connectors?: string[];
  terminal?: boolean;
  web?: boolean;
  files?: boolean;
}

export interface ProviderModel {
  id: string;
  name: string;
  displayName?: string;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  models: ProviderModel[];
  hasKey: boolean;
  builtinKey?: string;
}

export type BackgroundPattern = "none" | "lines" | "plus" | "dots";

/** How agent-mode tasks may run terminal commands on the user's machine. */
export type TerminalApproval = "ask" | "task" | "auto";

/** Optional OpenAI-compatible /v1/embeddings endpoint for the knowledge index. */
export interface EmbeddingEndpointConfig {
  /** e.g. "https://api.openai.com/v1" or "http://localhost:11434/v1" — /embeddings is appended. */
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/**
 * Which user-data source types the knowledge index may embed and expose to
 * the agent (skills and connectors are ALWAYS indexed — no toggles).
 * Disabling a type removes its docs from the index and hides them from both
 * auto-injection and the search_knowledge tool.
 */
export interface KnowledgeSourceToggles {
  chats: boolean;
  files: boolean;
  images: boolean;
  memories: boolean;
}

/** When a scheduled run fires. */
export type ScheduleCadence = {
  kind: "daily" | "weekly" | "interval" | "once";
  /** "HH:MM" local time — daily/weekly fires at this time. */
  timeHHMM?: string;
  /** 0–6 (Sunday–Saturday) — weekly only. */
  weekdays?: number[];
  /** Minutes between runs — interval only. */
  intervalMinutes?: number;
  /** ISO timestamp — once only. */
  runAt?: string;
};

/** A scheduled prompt or workflow that runs an agent headlessly while the app is open. */
export interface AgentSchedule {
  id: string;
  name: string;
  /** The agent that runs this schedule; undefined = standalone task agent. */
  agentId?: string;
  /** The workflow to run; takes precedence over prompt when set. */
  workflowId?: string;
  /** The prompt sent to the agent (plain schedules only). */
  prompt?: string;
  cadence: ScheduleCadence;
  enabled: boolean;
  /** ISO timestamp of the next scheduled run; null when nothing is scheduled (a fired "once"). */
  nextRun: string | null;
  /** ISO timestamp of the last completed run. */
  lastRun?: string;
  /** Session holding the last run's transcript (agent tab, openable like any chat). */
  lastSessionId?: string;
  lastStatus?: "ok" | "error" | "missed";
}

/** One step of a workflow — a prompt run by an agent (or the standalone task agent). */
export interface WorkflowStep {
  /** Agent that runs the step; undefined = standalone task agent. */
  agentId?: string;
  /** The prompt for this step. `{{previous}}` injects the prior step's output. */
  prompt: string;
}

/** A linear agent workflow: steps run in order, each may reference the previous output. */
export interface AgentWorkflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  createdAt: string;
}

export interface UserSettings {
  defaultModel: string | null;
  sendOnEnter: boolean;
  showTimestamps: boolean;
  soundEffects: boolean;
  temporaryByDefault: boolean;
  autoMemory: boolean;
  nickname: string;
  instructions: string;
  embeddingModel: string;
  backgroundPattern: BackgroundPattern;
  terminalApproval: TerminalApproval;
  /** Embedder for the knowledge index; null = the local model above. */
  embeddingEndpoint: EmbeddingEndpointConfig | null;
  knowledgeEnabled: boolean;
  knowledgeSources: KnowledgeSourceToggles;
  /** Compress tool outputs and chat history via the local Headroom proxy. */
  contextCompression: boolean;
  /** Post a macOS notification when a background task finishes. */
  taskFinishNotifications: boolean;
  /** Show follow-up ghost text and starter-prompt suggestions. */
  promptSuggestions: boolean;
  /** Recommend which agent to use when starting an agent session. */
  agentSuggestions: boolean;
}
