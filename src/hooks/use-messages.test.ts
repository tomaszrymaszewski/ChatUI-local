import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendMessageHeadless, loadMessages } from "./use-messages";
import type { Message } from "@/types";

// The vitest environment is node — stub storage and window like a browser.
const storage = new Map<string, string>();
let quotaBytes = Number.POSITIVE_INFINITY;

function byteSize(s: string): number {
  return new TextEncoder().encode(s).length;
}

function storeSize(): number {
  let n = 0;
  for (const v of storage.values()) n += byteSize(v);
  return n;
}

function makeMsg(id: string, attachments: Message["attachments"] = []): Message {
  return {
    id,
    role: "user",
    content: "hi",
    timestamp: new Date("2026-01-01T00:00:00Z"),
    attachments,
    session_id: "s-current",
    parent_id: null,
    is_temporary: false,
  };
}

beforeEach(() => {
  storage.clear();
  quotaBytes = Number.POSITIVE_INFINITY;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const next = storeSize() - byteSize(storage.get(k) ?? "") + byteSize(v);
      if (next > quotaBytes) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      storage.set(k, v);
    },
    removeItem: (k: string) => void storage.delete(k),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  });
  vi.stubGlobal("window", { dispatchEvent: () => true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quota-safe message persistence", () => {
  it("strips data: preview URLs (rebuildable from the blob store) on save", () => {
    appendMessageHeadless(
      "s-current",
      makeMsg("m1", [
        { id: "a1", name: "shot.png", size: 10, type: "image/png", previewUrl: "data:image/png;base64,AAAA", storageId: "blob-1" },
        { id: "a2", name: "doc.pdf", size: 10, type: "application/pdf", storageId: "blob-2" },
      ]),
    );
    const raw = storage.get("chatui:messages:s-current") ?? "";
    expect(raw).not.toContain("data:image/png");
    expect(raw).toContain("blob-1");
    // storageId survives so previews rehydrate on load
    expect(loadMessages("s-current")[0].attachments?.[0].storageId).toBe("blob-1");
  });

  it("evicts the stalest other chat instead of throwing on a full store", () => {
    // Old chat written first (least recently written) with a large payload.
    const big = makeMsg("m-old");
    big.content = "x".repeat(2000);
    appendMessageHeadless("s-old", big);
    const recency = JSON.parse(storage.get("chatui:messages:recency") ?? "{}") as Record<string, number>;
    expect(recency["s-old"]).toBeTypeOf("number");
    quotaBytes = storeSize() + 100; // a small new write no longer fits

    // A brand-new chat's first save must not throw (the reported crash).
    expect(() =>
      appendMessageHeadless("s-current", makeMsg("m-new", [])),
    ).not.toThrow();
    expect(loadMessages("s-current")).toHaveLength(1);
    expect(storage.has("chatui:messages:s-old")).toBe(false);
  });

  it("keeps the current chat in memory without throwing when nothing fits", () => {
    appendMessageHeadless("s-current", makeMsg("m1"));
    quotaBytes = 0; // nothing else fits, not even after evicting everything
    expect(() => appendMessageHeadless("s-current", makeMsg("m2"))).not.toThrow();
  });
});
