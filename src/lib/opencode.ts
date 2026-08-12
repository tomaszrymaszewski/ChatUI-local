import { invoke } from "@tauri-apps/api/core";

// ─── Server config ────────────────────────────────────────────────────────

export interface OpenCodeServerConfig {
  url: string;
  password?: string;
}

const DEFAULT_CONFIG: OpenCodeServerConfig = {
  url: "http://localhost:4096",
};

export function getDefaultConfig(): OpenCodeServerConfig {
  return { ...DEFAULT_CONFIG };
}

function buildHeaders(config: OpenCodeServerConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.password) {
    headers["Authorization"] = `Basic ${btoa(`opencode:${config.password}`)}`;
  }
  return headers;
}

async function apiFetch<T>(
  config: OpenCodeServerConfig,
  path: string,
  options?: RequestInit & { query?: Record<string, string | undefined> },
): Promise<T> {
  let url = `${config.url}${path}`;
  if (options?.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null) params.set(k, v);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    ...options,
    headers: { ...buildHeaders(config), ...(options?.headers ?? {}) },
    signal: options?.signal ?? AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenCode API error: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Types (aligned with opencode server OpenAPI spec v1.18.x) ────────────

export interface Session {
  id: string;
  projectID: string;
  directory: string;
  parentID?: string;
  title: string;
  version: string;
  time: { created: number; updated: number; compacting?: number };
  share?: { url: string };
  summary?: {
    additions: number;
    deletions: number;
    files: number;
    diffs?: FileDiff[];
  };
}

export interface UserMessageInfo {
  id: string;
  sessionID: string;
  role: "user";
  time: { created: number };
  agent: string;
  model: { providerID: string; modelID: string };
  system?: string;
  tools?: Record<string, boolean>;
}

export interface AssistantMessageInfo {
  id: string;
  sessionID: string;
  role: "assistant";
  time: { created: number; completed?: number };
  parentID: string;
  modelID: string;
  providerID: string;
  mode: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  finish?: string;
  error?: { name: string; data: { message: string } };
}

export type MessageInfo = UserMessageInfo | AssistantMessageInfo;

export interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  time?: { start: number; end?: number };
}

export interface ReasoningPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
  time: { start: number; end?: number };
}

export interface FilePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}

export interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: {
    status: "pending" | "running" | "completed" | "error";
    input?: Record<string, unknown>;
    title?: string;
    output?: string;
    error?: string;
    metadata?: Record<string, unknown>;
    time?: { start: number; end?: number };
  };
}

export interface StepStartPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
}

export interface StepFinishPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason: string;
}

export interface SnapshotPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "snapshot";
  snapshot: string;
}

export interface PatchPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "patch";
  hash: string;
  files: string[];
}

export interface AgentPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "agent";
  name: string;
}

export interface RetryPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "retry";
  attempt: number;
  error: { name: string; data: { message: string; statusCode?: number } };
  time: { created: number };
}

export interface CompactionPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "compaction";
  auto: boolean;
}

export interface SubtaskPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "subtask";
  prompt: string;
  description: string;
  agent: string;
}

export type Part =
  | TextPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart
  | SubtaskPart;

export interface MessageEntry {
  info: MessageInfo;
  parts: Part[];
}

export interface Agent {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  builtIn: boolean;
  color?: string;
  maxSteps?: number;
}

export interface ModelCapabilities {
  temperature: boolean;
  reasoning: boolean;
  attachment: boolean;
  toolcall: boolean;
  input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean };
  output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean };
}

export interface Model {
  id: string;
  providerID: string;
  name: string;
  capabilities: ModelCapabilities;
  limit: { context: number; output: number };
  status: "alpha" | "beta" | "deprecated" | "active";
}

export interface ProviderInfo {
  id: string;
  name: string;
  source: string;
  models: Record<string, Model>;
}

export interface ConfigProviders {
  providers: ProviderInfo[];
  default: Record<string, string>;
}

export interface Permission {
  id: string;
  type: string;
  pattern?: string | string[];
  sessionID: string;
  messageID: string;
  callID?: string;
  title: string;
  metadata: Record<string, unknown>;
  time: { created: number };
}

export type McpStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string };

export interface LspStatus {
  id: string;
  name: string;
  root: string;
  status: "connected" | "error";
}

export interface Todo {
  id: string;
  content: string;
  status: string;
  priority: string;
}

