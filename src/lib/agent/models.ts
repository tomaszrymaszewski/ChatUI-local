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
/**
 * Host fragment of Google's OpenAI-compatible endpoint. Only requests to
 * this host get thought-signature handling — every other provider sees
 * byte-identical bodies to before.
 */
const GEMINI_OPENAI_HOST = "generativelanguage.googleapis.com";

/**
 * Google-documented bypass for thought-signature validation: when a
 * functionCall part has no captured signature (parallel-call tails, history
 * replayed without one), sending base64("skip_thought_signature_validator")
 * keeps the request valid instead of 400ing with "Function call is missing
 * a thought_signature in functionCall parts".
 */
export const GEMINI_SKIP_THOUGHT_SIGNATURE = "c2tpcF90aG91Z2h0X3NpZ25hdHVyZV92YWxpZGF0b3I=";

/** Cap on remembered signatures so long sessions can't grow this map forever. */
const MAX_THOUGHT_SIGNATURES = 1000;

/**
 * Real thought signatures captured from Gemini responses, keyed by tool-call
 * id. Gemini attaches the signature to the FIRST tool call of a response, so
 * parallel calls after it have none — those (and ids never seen, e.g. from
 * history replay) fall back to GEMINI_SKIP_THOUGHT_SIGNATURE at send time.
 */
const geminiThoughtSignatures = new Map<string, string>();

/** Forgets captured signatures (tests). */
export function clearGeminiThoughtSignatures(): void {
  geminiThoughtSignatures.clear();
}

function rememberThoughtSignature(id: string, sig: unknown): void {
  if (typeof id !== "string" || !id || typeof sig !== "string" || !sig) return;
  geminiThoughtSignatures.set(id, sig);
  if (geminiThoughtSignatures.size > MAX_THOUGHT_SIGNATURES) {
    const oldest = geminiThoughtSignatures.keys().next().value;
    if (oldest !== undefined) geminiThoughtSignatures.delete(oldest);
  }
}

function signatureOfToolCall(tc: unknown): string | null {
  if (!tc || typeof tc !== "object") return null;
  const extra = (tc as { extra_content?: { google?: { thought_signature?: unknown } } }).extra_content;
  const nested = extra?.google?.thought_signature;
  if (typeof nested === "string" && nested) return nested;
  const top = (tc as { thought_signature?: unknown }).thought_signature;
  return typeof top === "string" && top ? top : null;
}

/**
 * Ensures every assistant tool_call in an outgoing chat-completions body
 * carries a thought signature at Google's OpenAI-compat location
 * (extra_content.google.thought_signature): the captured real one when this
 * session saw it, the skip-validator sentinel otherwise. LangChain rebuilds
 * request tool_calls from its own message objects (which drop the field), so
 * without this the second turn of any Gemini thinking-model tool run 400s.
 * Pure (besides the capture map): unparseable bodies and bodies without
 * assistant tool_calls come back unchanged. Exported for tests.
 */
export function injectGeminiThoughtSignatures(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  const messages = (parsed as { messages?: unknown })?.messages;
  if (!Array.isArray(messages)) return body;
  let changed = false;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as { role?: unknown; tool_calls?: unknown };
    if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
    for (const tc of msg.tool_calls) {
      if (!tc || typeof tc !== "object") continue;
      const existing = signatureOfToolCall(tc);
      const id = (tc as { id?: unknown }).id;
      if (existing) {
        if (typeof id === "string") rememberThoughtSignature(id, existing);
        continue;
      }
      const sig =
        (typeof id === "string" && geminiThoughtSignatures.get(id)) || GEMINI_SKIP_THOUGHT_SIGNATURE;
      const rec = tc as { extra_content?: { google?: Record<string, unknown> } };
      rec.extra_content = {
        ...(rec.extra_content ?? {}),
        google: { ...(rec.extra_content?.google ?? {}), thought_signature: sig },
      };
      changed = true;
    }
  }
  return changed ? JSON.stringify(parsed) : body;
}

/**
 * Records thought signatures from a Gemini chat-completions response body —
 * one JSON object (non-streaming) or SSE `data:` lines (streaming deltas).
 * Streaming ids arrive on the first chunk per index while the signature can
 * ride a later chunk for the same index, so index→id is tracked per body.
 * Never throws. Exported for tests.
 */
export function captureGeminiThoughtSignatures(text: string): void {
  const payloads: unknown[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      payloads.push(JSON.parse(trimmed));
    } catch {
      return;
    }
  } else {
    for (const line of text.split("\n")) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        payloads.push(JSON.parse(data));
      } catch {
        // keep-alive comments and partial lines carry nothing
      }
    }
  }
  const idByIndex = new Map<number, string>();
  const pendingSigByIndex = new Map<number, string>();
  const handle = (tc: unknown) => {
    if (!tc || typeof tc !== "object") return;
    const rec = tc as { id?: unknown; index?: unknown };
    const idx = typeof rec.index === "number" ? rec.index : null;
    const id = typeof rec.id === "string" && rec.id ? rec.id : null;
    if (idx !== null && id) {
      idByIndex.set(idx, id);
      const pending = pendingSigByIndex.get(idx);
      if (pending) {
        rememberThoughtSignature(id, pending);
        pendingSigByIndex.delete(idx);
      }
    }
    const sig = signatureOfToolCall(tc);
    if (!sig) return;
    if (id) rememberThoughtSignature(id, sig);
    else if (idx !== null) {
      const known = idByIndex.get(idx);
      if (known) rememberThoughtSignature(known, sig);
      else pendingSigByIndex.set(idx, sig);
    }
  };
  for (const p of payloads) {
    const choices = (p as { choices?: unknown })?.choices;
    if (!Array.isArray(choices)) continue;
    for (const c of choices) {
      if (!c || typeof c !== "object") continue;
      const choice = c as { delta?: { tool_calls?: unknown }; message?: { tool_calls?: unknown } };
      const tcs = choice.delta?.tool_calls ?? choice.message?.tool_calls;
      if (Array.isArray(tcs)) for (const tc of tcs) handle(tc);
    }
  }
}

/** Reads the request URL out of any fetch input shape. */
function fetchInputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return "";
}

/**
 * Pumps a Gemini response stream in the background, recording thought
 * signatures for later requests. Never rejects.
 */
async function tapGeminiThoughtSignatures(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await captureGeminiThoughtSignatures(await new Response(stream).text());
  } catch {
    // capture is best-effort — a missed signature just means the sentinel
  }
}

export const corsSafeFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  for (const key of Array.from(headers.keys())) {
    const k = key.toLowerCase();
    if (k.startsWith("x-stainless-") || k === "user-agent") headers.delete(key);
  }
  const gemini = fetchInputUrl(input).includes(GEMINI_OPENAI_HOST);
  let body = init?.body;
  if (gemini && typeof body === "string") {
    const patched = injectGeminiThoughtSignatures(body);
    if (patched !== body) body = patched;
  }
  const res = await fetch(input, body !== init?.body ? { ...init, headers, body } : { ...init, headers });
  if (gemini && res.ok && res.body) {
    const [forward, tap] = res.body.tee();
    void tapGeminiThoughtSignatures(tap);
    return new Response(forward, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  return res;
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
