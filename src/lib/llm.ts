import type { Provider, ProviderModel, UserSettings } from "@/types";
import type { ToolDefinition, ToolCall } from "@/lib/tools";
import { executeTool } from "@/lib/tools";
import { streamAnthropicCompletion, isAnthropicProvider } from "@/lib/providers/anthropic";

const STORAGE_KEY = "chatui:providers";

interface StoredProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
  builtinKey?: string;
}

function loadProviders(): StoredProvider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredProvider[];
  } catch {
    return [];
  }
}

function saveProviders(providers: StoredProvider[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
}

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export async function fetchProviders(): Promise<Provider[]> {
  const stored = loadProviders();
  return stored.map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    models: p.models,
    hasKey: !!p.apiKey,
    builtinKey: p.builtinKey,
  }));
}

export async function createProvider(
  name: string,
  baseUrl: string,
  apiKey: string,
  models: ProviderModel[],
  builtinKey?: string,
): Promise<void> {
  const providers = loadProviders();
  const newProvider: StoredProvider = {
    id: crypto.randomUUID(),
    name,
    baseUrl,
    apiKey,
    models,
    builtinKey,
  };
  providers.push(newProvider);
  saveProviders(providers);
}

export async function updateProvider(
  providerId: string,
  name: string,
  baseUrl: string,
  apiKey: string,
  models: ProviderModel[],
  builtinKey?: string,
): Promise<void> {
  const providers = loadProviders();
  const idx = providers.findIndex((p) => p.id === providerId);
  if (idx === -1) throw new Error("Provider not found");
  providers[idx] = {
    ...providers[idx],
    name,
    baseUrl,
    apiKey: apiKey || providers[idx].apiKey,
    models,
    builtinKey: builtinKey ?? providers[idx].builtinKey,
  };
  saveProviders(providers);
}

export async function deleteProvider(providerId: string): Promise<void> {
  const providers = loadProviders();
  saveProviders(providers.filter((p) => p.id !== providerId));
}

export async function getProviderApiKey(
  providerId: string
): Promise<string> {
  const providers = loadProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("Provider not found");
  return provider.apiKey;
}

export async function fetchModelsFromApi(provider: Provider): Promise<string[]> {
  const apiKey = await getProviderApiKey(provider.id);
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/models`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch models (${response.status}): ${errorText || response.statusText}`
    );
  }

  const data = await response.json();
  const models: string[] = (data.data ?? []).map((m: { id: string }) => m.id);
  return models.sort();
}

