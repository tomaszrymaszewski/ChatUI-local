import type { ToolDefinition, ToolCall } from "@/lib/tools";
import { executeTool } from "@/lib/tools";

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface StreamChunk {
  content?: string;
  reasoning?: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
  tool_use_id?: string;
  content?: string;
  source?: { type: string; media_type: string; data: string };
}

function isAnthropicProvider(baseUrl: string): boolean {
  return baseUrl.includes("anthropic.com");
}

function toAnthropicContent(content: string | ContentPart[]): string | AnthropicContentBlock[] {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text ?? "" } as AnthropicContentBlock;
    if (part.type === "image_url" && part.image_url) {
      const match = part.image_url.url.match(/^data:(.+?);base64,(.+)$/);
      if (match) {
        return {
          type: "image",
          source: { type: "base64", media_type: match[1], data: match[2] },
        } as AnthropicContentBlock;
      }
      return { type: "text", text: "[image]" } as AnthropicContentBlock;
    }
    return { type: "text", text: "" } as AnthropicContentBlock;
  });
}

function extractText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
}

/** Convert OpenAI-style messages into Anthropic messages + system string. */
function convertMessages(
  messages: ChatMessage[],
  systemPrompt?: string | null,
): { system: string; messages: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }> } {
  const systemParts: string[] = [];
  if (systemPrompt) systemParts.push(systemPrompt);

  const result: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }> = [];
  let pendingToolResults: AnthropicContentBlock[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      result.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = extractText(msg.content);
      if (text) systemParts.push(text);
      continue;
    }
    if (msg.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: msg.tool_call_id,
        content: typeof msg.content === "string" ? msg.content : extractText(msg.content),
      });
      continue;
    }
    flushToolResults();
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const blocks: AnthropicContentBlock[] = [];
      const text = extractText(msg.content);
      if (text) blocks.push({ type: "text", text });
      for (const tc of msg.tool_calls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      result.push({ role: "assistant", content: blocks });
    } else {
      result.push({ role: msg.role as "user" | "assistant", content: toAnthropicContent(msg.content) });
    }
  }
  flushToolResults();

  return { system: systemParts.join("\n\n"), messages: result };
}

function convertTools(tools: ToolDefinition[]): Array<{ name: string; description: string; input_schema: unknown }> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

export async function* streamAnthropicCompletion(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  tools: ToolDefinition[] | undefined,
  systemPrompt: string | null,
): AsyncGenerator<StreamChunk> {
  const url = `${baseUrl.replace(/\/$/, "")}/messages`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };

  let currentMessages = [...messages];
  const anthropicTools = tools && tools.length > 0 ? convertTools(tools) : undefined;

  for (let round = 0; round < 6; round++) {
    const { system, messages: converted } = convertMessages(currentMessages, systemPrompt);
    const body: Record<string, unknown> = {
      model,
      max_tokens: round < 5 ? 4096 : 8192,
      messages: converted,
      stream: true,
    };
    if (system) body.system = system;
    if (anthropicTools && round < 5) body.tools = anthropicTools;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText || response.statusText}`);
    }
    if (!response.body) throw new Error("No response body from Anthropic");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const toolUseBlocks: Array<{ id: string; name: string; inputJson: string }> = [];
    const blockTypeByIndex = new Map<number, string>();
    const blockIdByIndex = new Map<number, string>();
    const blockNameByIndex = new Map<number, string>();
    const toolInputByIndex = new Map<number, string>();
    let stopReason = "end_turn";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          const lines = raw.split("\n");
          let eventType = "";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr = line.slice(6);
          }
          if (!dataStr) continue;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (eventType === "content_block_start") {
            const idx = data.index as number;
            const block = data.content_block as Record<string, unknown>;
            blockTypeByIndex.set(idx, (block?.type as string) ?? "text");
            if (block?.type === "tool_use") {
              blockIdByIndex.set(idx, block.id as string);
              blockNameByIndex.set(idx, block.name as string);
            }
          } else if (eventType === "content_block_delta") {
            const idx = data.index as number;
            const delta = data.delta as Record<string, unknown>;
            const deltaType = delta?.type as string;
            if (deltaType === "text_delta" && delta.text) {
              text += delta.text as string;
              yield { content: delta.text as string };
            } else if (deltaType === "thinking_delta" && delta.thinking) {
              yield { reasoning: delta.thinking as string };
            } else if (deltaType === "input_json_delta" && delta.partial_json) {
              toolInputByIndex.set(idx, (toolInputByIndex.get(idx) ?? "") + (delta.partial_json as string));
            }
          } else if (eventType === "content_block_stop") {
            const idx = data.index as number;
            const type = blockTypeByIndex.get(idx);
            if (type === "tool_use") {
              toolUseBlocks.push({
                id: blockIdByIndex.get(idx) ?? "",
                name: blockNameByIndex.get(idx) ?? "",
                inputJson: toolInputByIndex.get(idx) ?? "{}",
              });
            }
          } else if (eventType === "message_delta") {
            const delta = data.delta as Record<string, unknown>;
            if (delta?.stop_reason) stopReason = delta.stop_reason as string;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (toolUseBlocks.length === 0 || stopReason !== "tool_use") {
      return;
    }

    // Append the assistant's tool_use response
    const assistantBlocks: AnthropicContentBlock[] = [];
    if (text) assistantBlocks.push({ type: "text", text });
    for (const tu of toolUseBlocks) {
      let input: unknown = {};
      try {
        input = JSON.parse(tu.inputJson);
      } catch {
        input = {};
      }
      assistantBlocks.push({ type: "tool_use", id: tu.id, name: tu.name, input });
    }
    currentMessages.push({
      role: "assistant",
      content: text,
      tool_calls: toolUseBlocks.map((tu) => ({
        id: tu.id,
        type: "function" as const,
        function: { name: tu.name, arguments: tu.inputJson },
      })),
    });

    // Execute tools
    const toolCallsTyped: ToolCall[] = toolUseBlocks.map((tu) => ({
      id: tu.id,
      name: tu.name,
      arguments: tu.inputJson,
    }));
    const results = await Promise.all(toolCallsTyped.map((tc) => executeTool(tc)));
    for (const result of results) {
      currentMessages.push({
        role: "tool",
        content: result.content,
        tool_call_id: result.tool_call_id,
      });
    }
  }
}

export { isAnthropicProvider };
