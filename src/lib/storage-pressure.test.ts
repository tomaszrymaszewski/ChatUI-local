import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_FULL_MESSAGE,
  evictRebuildableCaches,
  isQuotaError,
  setItemOrThrowFriendly,
  trySetItem,
} from "./storage-pressure";

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

describe("isQuotaError", () => {
  it("recognizes quota failures across browser wordings", () => {
    expect(isQuotaError(new DOMException("The quota has been exceeded.", "QuotaExceededError"))).toBe(true);
    expect(isQuotaError(new Error("The quota has been exceeded."))).toBe(true);
    expect(isQuotaError(new Error("Failed to execute 'setItem' on 'Storage': exceeded the quota."))).toBe(true);
    expect(isQuotaError(new Error("denied"))).toBe(false);
    expect(isQuotaError(new DOMException("Denied.", "SecurityError"))).toBe(false);
    expect(isQuotaError("quota")).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe("evictRebuildableCaches", () => {
  it("drops known caches but keeps user data, and never throws", () => {
    storage.set("chatui:modelsdev-cache", "{}");
    storage.set("chatui:skills:registry", "{}");
    storage.set("chatui:providers", "[]");
    expect(evictRebuildableCaches()).toBe(true);
    expect(storage.has("chatui:modelsdev-cache")).toBe(false);
    expect(storage.has("chatui:skills:registry")).toBe(false);
    expect(storage.get("chatui:providers")).toBe("[]");
    expect(evictRebuildableCaches()).toBe(false); // nothing left to drop
  });

  it("keeps trying remaining caches when one removal throws", () => {
    storage.set("chatui:modelsdev-cache", "{}");
    storage.set("chatui:skills:registry", "{}");
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => {
        if (k === "chatui:modelsdev-cache") throw new Error("denied");
        storage.delete(k);
      },
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size;
      },
    });
    expect(evictRebuildableCaches()).toBe(true);
    expect(storage.has("chatui:skills:registry")).toBe(false);
  });
});

describe("trySetItem", () => {
  it("passes writes through when there is room", () => {
    expect(trySetItem("k", "v")).toBe(true);
    expect(storage.get("k")).toBe("v");
  });

  it("evicts caches and retries on quota pressure", () => {
    storage.set("chatui:modelsdev-cache", "{}");
    // Full until the cache is gone, then room again.
    stubStorage((k, v) => {
      if (storage.has("chatui:modelsdev-cache")) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      storage.set(k, v);
    });
    expect(trySetItem("k", "v")).toBe(true);
    expect(storage.get("k")).toBe("v");
    expect(storage.has("chatui:modelsdev-cache")).toBe(false);
  });

  it("reports false when quota persists or the failure isn't quota", () => {
    stubStorage(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    expect(trySetItem("k", "v")).toBe(false);
    stubStorage(() => {
      throw new DOMException("Denied.", "SecurityError");
    });
    expect(trySetItem("k", "v")).toBe(false);
    expect(storage.has("k")).toBe(false);
  });
});

describe("setItemOrThrowFriendly", () => {
  it("writes through, else throws a clear error instead of raw quota text", () => {
    setItemOrThrowFriendly("k", "v");
    expect(storage.get("k")).toBe("v");
    stubStorage(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    expect(() => setItemOrThrowFriendly("k2", "v")).toThrow(STORAGE_FULL_MESSAGE);
  });
});