export async function fetchOllamaModels(): Promise<string[]> {
  const response = await fetch("http://localhost:11434/api/tags");
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Ollama models (${response.status}). Is Ollama running?`
    );
  }
  const data = await response.json();
  const models: string[] = (data.models ?? []).map((m: { name: string }) => m.name);
  return models.sort();
}

export async function addModelToProvider(
  providerId: string,
  model: ProviderModel,
): Promise<void> {
  const providers = loadProviders();
  const idx = providers.findIndex((p) => p.id === providerId);
  if (idx === -1) throw new Error("Provider not found");
  if (providers[idx].models.some((m) => m.name === model.name)) {
    throw new Error("Model already exists for this provider");
  }
  providers[idx].models.push(model);
  saveProviders(providers);
}

export async function removeModelFromProvider(
  providerId: string,
  modelId: string,
): Promise<void> {
  const providers = loadProviders();
  const idx = providers.findIndex((p) => p.id === providerId);
  if (idx === -1) throw new Error("Provider not found");
  providers[idx].models = providers[idx].models.filter((m) => m.id !== modelId);
  saveProviders(providers);
}

export async function updateModelDisplayName(
  providerId: string,
  modelId: string,
  displayName: string,
): Promise<void> {
  const providers = loadProviders();
  const idx = providers.findIndex((p) => p.id === providerId);
  if (idx === -1) throw new Error("Provider not found");
  const modelIdx = providers[idx].models.findIndex((m) => m.id === modelId);
  if (modelIdx === -1) throw new Error("Model not found");
  providers[idx].models[modelIdx].displayName = displayName.trim() || undefined;
  saveProviders(providers);
}

const EXPORT_KEY_PREFIXES = ["chatui:messages:"];

const EXPORT_BASE_KEYS = [
  "chatui:providers",
  "chatui:settings",
  "chatui:projects",
  "chatui:sessions",
  "chatui_last_project_dir",
  "chatui_imported_dirs",
  "chatui_active_project_dir",
];

export function exportAllData(): string {
  const data: Record<string, string | null> = {};
  for (const key of EXPORT_BASE_KEYS) {
    data[key] = localStorage.getItem(key);
  }
  // Include all per-session message stores
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && EXPORT_KEY_PREFIXES.some((p) => key.startsWith(p))) {
      data[key] = localStorage.getItem(key);
    }
  }
  return JSON.stringify({ __chatui_export__: true, data, version: 2 }, null, 2);
}

export function importAllData(jsonString: string): void {
  const parsed = JSON.parse(jsonString);
  if (!parsed.__chatui_export__) {
    throw new Error("Invalid export file format");
  }
  const data = parsed.data as Record<string, string | null>;
  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  }
}

function loadUserSettings(): UserSettings | null {
  try {
    const raw = localStorage.getItem("chatui:settings");
    if (!raw) return null;
    return JSON.parse(raw) as UserSettings;
  } catch {
    return null;
  }
}

function buildSystemPrompt(projectInstructions?: string, skillsContext?: string): string | null {
  const settings = loadUserSettings();
  const parts: string[] = [];
  if (settings?.nickname?.trim()) {
    parts.push(`The user's preferred nickname is "${settings.nickname.trim()}". Use this name when addressing the user.`);
  }
  if (settings?.instructions?.trim()) {
    parts.push(`Instructions: ${settings.instructions.trim()}`);
  }
  if (projectInstructions?.trim()) {
    parts.push(`Project instructions: ${projectInstructions.trim()}`);
  }
  if (skillsContext?.trim()) {
    parts.push(skillsContext.trim());
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface StreamChunk {
  content?: string;
  reasoning?: string;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export async function* streamChatCompletion(
  provider: Provider,
  model: string,
  messages: ChatCompletionMessage[],
  signal?: AbortSignal,
  tools?: ToolDefinition[],
  projectInstructions?: string,
  skillsContext?: string,
): AsyncGenerator<StreamChunk> {
  const apiKey = await getProviderApiKey(provider.id);
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  let currentMessages = [...messages];

  const systemPrompt = buildSystemPrompt(projectInstructions, skillsContext);

  // Anthropic uses a different API shape — delegate to the dedicated adapter.
  if (isAnthropicProvider(provider.baseUrl)) {
    yield* streamAnthropicCompletion(
      apiKey,
      baseUrl,
      model,
      messages,
      signal,
      tools,
      systemPrompt,
    );
    return;
  }

  if (systemPrompt && currentMessages[0]?.role !== "system") {
    currentMessages = [{ role: "system", content: systemPrompt }, ...currentMessages];
  }

  for (let round = 0; round < 6; round++) {
    const body: Record<string, unknown> = {
      model,
      messages: currentMessages,
      stream: true,
    };
    if (tools && tools.length > 0 && round < 5) {
      body.tools = tools;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed (${response.status}): ${errorText || response.statusText}`
      );
    }

    if (!response.body) {
      throw new Error("No response body received from API");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let reasoning = "";
    const toolCallMap = new Map<number, AccumulatedToolCall>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (!trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              content += delta.content;
              yield { content: delta.content };
            }
            const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
            if (reasoningDelta) {
              reasoning += reasoningDelta;
              yield { reasoning: reasoningDelta };
            }

            const deltaToolCalls = delta.tool_calls;
            if (deltaToolCalls) {
              for (const tc of deltaToolCalls) {
                const idx = tc.index ?? 0;
                if (!toolCallMap.has(idx)) {
                  toolCallMap.set(idx, {
                    id: tc.id ?? "",
                    name: tc.function?.name ?? "",
                    arguments: tc.function?.arguments ?? "",
                  });
                } else {
                  const existing = toolCallMap.get(idx)!;
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name += tc.function.name;
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                }
              }
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls = Array.from(toolCallMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, tc]) => tc);

    if (toolCalls.length === 0) {
      return;
    }

    // Add the assistant message with tool calls to the conversation
    currentMessages.push({
      role: "assistant",
      content: content || "",
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Execute all tool calls
    const toolCallsTyped: ToolCall[] = toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    }));

    const results = await Promise.all(
      toolCallsTyped.map((tc) => executeTool(tc))
    );

    // Add tool result messages
    for (const result of results) {
      currentMessages.push({
        role: "tool",
        content: result.content,
        tool_call_id: result.tool_call_id,
      });
    }

    // Loop continues to make the follow-up request with tool results
  }
}

export { generateId };

const TITLE_LEAK_WORDS = [
  "generate",
  "title",
  "based on",
  "summarize",
  "summarise",
  "maximum",
  "respond",
  "output",
  "user:",
  "assistant:",
  "here is",
  "here's",
];

function isTitleLeak(title: string): boolean {
  const lower = title.toLowerCase();
  if (lower.split(/\s+/).length > 8) return true;
  return TITLE_LEAK_WORDS.some((w) => lower.includes(w));
}

export async function generateChatTitle(
  provider: Provider,
  model: string,
  userMessage: string,
  assistantResponse: string,
): Promise<string> {
  const apiKey = await getProviderApiKey(provider.id);
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const systemPrompt = buildSystemPrompt();
  const titleMessages = [
    {
      role: "system" as const,
      content:
        "You are a title generator. Output ONLY a 2-5 word title that captures the main topic of the conversation. No explanation, no quotes, no punctuation, no full sentences.",
    },
    {
      role: "user" as const,
      content: `User question: ${userMessage.slice(0, 300)}\n\nAssistant response: ${assistantResponse.slice(0, 500)}`,
    },
  ];
  if (systemPrompt) {
    titleMessages.unshift({ role: "system", content: systemPrompt });
  }

  const baseBody: Record<string, unknown> = {
    model,
    stream: false,
    messages: titleMessages,
  };

  // Try max_completion_tokens first (newer OpenAI/reasoning models require it),
  // fall back to max_tokens for broad OpenAI-compatible compatibility.
  const tryRequest = async (maxField: string): Promise<Response> => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...baseBody, [maxField]: 20 }),
    });
  };

  let response = await tryRequest("max_completion_tokens");
  if (!response.ok && response.status === 400) {
    response = await tryRequest("max_tokens");
  }
  if (!response.ok) return "";

  const data = await response.json();
  const raw =
    data.choices?.[0]?.message?.content?.trim() ||
    data.choices?.[0]?.message?.reasoning_content?.trim() ||
    "";
  if (!raw) return "";

  const title = raw.replace(/["'\n.]/g, "").trim();
  if (!title || isTitleLeak(title)) return "";
  return title.slice(0, 50);
}
