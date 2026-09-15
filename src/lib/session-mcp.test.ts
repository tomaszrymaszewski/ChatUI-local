import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDisabledMcps, setDisabledMcps } from "./session-mcp";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("per-session connector toggles", () => {
  it("round-trips and ignores a null session", () => {
    expect(getDisabledMcps("s1")).toEqual([]);
    setDisabledMcps("s1", ["a"]);
    expect(getDisabledMcps("s1")).toEqual(["a"]);
    expect(() => setDisabledMcps(null, ["a"])).not.toThrow();
  });

  it("never throws on a full store — the toggle must not crash", () => {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
      removeItem: (k: string) => void storage.delete(k),
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size;
      },
    });
    expect(() => setDisabledMcps("s1", ["a"])).not.toThrow();
  });
});
