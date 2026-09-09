import { describe, it, expect, vi } from "vitest";
import { AIMessage, SystemMessage } from "langchain";
import { emptyResponseGuardMiddleware } from "./empty-response-guard";

/** Minimal ModelRequest stub — the guard only reads systemMessage/systemPrompt. */
function modelRequest(overrides: Record<string, unknown> = {}) {
  return {
    systemPrompt: "You are a helpful assistant.",
    systemMessage: new SystemMessage("You are a helpful assistant."),
    messages: [],
    ...overrides,
  } as never;
}

function reasoningOnly(reasoning = "let me think about this problem carefully") {
  return new AIMessage({
    content: "",
    additional_kwargs: { reasoning_content: reasoning },
  });
}

describe("emptyResponseGuardMiddleware", () => {
  it("passes a normal text response through without retrying", async () => {
    const handler = vi.fn(async () => new AIMessage({ content: "here is your answer" }));
    const result = await emptyResponseGuardMiddleware().wrapModelCall!(modelRequest(), handler);
    expect(String((result as AIMessage).content)).toBe("here is your answer");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("passes tool-call-only responses through without retrying", async () => {
    const handler = vi.fn(
      async () =>
        new AIMessage({
          content: "",
          tool_calls: [{ name: "web_fetch", args: { url: "https://example.com" }, id: "tc1" }],
        }),
    );
    const result = await emptyResponseGuardMiddleware().wrapModelCall!(modelRequest(), handler);
    expect((result as AIMessage).tool_calls).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("passes text content blocks through", async () => {
    const handler = vi.fn(
      async () => new AIMessage({ content: [{ type: "text", text: "blocked answer" }] }),
    );
    const result = await emptyResponseGuardMiddleware().wrapModelCall!(modelRequest(), handler);
    expect(result).toBeInstanceOf(AIMessage);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries an empty reasoning-only response and returns the recovered one", async () => {
    const handler = vi.fn()
      .mockResolvedValueOnce(reasoningOnly())
      .mockResolvedValueOnce(new AIMessage({ content: "recovered answer" }));
    const result = await emptyResponseGuardMiddleware().wrapModelCall!(modelRequest(), handler);
    expect(String((result as AIMessage).content)).toBe("recovered answer");
    expect(handler).toHaveBeenCalledTimes(2);
    // Retry carries the nudge appended to the system message.
    const retryRequest = handler.mock.calls[1][0] as { systemMessage: SystemMessage };
    expect(String(retryRequest.systemMessage.content)).toContain("cut off");
    expect(String(retryRequest.systemMessage.content)).toContain("You are a helpful assistant.");
    // The original request object is passed through untouched on the first call.
    const firstRequest = handler.mock.calls[0][0] as { systemMessage: SystemMessage };
    expect(String(firstRequest.systemMessage.content)).toBe("You are a helpful assistant.");
  });

  it("throws a visible error when every attempt comes back empty", async () => {
    const handler = vi.fn(async () => reasoningOnly());
    await expect(
      emptyResponseGuardMiddleware().wrapModelCall!(modelRequest(), handler),
    ).rejects.toThrow(/no visible output/i);
    expect(handler).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not stack nudges across retries", async () => {
    const handler = vi.fn()
      .mockResolvedValueOnce(reasoningOnly())
      .mockResolvedValueOnce(reasoningOnly())
      .mockResolvedValueOnce(new AIMessage({ content: "finally" }));
    await emptyResponseGuardMiddleware().wrapModelCall!(modelRequest(), handler);
    for (const call of handler.mock.calls.slice(1)) {
      const req = call[0] as { systemMessage: SystemMessage };
      const noteCount = (String(req.systemMessage.content).match(/cut off/g) ?? []).length;
      expect(noteCount).toBe(1);
    }
  });

  it("treats a fully empty response (no reasoning at all) as retryable", async () => {
    const handler = vi.fn()
      .mockResolvedValueOnce(new AIMessage({ content: "" }))
      .mockResolvedValueOnce(new AIMessage({ content: "ok now" }));
    const result = await emptyResponseGuardMiddleware().wrapModelCall!(modelRequest(), handler);
    expect(String((result as AIMessage).content)).toBe("ok now");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("falls back to systemPrompt when there is no system message", async () => {
    const request = modelRequest({ systemMessage: undefined, systemPrompt: "base prompt" });
    const handler = vi.fn()
      .mockResolvedValueOnce(reasoningOnly())
      .mockResolvedValueOnce(new AIMessage({ content: "done" }));
    await emptyResponseGuardMiddleware().wrapModelCall!(request, handler);
    const retryRequest = handler.mock.calls[1][0] as { systemPrompt: string };
    expect(retryRequest.systemPrompt).toContain("base prompt");
    expect(retryRequest.systemPrompt).toContain("cut off");
  });
});