export interface FileDiff {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

// ─── Events ───────────────────────────────────────────────────────────────

export interface Event {
  type: string;
  properties: Record<string, unknown>;
}

export interface GlobalEvent {
  directory: string;
  payload: Event;
}

export interface OpenCodeStatus {
  installed: boolean;
  serving: boolean;
  url: string;
}

export interface SessionMetadata {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  directory: string | null;
}

// ─── Model param helper ────────────────────────────────────────────────────

export interface ModelRef {
  providerID: string;
  modelID: string;
}

/** Parse a "providerID/modelID" string into the object the API expects. */
export function parseModelRef(value: string | null | undefined): ModelRef | undefined {
  if (!value) return undefined;
  const idx = value.indexOf("/");
  if (idx === -1) return undefined;
  return { providerID: value.slice(0, idx), modelID: value.slice(idx + 1) };
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.providerID}/${ref.modelID}`;
}

// ─── Prompt input parts ────────────────────────────────────────────────────

export interface TextPartInput {
  type: "text";
  text: string;
}

export interface FilePartInput {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}

export type PromptPart = TextPartInput | FilePartInput;

// ─── API functions ────────────────────────────────────────────────────────

export async function checkHealth(
  config: OpenCodeServerConfig,
): Promise<{ healthy: boolean; version: string }> {
  return apiFetch(config, "/global/health");
}

export async function listSessions(
  config: OpenCodeServerConfig,
  directory?: string,
): Promise<Session[]> {
  return apiFetch(config, "/session", { query: { directory } });
}

export async function createSession(
  config: OpenCodeServerConfig,
  title?: string,
  directory?: string,
): Promise<Session> {
  return apiFetch(config, "/session", {
    method: "POST",
    body: JSON.stringify({ title }),
    query: { directory },
  });
}

export async function deleteSession(
  config: OpenCodeServerConfig,
  id: string,
  directory?: string,
): Promise<boolean> {
  return apiFetch(config, `/session/${id}`, { method: "DELETE", query: { directory } });
}

export async function updateSessionTitle(
  config: OpenCodeServerConfig,
  id: string,
  title: string,
  directory?: string,
): Promise<Session> {
  return apiFetch(config, `/session/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
    query: { directory },
  });
}

export async function getSession(
  config: OpenCodeServerConfig,
  id: string,
  directory?: string,
): Promise<Session> {
  return apiFetch(config, `/session/${id}`, { query: { directory } });
}

export async function getMessages(
  config: OpenCodeServerConfig,
  sessionId: string,
  directory?: string,
): Promise<MessageEntry[]> {
  return apiFetch(config, `/session/${sessionId}/message`, { query: { directory } });
}

export interface PromptBody {
  messageID?: string;
  model?: ModelRef;
  agent?: string;
  noReply?: boolean;
  system?: string;
  tools?: Record<string, boolean>;
  parts: PromptPart[];
}

export async function sendMessageAsync(
  config: OpenCodeServerConfig,
  sessionId: string,
  body: PromptBody,
  directory?: string,
): Promise<void> {
  await apiFetch(config, `/session/${sessionId}/prompt_async`, {
    method: "POST",
    body: JSON.stringify(body),
    query: { directory },
  });
}

export async function abortSession(
  config: OpenCodeServerConfig,
  sessionId: string,
  directory?: string,
): Promise<boolean> {
  return apiFetch(config, `/session/${sessionId}/abort`, {
    method: "POST",
    query: { directory },
  });
}

export async function summarizeSession(
  config: OpenCodeServerConfig,
  sessionId: string,
  model: ModelRef,
  directory?: string,
): Promise<boolean> {
  return apiFetch(config, `/session/${sessionId}/summarize`, {
    method: "POST",
    body: JSON.stringify({ providerID: model.providerID, modelID: model.modelID }),
    query: { directory },
  });
}

export async function replyPermission(
  config: OpenCodeServerConfig,
  sessionId: string,
  permissionId: string,
  response: "once" | "always" | "reject",
  directory?: string,
): Promise<boolean> {
  return apiFetch(config, `/session/${sessionId}/permissions/${permissionId}`, {
    method: "POST",
    body: JSON.stringify({ response }),
    query: { directory },
  });
}

export async function getTodos(
  config: OpenCodeServerConfig,
  sessionId: string,
  directory?: string,
): Promise<Todo[]> {
  return apiFetch(config, `/session/${sessionId}/todo`, { query: { directory } });
}

export async function getSessionDiff(
  config: OpenCodeServerConfig,
  sessionId: string,
  directory?: string,
): Promise<FileDiff[]> {
  return apiFetch(config, `/session/${sessionId}/diff`, { query: { directory } });
}

export async function listAgents(
  config: OpenCodeServerConfig,
  directory?: string,
): Promise<Agent[]> {
  return apiFetch(config, "/agent", { query: { directory } });
}

export async function getConfigProviders(
  config: OpenCodeServerConfig,
  directory?: string,
): Promise<ConfigProviders> {
  return apiFetch(config, "/config/providers", { query: { directory } });
}

export async function getMcpStatus(
  config: OpenCodeServerConfig,
  directory?: string,
): Promise<Record<string, McpStatus>> {
  return apiFetch(config, "/mcp", { query: { directory } });
}

export interface McpAddBody {
  name: string;
  config:
    | { type: "local"; command: string[]; environment?: Record<string, string>; enabled?: boolean; timeout?: number }
    | { type: "remote"; url: string; enabled?: boolean; headers?: Record<string, string>; oauth?: unknown; timeout?: number };
}

