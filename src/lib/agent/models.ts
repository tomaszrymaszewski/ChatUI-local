import { ChatOpenAI } from "@langchain/openai";
import type { Provider } from "@/types";
import { getProviderApiKey } from "@/lib/llm";
import { getModelOutputLimit } from "@/lib/model-capabilities";

/**
 * Fallback max_tokens when the models.dev catalog doesn't know the model.
 * Without an explicit value the provider default applies, which can be
 * surprisingly small (e.g. DeepSeek defaults to 4096 output tokens) and
 * truncates long agent answers mid-stream.
 */
const FALLBACK_MAX_TOKENS = 8192;

/**
 * The OpenAI JS client (under ChatOpenAI) attaches X-Stainless-* telemetry
 * headers and a custom User-Agent to every request. Those extra headers
 * trigger CORS preflights that many OpenAI-compatible providers reject,
 * which surfaces as a bare "Connection error". The User-Agent is worse:
 * Chrome silently drops it (forbidden header), but WKWebView includes it in
 * the preflight's Access-Control-Request-Headers, providers don't allow it,
 * and the request dies with "Load failed" — in the Tauri app only. Strip
 * them so requests match a plain fetch with only Authorization + Content-Type
 * (what the pre-agent code sent).
 */
const corsSafeFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  for (const key of Array.from(headers.keys())) {
    const k = key.toLowerCase();
    if (k.startsWith("x-stainless-") || k === "user-agent") headers.delete(key);
  }
  return fetch(input, { ...init, headers });
};

/**
 * Build a LangChain chat model for one of the user's OpenAI-compatible
 * providers. Every provider in this app speaks the OpenAI chat-completions
 * wire format, so ChatOpenAI with a custom baseURL covers them all
 * (OpenRouter, LM Studio, Ollama /v1, vLLM, Fireworks, …).
 */
export async function createChatModel(
  provider: Provider,
  modelName: string,
): Promise<ChatOpenAI> {
  const apiKey = await getProviderApiKey(provider.id);
  const outputLimit = await getModelOutputLimit(provider, modelName).catch(() => null);
  return new ChatOpenAI({
    model: modelName,
    apiKey: apiKey || "no-key",
    configuration: {
      baseURL: provider.baseUrl.replace(/\/$/, ""),
      fetch: corsSafeFetch,
    },
    maxTokens: outputLimit ?? FALLBACK_MAX_TOKENS,
    maxRetries: 1,
    timeout: 300_000,
  });
}
