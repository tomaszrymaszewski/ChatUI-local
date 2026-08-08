export interface OpenCodeServerConfig {
  url: string;
  password?: string;
}

export interface OCSession {
  id: string;
  title: string;
  time: { created: number; updated: number };
}

export interface OCMessage {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  time: { created: number; completed?: number };
  modelID?: string;
  providerID?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
  };
  error?: { name: string; data: { message: string } };
}

export interface OCPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  text?: string;
  tool?: string;
  state?: {
    status: string;
    title?: string;
    output?: string;
    error?: string;
  };
  time?: { start: number; end?: number };
}

export interface OCMessageEntry {
  info: OCMessage;
  parts: OCPart[];
}

export interface OCEvent {
  type: string;
  properties: Record<string, unknown>;
}

export interface OCAgent {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  builtIn: boolean;
}

export interface OCModel {
  id: string;
  providerID: string;
  name: string;
}

export interface OCProviderInfo {
  providers: Array<{
    id: string;
    name: string;
    models: Record<string, { id: string; name: string }>;
  }>;
  default: Record<string, string>;
}

const STORAGE_KEY = "opencode_server_config";

export function getStoredConfig(): OpenCodeServerConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveConfig(config: OpenCodeServerConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
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
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${config.url}${path}`, {
    ...options,
    headers: { ...buildHeaders(config), ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenCode API error: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function checkHealth(
  config: OpenCodeServerConfig
): Promise<{ healthy: boolean; version: string }> {
  return apiFetch(config, "/global/health");
}

export async function listSessions(
  config: OpenCodeServerConfig
): Promise<OCSession[]> {
  return apiFetch(config, "/session");
}

export async function createSession(
  config: OpenCodeServerConfig,
  title?: string
): Promise<OCSession> {
  return apiFetch(config, "/session", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function deleteSession(
  config: OpenCodeServerConfig,
  id: string
): Promise<boolean> {
  return apiFetch(config, `/session/${id}`, { method: "DELETE" });
}

export async function updateSessionTitle(
  config: OpenCodeServerConfig,
  id: string,
  title: string
): Promise<OCSession> {
  return apiFetch(config, `/session/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function getMessages(
  config: OpenCodeServerConfig,
  sessionId: string
): Promise<OCMessageEntry[]> {
  return apiFetch(config, `/session/${sessionId}/message`);
}

export async function sendMessageAsync(
  config: OpenCodeServerConfig,
  sessionId: string,
  text: string,
  agent?: string,
  model?: string
): Promise<void> {
  await apiFetch(config, `/session/${sessionId}/prompt_async`, {
    method: "POST",
    body: JSON.stringify({
      parts: [{ type: "text", text }],
      agent,
      model,
    }),
  });
}

export async function abortSession(
  config: OpenCodeServerConfig,
  sessionId: string
): Promise<boolean> {
  return apiFetch(config, `/session/${sessionId}/abort`, {
    method: "POST",
  });
}

export async function listAgents(
  config: OpenCodeServerConfig
): Promise<OCAgent[]> {
  return apiFetch(config, "/agent");
}

export async function getConfigProviders(
  config: OpenCodeServerConfig
): Promise<OCProviderInfo> {
  return apiFetch(config, "/config/providers");
}

export function subscribeToEvents(
  config: OpenCodeServerConfig,
  onEvent: (event: OCEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${config.url}/event`, {
        headers: buildHeaders(config),
        signal: controller.signal,
      });

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
          const dataLines = raw
            .split("\n")
            .filter((l) => l.startsWith("data: "));

          if (dataLines.length === 0) continue;

          const dataStr = dataLines.map((l) => l.slice(6)).join("");

          try {
            const parsed = JSON.parse(dataStr);
            const event: OCEvent = parsed.payload
              ? parsed.payload
              : parsed;
            onEvent(event);
          } catch {
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        onError?.(err as Error);
      }
    }
  })();

  return () => controller.abort();
}
