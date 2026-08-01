export type MessageRole = "user" | "assistant";

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
  attachments?: MessageAttachment[];
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: Date;
}
