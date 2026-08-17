import { describe, it, expect } from "vitest";
import { chunkText, tokenize, scoreChunk, rankChunks, rankSnippets, createSearchInPage } from "./searchInPage";
import { createFsToolPortState } from "./shared";
import { toSourceId } from "../loop/actions";

describe("searchInPage: tokenize", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("Hello, World! It's a TEST.")).toEqual(["hello", "world", "it", "s", "a", "test"]);
  });

  it("collapses whitespace", () => {
    expect(tokenize("one   two\tthree\nfour")).toEqual(["one", "two", "three", "four"]);
  });

  it("returns an empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("searchInPage: chunkText", () => {
  it("returns no chunks for an empty body", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns one chunk when body is shorter than chunkSize", () => {
    const chunks = chunkText("short text", 800, 150);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual({ text: "short text", start: 0, end: 10 });
  });

  it("chunks cover the entire body with the configured overlap", () => {
    const body = "a".repeat(2000);
    const chunks = chunkText(body, 800, 150);
    expect(chunks[chunks.length - 1].end).toBe(body.length);
    // consecutive chunks overlap by exactly `overlap` characters
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBe(chunks[i - 1].start + (800 - 150));
    }
  });
});

describe("searchInPage: scoreChunk / rankChunks", () => {
  it("scores a chunk containing query terms higher than one without", () => {
    const relevant = { text: "the quarterly revenue report shows strong revenue growth", start: 0, end: 10 };
    const irrelevant = { text: "the weather today is sunny and warm", start: 0, end: 10 };
    const queryTokens = tokenize("revenue growth");

    expect(scoreChunk(relevant, queryTokens)).toBeGreaterThan(scoreChunk(irrelevant, queryTokens));
  });

  it("rankChunks returns [] when the query has no tokens", () => {
    expect(rankChunks("some body text", "   ")).toEqual([]);
  });

  it("rankChunks filters out zero-scoring chunks entirely", () => {
    const body = "alpha bravo charlie";
    const ranked = rankChunks(body, "zzz_not_present");
    expect(ranked).toEqual([]);
  });

  it("rankChunks respects topN", () => {
    const body = "revenue ".repeat(50) + "x".repeat(2000) + " revenue ".repeat(50);
    const ranked = rankChunks(body, "revenue", 1);
    expect(ranked.length).toBeLessThanOrEqual(1);
  });
});

describe("searchInPage: rankSnippets", () => {
  it("formats snippets with character offsets", () => {
    const snippets = rankSnippets("the quarterly revenue report", "revenue");
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets[0]).toMatch(/^\[chars \d+-\d+\] /);
  });
});

describe("searchInPage: createSearchInPage", () => {
  it("returns ranked snippets for a known source id", async () => {
    const state = createFsToolPortState();
    state.bodies.set(toSourceId("S1"), { url: "https://example.com", body: "the quarterly revenue report shows growth" });
    const searchInPage = createSearchInPage(state);

    const matches = await searchInPage(toSourceId("S1"), "revenue", new AbortController().signal);

    expect(matches.length).toBeGreaterThan(0);
  });

  it("rejects for an unknown source id", async () => {
    const state = createFsToolPortState();
    const searchInPage = createSearchInPage(state);

    await expect(searchInPage(toSourceId("S99"), "revenue", new AbortController().signal)).rejects.toThrow(/unknown source id/);
  });

  it("rejects promptly when the signal is already aborted", async () => {
    const state = createFsToolPortState();
    state.bodies.set(toSourceId("S1"), { url: "https://example.com", body: "text" });
    const searchInPage = createSearchInPage(state);
    const controller = new AbortController();
    controller.abort();

    await expect(searchInPage(toSourceId("S1"), "text", controller.signal)).rejects.toThrow("cancelled");
  });
});
