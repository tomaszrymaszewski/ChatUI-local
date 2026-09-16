import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBigStores,
  findOrphanedMessageKeys,
  isBigKey,
  listBigKeys,
  preloadStores,
  readBigKey,
  removeBigKey,
  setBigStoreDirtyListener,
  writeBigKey,
} from "./idb-store";

// The vitest environment is node — no IndexedDB — so the store uses its
// localStorage backend, which must behave byte-identically to raw
// localStorage (every existing suite depends on that). The IndexedDB backend
// (mirror + write-behind + boot sweep) only activates where indexedDB exists.

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
  setBigStoreDirtyListener(null);
});

afterEach(() => {
  setBigStoreDirtyListener(null);
  vi.unstubAllGlobals();
});

describe("isBigKey", () => {
  it("matches sessions and message stores only", () => {
    expect(isBigKey("chatui:sessions")).toBe(true);
    expect(isBigKey("chatui:messages:abc")).toBe(true);
    expect(isBigKey("chatui:settings")).toBe(false);
    expect(isBigKey("chatui:providers")).toBe(false);
    // Small bookkeeping stays in localStorage (raw readers, never migrated).
    expect(isBigKey("chatui:messages:recency")).toBe(false);
  });
});

describe("findOrphanedMessageKeys", () => {
  const keys = [
    "chatui:sessions",
    "chatui:messages:s1",
    "chatui:messages:s2",
    "chatui:messages:recency",
    "chatui:settings",
  ];

  it("lists stores with no matching session", () => {
    const sessions = JSON.stringify([{ id: "s1" }, { id: "other" }]);
    expect(findOrphanedMessageKeys(keys, sessions)).toEqual(["chatui:messages:s2"]);
  });

  it("returns nothing when everything matches", () => {
    const sessions = JSON.stringify([{ id: "s1" }, { id: "s2" }]);
    expect(findOrphanedMessageKeys(keys, sessions)).toEqual([]);
  });

  it("never GCs against a missing, corrupt, or non-array sessions list", () => {
    expect(findOrphanedMessageKeys(keys, null)).toEqual([]);
    expect(findOrphanedMessageKeys(keys, "")).toEqual([]);
    expect(findOrphanedMessageKeys(keys, "{not json")).toEqual([]);
    expect(findOrphanedMessageKeys(keys, "null")).toEqual([]);
    expect(findOrphanedMessageKeys(keys, "{}")).toEqual([]);
  });

  it("ignores sessions without string ids", () => {
    const sessions = JSON.stringify([{ id: "s1" }, { noId: true }, null, "s2"]);
    expect(findOrphanedMessageKeys(keys, sessions)).toEqual(["chatui:messages:s2"]);
  });
});

describe("localStorage backend", () => {
  it("round-trips through localStorage", () => {
    writeBigKey("chatui:sessions", "[]");
    expect(storage.get("chatui:sessions")).toBe("[]");
    expect(readBigKey("chatui:sessions")).toBe("[]");
    removeBigKey("chatui:sessions");
    expect(storage.has("chatui:sessions")).toBe(false);
    expect(readBigKey("chatui:sessions")).toBeNull();
  });

  it("reads keys seeded directly in localStorage (no preload needed)", () => {
    storage.set("chatui:messages:s1", "[1]");
    expect(readBigKey("chatui:messages:s1")).toBe("[1]");
    expect(listBigKeys("chatui:messages:").sort()).toEqual(["chatui:messages:s1"]);
  });

  it("propagates quota errors so callers keep their existing handling", () => {
    stubStorage(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    expect(() => writeBigKey("chatui:sessions", "[]")).toThrow();
  });

  it("preloads without disturbing localStorage behavior", async () => {
    storage.set("chatui:sessions", "[]");
    await expect(preloadStores()).resolves.toBeUndefined();
    await expect(preloadStores()).resolves.toBeUndefined(); // idempotent
    expect(readBigKey("chatui:sessions")).toBe("[]");
    writeBigKey("chatui:messages:s1", "[1]");
    expect(storage.get("chatui:messages:s1")).toBe("[1]");
  });
});

describe("dirty listener", () => {
  it("fires by default, skipped with dirty:false, never breaks writes", () => {
    const seen: string[] = [];
    setBigStoreDirtyListener((key) => void seen.push(key));
    writeBigKey("chatui:sessions", "[]");
    writeBigKey("chatui:messages:s1", "[1]", { dirty: false });
    removeBigKey("chatui:sessions");
    removeBigKey("chatui:messages:s1", { dirty: false });
    expect(seen).toEqual(["chatui:sessions", "chatui:sessions"]);

    setBigStoreDirtyListener(() => {
      throw new Error("listener boom");
    });
    expect(() => writeBigKey("chatui:sessions", "[]")).not.toThrow();
    expect(storage.get("chatui:sessions")).toBe("[]");
  });
});

describe("clearBigStores", () => {
  it("wipes big keys but keeps everything else", async () => {
    storage.set("chatui:sessions", "[]");
    storage.set("chatui:messages:s1", "[1]");
    storage.set("chatui:settings", "{}");
    await clearBigStores();
    expect(storage.has("chatui:sessions")).toBe(false);
    expect(storage.has("chatui:messages:s1")).toBe(false);
    expect(storage.get("chatui:settings")).toBe("{}");
  });
});
