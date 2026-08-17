import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../llm", () => ({
  streamChatCompletion: vi.fn(),
}));

import { streamChatCompletion } from "../../llm";
import { createAppModelPort, DEFAULT_MODEL_TIMEOUT_MS } from "./appModelPort";
import type { Provider } from "../../../types";
import type { ModelTurnRequest } from "../loop/researchLoop";

const mockedStream = vi.mocked(streamChatCompletion);

function fakeProvider(): Provider {
  return {
    id: "p1",
    name: "Test Provider",
    baseUrl: "https://api.example.com/v1",
    models: [{ id: "m1", name: "test-model" }],
    hasKey: true,
  };
}

function fakeRequest(): ModelTurnRequest {
  return { systemPrompt: "SYSTEM INSTRUCTIONS", userPrompt: "USER TURN CONTEXT" };
}

async function* simpleGenerator(chunks: Array<{ content?: string; reasoning?: string }>) {
  for (const c of chunks) yield c;
}

// A signal-aware hanging generator: yields once, then suspends until its OWN signal argument
// aborts — mirrors how a real fetch-backed stream behaves. Must check `signal.aborted`
// synchronously before attaching a listener, since the signal may already be aborted by the
// time this resumes (same race Stage 1/2 already had to handle for their own timeout tests).
async function* hangingGenerator(signal: AbortSignal) {
  yield { content: "partial " };
  await new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

beforeEach(() => {
  mockedStream.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("appModelPort: createAppModelPort", () => {
  it("assembles multiple content chunks into one string, excluding reasoning chunks", async () => {
    mockedStream.mockImplementation(() => simpleGenerator([{ content: "foo" }, { reasoning: "thinking..." }, { content: "bar" }]));
    const port = createAppModelPort(fakeProvider(), "test-model");

    const result = await port.complete(fakeRequest(), new AbortController().signal);

    expect(result).toBe("foobar");
  });

  it("passes systemPrompt via skillsContext, userPrompt as the sole message, and omits tools", async () => {
    mockedStream.mockImplementation(() => simpleGenerator([{ content: "ok" }]));
    const port = createAppModelPort(fakeProvider(), "test-model");

    await port.complete(fakeRequest(), new AbortController().signal);

    expect(mockedStream).toHaveBeenCalledTimes(1);
    const call = mockedStream.mock.calls[0];
    expect(call[2]).toEqual([{ role: "user", content: "USER TURN CONTEXT" }]);
    expect(call[4]).toBeUndefined(); // tools
    expect(call[5]).toBeUndefined(); // projectInstructions
    expect(call[6]).toBe("SYSTEM INSTRUCTIONS"); // skillsContext
  });

  it("rejects with a clean message when the caller's signal aborts mid-stream", async () => {
    mockedStream.mockImplementation((_provider, _model, _messages, signal) => hangingGenerator(signal as AbortSignal));
    const port = createAppModelPort(fakeProvider(), "test-model");
    const controller = new AbortController();

    const promise = port.complete(fakeRequest(), controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow("Model request was cancelled");
  });

  it("rejects with the exact timeout message when the internal timeout elapses, even if the caller's signal never aborts", async () => {
    vi.useFakeTimers();
    mockedStream.mockImplementation((_provider, _model, _messages, signal) => hangingGenerator(signal as AbortSignal));
    const port = createAppModelPort(fakeProvider(), "test-model", { timeoutMs: 5000 });

    const promise = port.complete(fakeRequest(), new AbortController().signal);
    const assertion = expect(promise).rejects.toThrow("Model request timed out after 5000ms");
    await vi.advanceTimersByTimeAsync(5001);

    await assertion;
  });

  it("propagates a clean error when the underlying generator throws directly", async () => {
    mockedStream.mockImplementation(async function* () {
      throw new Error("boom");
    });
    const port = createAppModelPort(fakeProvider(), "test-model");

    await expect(port.complete(fakeRequest(), new AbortController().signal)).rejects.toThrow("Model request failed: boom");
  });

  it("short-circuits without calling streamChatCompletion when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const port = createAppModelPort(fakeProvider(), "test-model");

    await expect(port.complete(fakeRequest(), controller.signal)).rejects.toThrow("Model request was cancelled");
    expect(mockedStream).not.toHaveBeenCalled();
  });

  it("defaults to DEFAULT_MODEL_TIMEOUT_MS when no timeoutMs option is given", async () => {
    vi.useFakeTimers();
    mockedStream.mockImplementation((_provider, _model, _messages, signal) => hangingGenerator(signal as AbortSignal));
    const port = createAppModelPort(fakeProvider(), "test-model");

    const promise = port.complete(fakeRequest(), new AbortController().signal);
    const assertion = expect(promise).rejects.toThrow(`Model request timed out after ${DEFAULT_MODEL_TIMEOUT_MS}ms`);
    await vi.advanceTimersByTimeAsync(DEFAULT_MODEL_TIMEOUT_MS + 1);

    await assertion;
  });
});
