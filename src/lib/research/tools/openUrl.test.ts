import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { createOpenUrl } from "./openUrl";
import { createFsToolPortState } from "./shared";
import { toSourceId } from "../loop/actions";

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("openUrl: createOpenUrl", () => {
  it("invokes research_open_url with the url and timeoutMs, and returns the fetched page", async () => {
    mockedInvoke.mockResolvedValue({ title: "Example", body: "hello world", date: null });
    const state = createFsToolPortState();
    const openUrl = createOpenUrl(state, 12345);
    const controller = new AbortController();

    const result = await openUrl("https://example.com/page", controller.signal);

    expect(mockedInvoke).toHaveBeenCalledWith("research_open_url", { url: "https://example.com/page", timeoutMs: 12345 });
    expect(result).toEqual({ title: "Example", body: "hello world", date: null });
  });

  it("stores the full body under S1 on the first successful fetch", async () => {
    mockedInvoke.mockResolvedValue({ title: "Example", body: "hello world", date: null });
    const state = createFsToolPortState();
    const openUrl = createOpenUrl(state, 1000);

    await openUrl("https://example.com/page", new AbortController().signal);

    expect(state.nextOrdinal).toBe(2);
    expect(state.bodies.get(toSourceId("S1"))).toEqual({ url: "https://example.com/page", body: "hello world" });
  });

  it("increments the shared ordinal across repeated calls", async () => {
    mockedInvoke.mockResolvedValue({ title: "A", body: "a", date: null });
    const state = createFsToolPortState();
    const openUrl = createOpenUrl(state, 1000);

    await openUrl("https://example.com/a", new AbortController().signal);
    await openUrl("https://example.com/b", new AbortController().signal);

    expect(state.bodies.has(toSourceId("S1"))).toBe(true);
    expect(state.bodies.has(toSourceId("S2"))).toBe(true);
    expect(state.nextOrdinal).toBe(3);
  });

  it("rejects without storing anything when invoke fails", async () => {
    mockedInvoke.mockRejectedValue(new Error("request failed"));
    const state = createFsToolPortState();
    const openUrl = createOpenUrl(state, 1000);

    await expect(openUrl("https://example.com", new AbortController().signal)).rejects.toThrow("request failed");
    expect(state.bodies.size).toBe(0);
    expect(state.nextOrdinal).toBe(1);
  });

  it("rejects promptly when the signal is already aborted, without calling invoke", async () => {
    const state = createFsToolPortState();
    const openUrl = createOpenUrl(state, 1000);
    const controller = new AbortController();
    controller.abort();

    await expect(openUrl("https://example.com", controller.signal)).rejects.toThrow("cancelled");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
