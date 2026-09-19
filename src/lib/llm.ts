import type { Provider, ProviderModel, UserSettings } from "@/types";
import { setItemOrThrowFriendly } from "./storage-pressure";
import type { ToolDefinition, ToolCall } from "@/lib/tools";
import { executeTool } from "@/lib/tools";
import { streamAnthropicCompletion, isAnthropicProvider } from "@/lib/providers/anthropic";

const STORAGE_KEY = "chatui:providers";

/** Fired whenever providers change (local edits and cloud-sync pulls). */
export const PROVIDERS_EVENT = "chatui:providers-changed";

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
  setItemOrThrowFriendly(STORAGE_KEY, JSON.stringify(providers));
  window.dispatchEvent(new Event(PROVIDERS_EVENT));
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
  models?: ProviderModel[],
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
    // Omitted models are preserved: editing a provider's name/URL/key must
    // never wipe its model list (models are managed via the model form).
    models: models ?? providers[idx].models,
    builtinKey: builtinKey ?? providers[idx].builtinKey,
  };
  saveProviders(providers);
}

export async function deleteProvider(providerId: string): Promise<void> {
  const providers = loadProviders().filter((p) => p.id !== providerId);
  if (providers.length === 0) {
    // Drop the key instead of storing `[]` so cloud sync propagates an
    // explicit delete (tombstone) — blank rows never overwrite populated data
    // on other devices (see sync.ts).
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(PROVIDERS_EVENT));
    return;
  }
  saveProviders(providers);
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

function loadUserSettings(): UserSettings | null {
  try {
    const raw = localStorage.getItem("chatui:settings");
    if (!raw) return null;
    return JSON.parse(raw) as UserSettings;
  } catch {
    return null;
  }
}

