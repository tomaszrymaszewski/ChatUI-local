import type { ActivityItem, ReasoningStream } from "@/lib/agent/types";
import type { Artifact } from "@/lib/artifacts";

export type MessageRole = "user" | "assistant" | "system";

export interface MessageAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  previewUrl?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  model?: string;
  attachments?: MessageAttachment[];
  session_id?: string;
  parent_id?: string | null;
  is_temporary?: boolean;
  reasoning?: string;
  reasoningStreams?: ReasoningStream[];
  activities?: ActivityItem[];
  artifacts?: Artifact[];
}

export interface ProjectFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface ProjectImage {
  id: string;
  name: string;
  url: string;
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

/** Composer mode for a chat session; "none" is the plain chat (see ChatView). */
export type SessionChatMode =
  | "none"
  | "temporary"
  | "learn"
  | "research"
  | "council";

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: Date;
  projectId?: string;
  type: "chat" | "agent";
  isTemporary?: boolean;
  /** Composer mode persisted per chat — learn mode stays on until turned off. */
  chatMode?: SessionChatMode;
  /** The saved agent this session belongs to (type "agent" only; undefined = standalone task). */
  agentId?: string;
  /** True while this session is an agent-builder setup interview. */
  isSetup?: boolean;
}

export interface AgentCapabilities {
  /** May run shell commands and delegate coding tasks (run_command / run_coding_task). */
  terminal: boolean;
  /** May read/write local files via read_file/write_file (each access user-approved). */
  files: boolean;
  /** May use web search/fetch. */
  web: boolean;
  /** Reserved for the computer-use phase (not implemented yet). */
  computerUse: boolean;
}

/** A user-defined sandboxed agent created via the agent builder. */
export interface AgentDefinition {
  id: string;
  name: string;
  /** One-line purpose shown in the sidebar. */
  purpose: string;
  /** The agent's own system prompt — besides skills/connectors, all it knows. */
  systemPrompt: string;
  /** Installed skill names this agent may use. */
  skills: string[];
  /** Connector config keys (opencode.json mcp.<id>) this agent may use. */
  connectors: string[];
  capabilities: AgentCapabilities;
  createdAt: string;
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
}
