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

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: Date;
  projectId?: string;
  type: "chat" | "agent";
  isTemporary?: boolean;
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
}
