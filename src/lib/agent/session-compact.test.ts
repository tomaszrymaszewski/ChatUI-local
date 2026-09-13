import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compactHistoryMessages,
  compactionAnchorIndex,
  loadSessionCompaction,
  saveSessionCompaction,
  transcriptFromMessages,
} from "./session-compact";

// The vitest environment is node — stub storage like a browser.
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compactionAnchorIndex", () => {
  const record = { summary: "s", upToId: "m3", at: 0 };

  it("points at the anchor message on the path", () => {
    expect(compactionAnchorIndex(["m1", "m2", "m3", "m4"], record)).toBe(2);
  });

  it("hides the divider without a compaction", () => {
    expect(compactionAnchorIndex(["m1", "m2"], null)).toBe(-1);
  });

  it("hides the divider when the anchor left the path", () => {
    // Branch switch / deletion: replay ignores the compaction too, so the
    // marker must not render either.
    expect(compactionAnchorIndex(["m1", "m2"], record)).toBe(-1);
  });
});

describe("transcriptFromMessages", () => {
  it("renders user/assistant turns and skips empty content", () => {
    const transcript = transcriptFromMessages([
      { role: "user", content: "What is X?" },
      { role: "assistant", content: "   " },
      { role: "assistant", content: "X is a letter." },
    ]);
    expect(transcript).toBe("User: What is X?\n\nAssistant: X is a letter.");
  });

  it("clips a single long message head", () => {
    const transcript = transcriptFromMessages([{ role: "user", content: "a".repeat(5000) }]);
    expect(transcript.length).toBeLessThan(5000);
    expect(transcript).toContain("[…clipped…]");
  });
});

describe("compactHistoryMessages", () => {
  const pathIds = ["m1", "m2", "m3", "m4"];
  const messages = pathIds.map((id, i) => ({ role: "user" as const, content: `msg ${id}-${i}` }));

  it("returns the messages untouched without a compaction", () => {
    expect(compactHistoryMessages(pathIds, messages, null)).toBe(messages);
  });

  it("replaces everything up to the anchor with one summary turn", () => {
    const out = compactHistoryMessages(pathIds, messages, {
      summary: "Earlier turns discussed X.",
      upToId: "m2",
      at: 0,
    });
    expect(out).toHaveLength(3);
    expect(out[0].role).toBe("user");
    expect(String(out[0].content)).toContain("Earlier turns discussed X.");
    expect(out.slice(1)).toEqual([messages[2], messages[3]]);
  });

  it("is a no-op when the anchor is not on the path", () => {
    const out = compactHistoryMessages(pathIds, messages, {
      summary: "stale",
      upToId: "mX",
      at: 0,
    });
    expect(out).toBe(messages);
  });

  it("keeps only the summary when the anchor is the last one (callers append the outgoing turn)", () => {
    const out = compactHistoryMessages(pathIds, messages, {
      summary: "all of it",
      upToId: "m4",
      at: 0,
    });
    expect(out).toHaveLength(1);
    expect(String(out[0].content)).toContain("all of it");
  });
});

describe("session compaction store", () => {
  it("persists and reloads a compaction record", () => {
    saveSessionCompaction("s1", { summary: "sum", upToId: "m9", at: 42 });
    expect(loadSessionCompaction("s1")).toEqual({ summary: "sum", upToId: "m9", at: 42 });
    expect(loadSessionCompaction("s2")).toBeNull();
  });

  it("rejects corrupt records", () => {
    storage.set("chatui:compaction:s3", "{not json");
    expect(loadSessionCompaction("s3")).toBeNull();
    storage.set("chatui:compaction:s4", JSON.stringify({ summary: "  ", upToId: "m1" }));
    expect(loadSessionCompaction("s4")).toBeNull();
  });
});