export async function addMcpServer(
  config: OpenCodeServerConfig,
  body: McpAddBody,
  directory?: string,
): Promise<Record<string, McpStatus>> {
  return apiFetch(config, "/mcp", {
    method: "POST",
    body: JSON.stringify(body),
    query: { directory },
  });
}

export async function getLspStatus(
  config: OpenCodeServerConfig,
  directory?: string,
): Promise<LspStatus[]> {
  return apiFetch(config, "/lsp", { query: { directory } });
}

export async function getToolIds(
  config: OpenCodeServerConfig,
  directory?: string,
): Promise<string[]> {
  return apiFetch(config, "/experimental/tool/ids", { query: { directory } });
}

// ─── SSE event streams ─────────────────────────────────────────────────────

/** Subscribe to the global event stream (events for all directory instances). */
export function subscribeToGlobalEvents(
  config: OpenCodeServerConfig,
  onEvent: (event: GlobalEvent) => void,
  onError?: (error: Error) => void,
): () => void {
  return subscribeInternal(`${config.url}/global/event`, config, (e) => onEvent(e as GlobalEvent), onError);
}

/** Subscribe to the per-instance event stream (legacy fallback). */
export function subscribeToEvents(
  config: OpenCodeServerConfig,
  onEvent: (event: Event) => void,
  onError?: (error: Error) => void,
): () => void {
  return subscribeInternal(`${config.url}/event`, config, (e) => onEvent(e as Event), onError);
}

function subscribeInternal(
  url: string,
  config: OpenCodeServerConfig,
  onEvent: (event: unknown) => void,
  onError?: (error: Error) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    // Connection timeout: if the server doesn't respond within 10s, abort
    // so the caller's onError fires and can reconnect (instead of hanging forever).
    let connected = false;
    const connectTimer = setTimeout(() => {
      if (!connected) controller.abort();
    }, 10000);
    try {
      const res = await fetch(url, {
        headers: buildHeaders(config),
        signal: controller.signal,
      });
      connected = true;
      clearTimeout(connectTimer);
      if (!res.ok || !res.body) {
        throw new Error(`SSE connection failed: ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) {
          const dataLines = raw.split("\n").filter((l) => l.startsWith("data: "));
          if (dataLines.length === 0) continue;
          const dataStr = dataLines.map((l) => l.slice(6)).join("");
          try {
            const parsed = JSON.parse(dataStr);
            onEvent(parsed.payload ? parsed.payload : parsed);
          } catch {
            // skip malformed
          }
        }
      }
    } catch (err) {
      clearTimeout(connectTimer);
      if (!controller.signal.aborted) onError?.(err as Error);
    }
  })();

  return () => controller.abort();
}

// ─── Tauri command wrappers ────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  path: string;
  display_path: string;
}

export function opencodeStatus(): Promise<OpenCodeStatus> {
  return invoke<OpenCodeStatus>("opencode_status");
}

export function opencodeInstall(): Promise<void> {
  return invoke<void>("opencode_install");
}

export function opencodeServeStart(): Promise<void> {
  return invoke<void>("opencode_serve_start");
}

export function opencodeServeStop(): Promise<void> {
  return invoke<void>("opencode_serve_stop");
}

export function opencodeServerLog(): Promise<string> {
  return invoke<string>("opencode_server_log");
}

export function opencodeServeInDir(dir: string | null): Promise<void> {
  return invoke<void>("opencode_serve_in_dir", { dir });
}

export function createSubdirectory(parentPath: string, name: string): Promise<DirEntry> {
  return invoke<DirEntry>("create_subdirectory", { parentPath, name });
}

export function createProjectDirectory(name: string): Promise<DirEntry> {
  return invoke<DirEntry>("create_project_directory", { name });
}

export function listSubdirectories(parentPath: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_subdirectories", { parentPath });
}

export function listLocalSessions(): Promise<SessionMetadata[]> {
  return invoke<SessionMetadata[]>("list_local_sessions");
}

export function saveLocalSession(
  id: string,
  title: string,
  directory: string | null,
): Promise<SessionMetadata> {
  return invoke<SessionMetadata>("save_local_session", { id, title, directory });
}

export function deleteLocalSession(id: string): Promise<void> {
  return invoke<void>("delete_local_session", { id });
}

export function updateLocalSessionTitle(id: string, title: string): Promise<void> {
  return invoke<void>("update_local_session_title", { id, title });
}

export function runOpendcodeMcpAuth(name: string): Promise<string> {
  return invoke<string>("opencode_mcp_auth", { name });
}

export interface ScaffoldEvent {
  kind: "stdout" | "stderr" | "done" | "error";
  data: string;
}

export function runScaffold(directory: string, template: string): Promise<void> {
  return invoke<void>("run_scaffold", { directory, template });
}
