import type { Provider } from "@/types";
import type { ContentPart } from "@/lib/llm";
import { getModelContextWindow } from "@/lib/model-capabilities";
import type { AgentMessage } from "./runtime";

const CHARS_PER_TOKEN = 4;
/** Reserved for system prompt + tool schemas + the model's reply. */
const OVERHEAD_RESERVE_TOKENS = 4096;
/** Local runtimes (Ollama/LM Studio) load small contexts by default. */
const LOCAL_FALLBACK_CONTEXT = 8192;
const DEFAULT_FALLBACK_CONTEXT = 32768;

function isLocalBaseUrl(baseUrl: string): boolean {
  const u = baseUrl.toLowerCase();
  return (
    u.includes("localhost") ||
    u.includes("127.0.0.1") ||
    u.includes("0.0.0.0") ||
    u.includes("[::1]")
  );
}

/**
 * How many estimated tokens of replayed conversation history to allow.
 * Uses the models.dev context limit when known, a conservative budget for
 * local runtimes, and a moderate default otherwise.
 */
export async function resolveHistoryBudget(
  provider: Provider,
  modelName: string,
): Promise<number> {
  const known = await getModelContextWindow(provider, modelName).catch(() => null);
  const contextWindow =
    known ?? (isLocalBaseUrl(provider.baseUrl) ? LOCAL_FALLBACK_CONTEXT : DEFAULT_FALLBACK_CONTEXT);
  return Math.max(1024, contextWindow - OVERHEAD_RESERVE_TOKENS);
}

export function estimateMessageTokens(
  message: { content: string | ContentPart[] },
): number {
  if (typeof message.content === "string") {
    return Math.ceil(message.content.length / CHARS_PER_TOKEN) + 4;
  }
  let total = 4;
  for (const part of message.content) {
    if (part.type === "image_url") {
      total += 1100;
    } else {
      total += Math.ceil((part.text?.length ?? 0) / CHARS_PER_TOKEN);
    }
  }
  return total;
}

/**
 * Drop the oldest messages so the estimated total fits the budget. The most
 * recent message is always kept, even if it alone exceeds the budget (the
 * provider's error will surface to the user instead of silent confusion).
 */
export function truncateMessagesToBudget(
  messages: AgentMessage[],
  budgetTokens: number,
): AgentMessage[] {
  const kept: AgentMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(messages[i]);
    if (kept.length > 0 && used + tokens > budgetTokens) break;
    kept.unshift(messages[i]);
    used += tokens;
  }
  return kept;
}
