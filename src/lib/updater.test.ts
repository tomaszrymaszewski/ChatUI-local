import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUpdateSettings, saveUpdateSettings } from "./updater";

const storage = new Map<string, string>();

function stubStorage(setItem: (k: string, v: string) => void) {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem,
    removeItem: (k: string) => void storage.delete(k),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  });
}

beforeEach(() => {
  storage.clear();
  stubStorage((k, v) => void storage.set(k, v));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("update settings persistence", () => {
  it("round-trips settings", () => {
    expect(loadUpdateSettings()).toEqual({ autoCheck: true, lastChecked: null });
    saveUpdateSettings({ autoCheck: false, lastChecked: "2026-09-15T12:00:00.000Z" });
    expect(loadUpdateSettings()).toEqual({ autoCheck: false, lastChecked: "2026-09-15T12:00:00.000Z" });
  });

  it("never throws on a full store — a failed lastChecked write must not fail the update check", () => {
    storage.set("chatui:modelsdev-cache", "{}");
    // Full until the cache is gone, then room again.
    stubStorage((k, v) => {
      if (storage.has("chatui:modelsdev-cache")) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      storage.set(k, v);
    });
    expect(() =>
      saveUpdateSettings({ autoCheck: true, lastChecked: "2026-09-15T12:00:00.000Z" }),
    ).not.toThrow();
    expect(loadUpdateSettings().lastChecked).toBe("2026-09-15T12:00:00.000Z");

    // Persistently full: still no throw, the timestamp just doesn't persist.
    stubStorage(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    expect(() => saveUpdateSettings({ autoCheck: true, lastChecked: null })).not.toThrow();
  });
});
