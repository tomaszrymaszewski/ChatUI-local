import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  HEADROOM_URL,
  headroomAvailable,
  compressMessages,
  headroomStatus,
  __resetBreakerForTests,
} from "./headroom-client";

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
  __resetBreakerForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compressMessages (Tauri transport)", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });

  it("POSTs to /v1/compress and maps the snake_case response", async () => {
    mockedInvoke.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      contentType: "application/json",
      body: JSON.stringify({
        messages: [{ role: "tool", content: "compressed" }],
        tokens_before: 1000,
        tokens_after: 250,
        tokens_saved: 750,
        compression_ratio: 0.75,
        compressed: true,
      }),
    });

    const result = await compressMessages(
      [{ role: "tool", content: "some long tool output".repeat(100) }],
      "gpt-4o",
    );

    expect(mockedInvoke).toHaveBeenCalledWith("http_post_json", {
      url: `${HEADROOM_URL}/v1/compress`,
      body: expect.stringContaining("\"model\":\"gpt-4o\""),
      timeoutMs: expect.any(Number),
    });
    expect(result.compressed).toBe(true);
    expect(result.tokensSaved).toBe(750);
    expect(result.compressionRatio).toBe(0.75);
    expect(result.messages).toEqual([{ role: "tool", content: "compressed" }]);
    expect(headroomAvailable()).toBe(true); // success heals the breaker
  });

  it("marks the proxy unavailable and passes through on a 4xx", async () => {
    mockedInvoke.mockResolvedValueOnce({ status: 404, statusText: "Not Found", contentType: "", body: "" });
    const messages = [{ role: "user", content: "hi" }];

    const result = await compressMessages(messages, "gpt-4o");

    expect(result.compressed).toBe(false);
    expect(result.messages).toBe(messages);
    expect(headroomAvailable()).toBe(false);

    // Third call short-circuits without hitting the transport.
    mockedInvoke.mockClear();
    const second = await compressMessages(messages, "gpt-4o");
    expect(second.compressed).toBe(false);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe("compressMessages (native fetch, non-Tauri)", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });

  it("uses fetch and maps content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            messages: [{ role: "user", content: "c" }],
            compressed: true,
            tokens_saved: 10,
          }),
      }),
    );

    const result = await compressMessages([{ role: "user", content: "abc" }], "gpt-4o");

    expect(result.compressed).toBe(true);
    expect(result.tokensSaved).toBe(10);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      `${HEADROOM_URL}/v1/compress`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("passes through when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")));
    const messages = [{ role: "user", content: "x" }];
    const result = await compressMessages(messages, "gpt-4o");
    expect(result.compressed).toBe(false);
    expect(result.messages).toBe(messages);
  });
});

describe("headroomStatus", () => {
  it("returns installed/serving from the Rust command under Tauri", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    mockedInvoke.mockResolvedValueOnce({ installed: true, serving: true, url: HEADROOM_URL });
    await expect(headroomStatus()).resolves.toEqual({
      installed: true,
      serving: true,
      url: HEADROOM_URL,
    });
  });

  it("reports not installed when the command fails", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    mockedInvoke.mockRejectedValueOnce("command missing");
    await expect(headroomStatus()).resolves.toEqual({
      installed: false,
      serving: false,
      url: HEADROOM_URL,
    });
  });

  it("assumes ready in browser dev (no Rust lifecycle)", async () => {
    vi.stubGlobal("window", {});
    await expect(headroomStatus()).resolves.toEqual({
      installed: true,
      serving: true,
      url: HEADROOM_URL,
    });
  });
});
