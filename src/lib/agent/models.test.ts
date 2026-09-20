import { describe, it, expect, vi, beforeEach } from "vitest";

// models.ts pulls getProviderApiKey (localStorage-backed) and the models.dev
// catalog (network) — replace both so the test runs hermetically in node.
vi.mock("@/lib/llm", () => ({ getProviderApiKey: async () => "test-key" }));
vi.mock("@/lib/model-capabilities", () => ({ getModelOutputLimit: async () => 8192 }));

import {
  createChatModel,
  corsSafeFetch,
  injectGeminiThoughtSignatures,
  captureGeminiThoughtSignatures,
  clearGeminiThoughtSignatures,
  GEMINI_SKIP_THOUGHT_SIGNATURE,
} from "./models";
import type { Provider, ReasoningEffort } from "@/types";

const provider: Provider = {
  id: "test",
  name: "Test",
  baseUrl: "https://api.example.com/v1",
  models: [{ id: "glm-5.3", name: "glm-5.3" }],
  hasKey: true,
};

/** Builds a model and returns its modelKwargs — where reasoning_effort must land. */
async function effortKwargs(modelName: string, effort?: ReasoningEffort): Promise<Record<string, unknown>> {
  const model = await createChatModel(provider, modelName, effort);
  return model.modelKwargs ?? {};
}

describe("createChatModel reasoning_effort", () => {
  it("sends reasoning_effort for GLM on default (provider would otherwise think at max)", async () => {
    const kwargs = await effortKwargs("glm-5.3", "default");
    expect(kwargs.reasoning_effort).toBe("low");
  });

  it("maps GLM efforts onto the low/high/max enum the provider accepts", async () => {
    expect((await effortKwargs("glm-5.3", "low")).reasoning_effort).toBe("low");
    expect((await effortKwargs("glm-5.3", "medium")).reasoning_effort).toBe("high");
    expect((await effortKwargs("glm-5.3", "high")).reasoning_effort).toBe("max");
    expect((await effortKwargs("glm-5.3")).reasoning_effort).toBe("low");
  });

  it("sends nothing for non-GLM models on default (provider default applies)", async () => {
    const kwargs = await effortKwargs("gpt-4o", "default");
    expect(kwargs.reasoning_effort).toBeUndefined();
  });

  it("passes explicit non-GLM efforts through as reasoning_effort", async () => {
    expect((await effortKwargs("gpt-4o", "high")).reasoning_effort).toBe("high");
    expect((await effortKwargs("gpt-4o", "low")).reasoning_effort).toBe("low");
  });
});

function geminiBody(toolCalls: unknown[]): string {
  return JSON.stringify({
    model: "gemini-2.5-flash",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: toolCalls },
    ],
  });
}

function sigOf(body: string, id: string): unknown {
  const tcs = JSON.parse(body).messages[1].tool_calls as Array<{
    id: string;
    extra_content?: { google?: { thought_signature?: unknown } };
  }>;
  return tcs.find((t) => t.id === id)?.extra_content?.google?.thought_signature;
}

describe("Gemini thought signatures", () => {
  beforeEach(() => clearGeminiThoughtSignatures());

  it("backfills the skip-validator sentinel for unsigned parallel calls", () => {
    const out = injectGeminiThoughtSignatures(geminiBody([{ id: "a" }, { id: "b" }]));
    expect(sigOf(out, "a")).toBe(GEMINI_SKIP_THOUGHT_SIGNATURE);
    expect(sigOf(out, "b")).toBe(GEMINI_SKIP_THOUGHT_SIGNATURE);
  });

  it("leaves bodies without assistant tool calls byte-identical", () => {
    const plain = JSON.stringify({ model: "x", messages: [{ role: "user", content: "hi" }] });
    expect(injectGeminiThoughtSignatures(plain)).toBe(plain);
    expect(injectGeminiThoughtSignatures("not json")).toBe("not json");
  });

  it("captures real signatures from SSE deltas (id and signature on different chunks) and replays them", () => {
    captureGeminiThoughtSignatures(
      [
        `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_local_file"}}]}}]}`,
        `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"extra_content":{"google":{"thought_signature":"REAL_SIG"}}}]}}]}`,
        `data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"read_local_file"}}]}}]}`,
        "data: [DONE]",
      ].join("\n"),
    );
    const out = injectGeminiThoughtSignatures(geminiBody([{ id: "call_1" }, { id: "call_2" }]));
    expect(sigOf(out, "call_1")).toBe("REAL_SIG");
    expect(sigOf(out, "call_2")).toBe(GEMINI_SKIP_THOUGHT_SIGNATURE);
  });

  it("captures signatures from non-streaming JSON responses", () => {
    captureGeminiThoughtSignatures(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                { id: "n1", extra_content: { google: { thought_signature: "SIG_N" } } },
              ],
            },
          },
        ],
      }),
    );
    expect(sigOf(injectGeminiThoughtSignatures(geminiBody([{ id: "n1" }])), "n1")).toBe("SIG_N");
  });

  it("corsSafeFetch patches Gemini requests only, and still strips telemetry headers", async () => {
    const seen: Array<{ url: string; body: string; headers: Headers }> = [];
    const sse =
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","extra_content":{"google":{"thought_signature":"WIRE_SIG"}}}]}}]}\n` +
      "data: [DONE]\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { body?: unknown; headers?: unknown }) => {
        seen.push({
          url: String(input),
          body: String((init?.body as string) ?? ""),
          headers: new Headers(init?.headers as HeadersInit),
        });
        return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
      }),
    );
    try {
      const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      const otherUrl = "https://api.example.com/v1/chat/completions";
      const reqBody = geminiBody([{ id: "c1" }]);
      await corsSafeFetch(geminiUrl, {
        method: "POST",
        body: reqBody,
        headers: { "X-Stainless-Arch": "x64", "Content-Type": "application/json" },
      });
      // Let the background signature tap finish before the next request.
      await new Promise((r) => setTimeout(r, 25));
      expect(seen[0].headers.has("x-stainless-arch")).toBe(false);
      expect(sigOf(seen[0].body, "c1")).toBe(GEMINI_SKIP_THOUGHT_SIGNATURE);
      await corsSafeFetch(otherUrl, { method: "POST", body: reqBody });
      expect(seen[1].body).toBe(reqBody);
      await corsSafeFetch(geminiUrl, { method: "POST", body: reqBody });
      expect(sigOf(seen[2].body, "c1")).toBe("WIRE_SIG");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