export function buildSystemPrompt(projectInstructions?: string, skillsContext?: string): string | null {
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
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
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

/** Cap a title at maxWords words, trimming trailing punctuation. */
export function capTitleWords(raw: string, maxWords = 4): string {
  const words = raw
    .replace(/["'\n]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  return words.join(" ").replace(/[.,;:!?]+$/, "").trim();
}

const TITLE_TRIGGER_PREFIXES = [
  "research",
  "teach me",
  "i want to learn",
  "discuss",
];

/**
 * Instant session title from the first user message: up to 4 words, stripped
 * of mode-trigger prefixes and punctuation, so the chat has a real title the
 * moment it starts (the LLM refines it in the background afterwards).
 */
export function instantChatTitle(text: string): string {
  let t = text.trim();
  if (!t) return "New Chat";
  const lower = t.toLowerCase();
  for (const prefix of TITLE_TRIGGER_PREFIXES) {
    if (lower.startsWith(prefix)) {
      t = t.slice(prefix.length);
      break;
    }
  }
  const title = capTitleWords(t, 4);
  if (!title) return "New Chat";
  return title.charAt(0).toUpperCase() + title.slice(1);
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
        "You are a title generator. Output ONLY a maximally short title (aim for 4 words or fewer) that captures the main topic of the conversation. Never cut off a name or phrase just to keep the title short. No explanation, no quotes, no punctuation, no full sentences.",
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
  // The budget must leave some room for reasoning (thinking models spend
  // tokens before any content is emitted — a tight cap returns empty content,
  // which silently keeps the instant title); if content stays empty, the
  // thinking process itself is an acceptable fallback source below.
  const tryRequest = async (maxField: string): Promise<Response> => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...baseBody, [maxField]: 500 }),
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

  // Trust the prompt for brevity — no word-count cutoff. Only clean up
  // formatting; the leak filter and the 50-char cap below stay as guards
  // against rambling models.
  const title = raw
    .replace(/["'\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/, "");
  if (!title || isTitleLeak(title)) return "";
  return title.slice(0, 50);
}

export interface FollowUpTranscriptEntry {
  role: string;
  content: string;
}

/** Recent exchanges folded into the follow-up prompt (capped in size). */
const FOLLOWUP_TAKE_MESSAGES = 8;
const FOLLOWUP_TAKE_CHARS = 400;

/**
 * Prompt asking for the user's most natural next message in this exact
 * conversation. Pure (tested) — the network call lives in
 * generateFollowUpSuggestion.
 */
export function buildFollowUpPrompt(
  transcript: FollowUpTranscriptEntry[],
  sessionTitle?: string,
): { system: string; user: string } {
  const system =
    "You suggest what the user should say next. Output ONLY one short follow-up message " +
    "(one sentence, under 20 words) written in the user's voice, continuing THIS conversation's " +
    "exact topic — names, places, code, and decisions mentioned. No quotes, no explanation, " +
    "no prefix. If nothing natural follows, output exactly NOTHING.";
  const lines = transcript
    .filter((m) => m.content.trim())
    .slice(-FOLLOWUP_TAKE_MESSAGES)
    .map(
      (m) =>
        `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content.trim().slice(0, FOLLOWUP_TAKE_CHARS)}`,
    );
  const user = [
    sessionTitle?.trim() ? `Chat title: ${sessionTitle.trim().slice(0, 80)}` : "",
    "Conversation:",
    ...lines,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { system, user };
}

const FOLLOWUP_LEAK_PHRASES = [
  "as an ai",
  "as a language model",
  "follow-up",
  "follow up suggestion",
  "here is",
  "here's a",
  "i'm sorry",
  "i cannot",
  "nothing",
];

/**
 * Clean raw model output into ghost text: first line only, no quotes or
 * speaker labels, capped. Returns "" when the model declined or leaked.
 */
export function cleanFollowUpSuggestion(raw: string, maxChars = 140): string {
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  const unquoted = firstLine.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  const unlabeled = unquoted
    .replace(/^(user|you|suggestion|follow-?up)\s*:\s*/i, "")
    .trim();
  const single = unlabeled.replace(/\s+/g, " ").trim();
  if (!single) return "";
  const lower = single.toLowerCase();
  if (FOLLOWUP_LEAK_PHRASES.some((p) => lower.includes(p))) return "";
  return single.slice(0, maxChars).trim();
}

/**
 * Prompt asking for tappable answers to the assistant's clarifying question.
 * Pure (tested) — the network call lives in generateQuestionOptions.
 */
export function buildQuestionOptionsPrompt(
  question: string,
  transcript: FollowUpTranscriptEntry[],
): { system: string; user: string } {
  const system =
    "The assistant just asked the user a clarifying question. Suggest 1-3 short likely " +
    "answers (each under 8 words) written in the user's voice, specific to THIS conversation. " +
    "Output ONLY a JSON array of strings, e.g. [\"Tomorrow morning\", \"Next week\"]. " +
    "If no natural answers exist, output exactly [].";
  const lines = transcript
    .filter((m) => m.content.trim())
    .slice(-FOLLOWUP_TAKE_MESSAGES)
    .map(
      (m) =>
        `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content.trim().slice(0, FOLLOWUP_TAKE_CHARS)}`,
    );
  return {
    system,
    user: [...lines, `Question: ${question.trim().slice(0, 800)}`].join("\n"),
  };
}

const OPTION_LEAK_PHRASES = [
  "as an ai",
  "as a language model",
  "here is",
  "here are",
  "i'm sorry",
  "i cannot",
  "it depends",
];

/**
 * Parse model output into 1-3 answer options: a JSON array when present,
 * otherwise one-per-line fallback (bullets, numbering, and quotes stripped).
 * Empty when nothing usable came back.
 */
export function parseQuestionOptions(raw: string, maxOptions = 3): string[] {
  const text = raw.trim();
  if (!text) return [];
  const cleanOne = (s: string): string =>
    s
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
      .replace(/^["'“”]+|["'“”.,;!]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const viable = (s: string): boolean => {
    if (!s || s.length > 80) return false;
    const lower = s.toLowerCase();
    return !OPTION_LEAK_PHRASES.some((p) => lower.includes(p));
  };
  // Prefer an embedded JSON array.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        const out: string[] = [];
        for (const item of parsed) {
          if (typeof item !== "string") continue;
          const c = cleanOne(item);
          if (viable(c) && !out.includes(c)) out.push(c);
          if (out.length >= maxOptions) break;
        }
        if (out.length > 0) return out;
      }
    } catch {
      // fall through to line parsing
    }
  }
  const out: string[] = [];
  for (const line of text.split("\n")) {
    // Skip fences and leftover brackets from a failed JSON parse.
    if (/^[\s[\]`]+$/.test(line)) continue;
    const c = cleanOne(line);
    if (viable(c) && !out.includes(c)) out.push(c);
    if (out.length >= maxOptions) break;
  }
  return out;
}

/**
 * Ask the model for tappable answers to the assistant's clarifying question.
 * Returns [] on any failure — callers simply show no chips.
 */
export async function generateQuestionOptions(
  provider: Provider,
  model: string,
  question: string,
  transcript: FollowUpTranscriptEntry[],
): Promise<string[]> {
  let apiKey: string;
  try {
    apiKey = await getProviderApiKey(provider.id);
  } catch {
    return [];
  }
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;
  const { system, user } = buildQuestionOptionsPrompt(question, transcript);
  const baseBody: Record<string, unknown> = {
    model,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  const tryRequest = async (maxField: string): Promise<Response> => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...baseBody, [maxField]: 300 }),
    });
  };
  let response: Response;
  try {
    response = await tryRequest("max_completion_tokens");
    if (!response.ok && response.status === 400) {
      response = await tryRequest("max_tokens");
    }
  } catch {
    return [];
  }
  if (!response.ok) return [];
  try {
    const data = await response.json();
    const raw =
      data.choices?.[0]?.message?.content?.trim() ||
      data.choices?.[0]?.message?.reasoning_content?.trim() ||
      "";
    return parseQuestionOptions(raw);
  } catch {
    return [];
  }
}

/**
 * Ask the model for the user's most personal next message in this
 * conversation. Returns "" on any failure (offline, no key, bad output) —
 * callers fall back to the heuristic suggestion.
 */
export async function generateFollowUpSuggestion(
  provider: Provider,
  model: string,
  transcript: FollowUpTranscriptEntry[],
  sessionTitle?: string,
): Promise<string> {
  const { system, user } = buildFollowUpPrompt(transcript, sessionTitle);
  let apiKey: string;
  try {
    apiKey = await getProviderApiKey(provider.id);
  } catch {
    return "";
  }
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;
  const baseBody: Record<string, unknown> = {
    model,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  // Same max-tokens dance as titles: newer reasoning models require
  // max_completion_tokens, older endpoints only know max_tokens.
  const tryRequest = async (maxField: string): Promise<Response> => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...baseBody, [maxField]: 300 }),
    });
  };
  let response: Response;
  try {
    response = await tryRequest("max_completion_tokens");
    if (!response.ok && response.status === 400) {
      response = await tryRequest("max_tokens");
    }
  } catch {
    return "";
  }
  if (!response.ok) return "";
  try {
    const data = await response.json();
    const raw =
      data.choices?.[0]?.message?.content?.trim() ||
      data.choices?.[0]?.message?.reasoning_content?.trim() ||
      "";
    return cleanFollowUpSuggestion(raw);
  } catch {
    return "";
  }
}

// ─── Tavily search API key (optional, stored in localStorage) ──────────────

const TAVILY_KEY_STORAGE = "chatui:tavily-key";

export function getTavilyApiKey(): string {
  try {
    return localStorage.getItem(TAVILY_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setTavilyApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(TAVILY_KEY_STORAGE, key);
    else localStorage.removeItem(TAVILY_KEY_STORAGE);
  } catch {
    // ignore storage errors
  }
}
