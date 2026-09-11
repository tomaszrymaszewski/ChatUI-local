import { ChatOpenAI } from "@langchain/openai";
import type { Provider, ReasoningEffort } from "@/types";
import { getProviderApiKey } from "@/lib/llm";
import { getModelOutputLimit } from "@/lib/model-capabilities";

/**
 * Fallback max_tokens when the models.dev catalog doesn't know the model.
 * Without an explicit value the provider default applies, which can be
 * surprisingly small (e.g. DeepSeek defaults to 4096 output tokens) and ends
 * runs mid-task or mid-thought with no error. 16k stays within the max output
 * of virtually every chat model while giving long answers and reasoning
 * models (whose thinking shares this budget) room to finish.
 */
const FALLBACK_MAX_TOKENS = 16384;

/**
 * Hard ceiling on the max_tokens we send for any model. Some catalog entries
 * report absurd output limits (models.dev listed z-ai/glm-5.3 on OpenRouter
 * at 943,718), which lets reasoning models think essentially forever; 64k
 * still allows very long answers while keeping runs finite.
 */
const MAX_OUTPUT_TOKENS_CAP = 65536;

/**
 * GLM models (z.ai): thinking is forced (GLM-5.3 cannot even disable it) and
 * its depth is controlled by reasoning_effort, which the provider defaults to
 * "max" — by far the longest thinking. The provider only accepts low/high/max
 * for GLM-5.3, so map the app's effort onto that enum and always send an
 * explicit value: default and low → "low" (shortest thinking unless the user
 * asks for more), medium → "high", high → "max".
 */
function glmReasoningEffort(effort: ReasoningEffort | undefined): "low" | "high" | "max" {
  if (effort === "high") return "max";
  if (effort === "medium") return "high";
  return "low";
}

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
  reasoningEffort?: ReasoningEffort,
): Promise<ChatOpenAI> {
  const apiKey = await getProviderApiKey(provider.id);
  const outputLimit = await getModelOutputLimit(provider, modelName).catch(() => null);
  const isGlm = /glm/i.test(modelName);
  const maxTokens = Math.min(
    outputLimit ?? (isGlm ? MAX_OUTPUT_TOKENS_CAP : FALLBACK_MAX_TOKENS),
    MAX_OUTPUT_TOKENS_CAP,
  );
  const effort = isGlm ? glmReasoningEffort(reasoningEffort) : reasoningEffort;
  return new ChatOpenAI({
    model: modelName,
    apiKey: apiKey || "no-key",
    configuration: {
      baseURL: provider.baseUrl.replace(/\/$/, ""),
      fetch: corsSafeFetch,
    },
    maxTokens,
    // ChatOpenAI's own reasoningEffort field is dead weight here: LangChain
    // only serializes it for OpenAI reasoning models (o-series, gpt-5*) and
    // reads the per-call option, never the constructor field. modelKwargs is
    // spread verbatim into the chat-completions body, so every OpenAI-
    // compatible provider actually sees reasoning_effort (OpenRouter and z.ai
    // both accept it flat). Reasoning-capable models only; others ignore it.
    ...(effort && effort !== "default"
      ? { modelKwargs: { reasoning_effort: effort as "low" | "medium" | "high" | "max" } }
      : {}),
    maxRetries: 1,
    timeout: 300_000,
  });
}
