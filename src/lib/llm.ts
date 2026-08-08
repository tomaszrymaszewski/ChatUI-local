import { supabase } from "@/lib/supabase";
import type { Provider, ProviderModel } from "@/types";
import type { ToolDefinition, ToolCall } from "@/lib/tools";
import { executeTool } from "@/lib/tools";

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export async function fetchProviders(): Promise<Provider[]> {
  const { data, error } = await supabase
    .from("providers")
    .select("id, name, base_url, models, vault_secret_id")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.base_url,
    models: parseModels(p.models),
    hasKey: p.vault_secret_id != null,
  }));
}

// Older rows may store models as a JSON-encoded string instead of an array.
function parseModels(raw: unknown): ProviderModel[] {
  if (Array.isArray(raw)) return raw as ProviderModel[];
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ProviderModel[];
    } catch {
      // fall through
    }
  }
  return [];
}

export async function createProvider(
  name: string,
  baseUrl: string,
  apiKey: string,
  models: ProviderModel[]
): Promise<void> {
  const { error } = await supabase.rpc("create_provider", {
    p_name: name,
    p_base_url: baseUrl,
    p_api_key: apiKey,
    p_models: models,
  });

  if (error) throw error;
}

export async function updateProvider(
  providerId: string,
  name: string,
  baseUrl: string,
  apiKey: string,
  models: ProviderModel[]
): Promise<void> {
  const { error } = await supabase.rpc("update_provider", {
    p_provider_id: providerId,
    p_name: name,
    p_base_url: baseUrl,
    p_api_key: apiKey,
    p_models: models,
  });

  if (error) throw error;
}

export async function deleteProvider(providerId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_provider", {
    p_provider_id: providerId,
  });

  if (error) throw error;
}

export async function getProviderApiKey(
  providerId: string
): Promise<string> {
  const { data, error } = await supabase.rpc("get_provider_api_key", {
    p_provider_id: providerId,
  });

  if (error) throw error;
  return data as string;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
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
): AsyncGenerator<StreamChunk> {
  const apiKey = await getProviderApiKey(provider.id);
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  let currentMessages = [...messages];

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

export async function generateChatTitle(
  provider: Provider,
  model: string,
  userMessage: string,
  assistantResponse: string,
): Promise<string> {
  const apiKey = await getProviderApiKey(provider.id);
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "Generate a short title (maximum 3 words) for this conversation based on the user's question and the assistant's response. Respond with ONLY the title, no quotes, no punctuation, no explanation.",
        },
        {
          role: "user",
          content: `User: ${userMessage}\n\nAssistant: ${assistantResponse.slice(0, 500)}`,
        },
      ],
    }),
  });

  if (!response.ok) return "";

  const data = await response.json();
  const title = data.choices?.[0]?.message?.content?.trim();
  if (!title) return "";
  return title.replace(/["'\n.]/g, "").slice(0, 50);
}
