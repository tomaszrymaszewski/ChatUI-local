import { describe, it, expect } from "vitest";
import { createFsToolPortState, raceAgainstSignal } from "./shared";
import { toSourceId } from "../loop/actions";

describe("shared: createFsToolPortState", () => {
  it("starts with an empty map and ordinal 1", () => {
    const state = createFsToolPortState();
    expect(state.bodies.size).toBe(0);
    expect(state.nextOrdinal).toBe(1);
  });
});

describe("shared: raceAgainstSignal", () => {
  it("resolves normally when never aborted", async () => {
    const controller = new AbortController();
    const result = await raceAgainstSignal(() => Promise.resolve("value"), controller.signal);
    expect(result).toBe("value");
  });

  it("rejects promptly on abort even against a promise that never settles", async () => {
    const controller = new AbortController();
    const neverSettles = () => new Promise<string>(() => {});

    const pending = raceAgainstSignal(neverSettles, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow("cancelled");
  });

  it("never calls start() when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    let called = false;
    const start = () => {
      called = true;
      return Promise.resolve("value");
    };

    await expect(raceAgainstSignal(start, controller.signal)).rejects.toThrow("cancelled");
    expect(called).toBe(false);
  });

  it("propagates a rejection from start() when not aborted", async () => {
    const controller = new AbortController();
    const failing = () => Promise.reject(new Error("boom"));
    await expect(raceAgainstSignal(failing, controller.signal)).rejects.toThrow("boom");
  });
});

describe("shared: SourceId usage sanity", () => {
  it("toSourceId is usable as a Map key", () => {
    const state = createFsToolPortState();
    state.bodies.set(toSourceId("S1"), { url: "https://example.com", body: "hello" });
    expect(state.bodies.get(toSourceId("S1"))?.body).toBe("hello");
  });
});
