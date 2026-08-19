import { afterEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";
import type { ResearchContext } from "./types";
import { FETCH_ONLY_MAX_FETCHES_PER_ROUND } from "./config";

const { streamChatCompletionMock, keylessWebSearchMock } = vi.hoisted(() => ({
  streamChatCompletionMock: vi.fn(),
  keylessWebSearchMock: vi.fn(),
}));
vi.mock("@/lib/llm", () => ({
  streamChatCompletion: streamChatCompletionMock,
}));
vi.mock("./keyless-search", () => ({
  keylessWebSearch: keylessWebSearchMock,
}));

import { createFetchOnlyResearchFunctions } from "./fetch-only-research";

const provider: Provider = { id: "p1", name: "Test", baseUrl: "https://api.example.com/v1", models: [], hasKey: true };

function mockNextCompletion(responseText: string) {
  streamChatCompletionMock.mockImplementationOnce(async function* () {
    yield { content: responseText };
  });
}

function fetchMockReturning(contentFor: (url: string) => string) {
  return vi.fn(async (url: string) => new Response(contentFor(url), { status: 200, headers: { "content-type": "text/plain" } }));
}

function extractionUserMessageOf(callIndex: number): string {
  const messages = streamChatCompletionMock.mock.calls[callIndex][2] as Array<{ content: string }>;
  return messages[0].content;
}

const fetchOnlyContext = (seedUrls: string[]): ResearchContext => ({ mode: "fetch-only", seedUrls });
const gaps = [{ question: "g1", section: "Overview" }];
const emptyExtraction = JSON.stringify({ findings: [], resolvedGaps: [], newGaps: [] });

describe("search-driven research round", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    streamChatCompletionMock.mockReset();
    keylessWebSearchMock.mockReset();
  });

  it("searches each query keylessly and fetches the surfaced pages", async () => {
    keylessWebSearchMock.mockImplementation(async (query: string) => [`https://a.com/${query}`]);
    vi.stubGlobal("fetch", fetchMockReturning((url) => `content for ${url}`));
    mockNextCompletion(
      JSON.stringify({
        findings: [{ text: "A finding", sourceUrls: ["https://a.com/q1"] }],
        resolvedGaps: ["g1"],
        newGaps: [],
      }),
    );

    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const result = await researchRound("heat pumps", gaps, ["q1", "q2"], 0, fetchOnlyContext([]), new AbortController().signal);

    expect(keylessWebSearchMock).toHaveBeenCalledTimes(2);
    expect(result.newSources.map((s) => s.url).sort()).toEqual(["https://a.com/q1", "https://a.com/q2"]);
    expect(result.findings[0].sourceUrls).toEqual(["https://a.com/q1"]);
    expect(result.resolvedGaps).toEqual(["g1"]);
  });

  it("caps fetches at FETCH_ONLY_MAX_FETCHES_PER_ROUND and carries seed URLs to the next round", async () => {
    keylessWebSearchMock.mockResolvedValue([]);
    const urls = Array.from({ length: FETCH_ONLY_MAX_FETCHES_PER_ROUND + 2 }, (_, i) => `https://a.com/page${i}`);
    vi.stubGlobal("fetch", fetchMockReturning((url) => `content for ${url}`));
    mockNextCompletion(emptyExtraction);
    mockNextCompletion(emptyExtraction);

    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const context = fetchOnlyContext(urls);

    const round1 = await researchRound("heat pumps", gaps, [], 0, context, new AbortController().signal);
    expect(round1.newSources).toHaveLength(FETCH_ONLY_MAX_FETCHES_PER_ROUND);

    const round2 = await researchRound("heat pumps", gaps, [], 1, context, new AbortController().signal);
    expect(round2.newSources).toHaveLength(2); // the remaining 2 URLs
  });

  it("never re-fetches a URL already consumed in a prior round (cross-round dedup)", async () => {
    keylessWebSearchMock.mockResolvedValue([]);
    const urls = ["https://a.com/1", "https://a.com/2"];
    const fetchMock = fetchMockReturning((url) => `content for ${url}`);
    vi.stubGlobal("fetch", fetchMock);
    mockNextCompletion(emptyExtraction);

    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const context = fetchOnlyContext(urls);

    await researchRound("heat pumps", gaps, [], 0, context, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Frontier is now exhausted and search finds nothing — round 2 fetches nothing new.
    const round2 = await researchRound("heat pumps", [], [], 1, context, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no additional calls
    expect(round2.newSources).toHaveLength(0);
    expect(round2.findings).toHaveLength(0);
  });

  it("builds sources from actually-fetched URLs, never from the model's claimed sourceUrls", async () => {
    keylessWebSearchMock.mockResolvedValue([]);
    vi.stubGlobal("fetch", fetchMockReturning((url) => `content for ${url}`));
    mockNextCompletion(
      JSON.stringify({
        findings: [
          {
            text: "A finding",
            sourceUrls: ["https://a.com/real", "https://not-actually-fetched.example/fake"],
          },
        ],
        resolvedGaps: [],
        newGaps: [],
      }),
    );

    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const context = fetchOnlyContext(["https://a.com/real"]);

    const result = await researchRound("heat pumps", gaps, [], 0, context, new AbortController().signal);

    expect(result.newSources).toEqual([{ url: "https://a.com/real", title: "https://a.com/real", foundInRound: 0 }]);
    expect(result.findings[0].sourceUrls).toEqual(["https://a.com/real"]); // the fake URL was filtered out
  });

  it("falls back to explicitly-flagged unverified model-knowledge findings when search yields nothing", async () => {
    keylessWebSearchMock.mockResolvedValue([]);
    mockNextCompletion(
      JSON.stringify({
        findings: [{ text: "[Unverified — model knowledge] Heat pumps can work below -25C with modern compressors." }],
        resolvedGaps: ["g1"],
        newGaps: [],
      }),
    );

    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const result = await researchRound("heat pumps", gaps, ["q1"], 0, fetchOnlyContext([]), new AbortController().signal);

    expect(result.newSources).toHaveLength(0);
    expect(result.findings[0].text).toContain("[Unverified");
    expect(result.findings[0].sourceUrls).toEqual([]);
    expect(result.resolvedGaps).toEqual(["g1"]);
  });

  it("returns an empty result without a model call when nothing is fetchable and no gaps are open", async () => {
    keylessWebSearchMock.mockResolvedValue([]);

    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const result = await researchRound("heat pumps", [], [], 0, fetchOnlyContext([]), new AbortController().signal);

    expect(result).toEqual({ findings: [], newSources: [], resolvedGaps: [], newGaps: [], tokensUsed: 0 });
    expect(streamChatCompletionMock).not.toHaveBeenCalled();
  });

  it("passes earlier-round learnings into later extraction rounds (recursion)", async () => {
    keylessWebSearchMock.mockImplementation(async (query: string) => [`https://a.com/${query}`]);
    vi.stubGlobal("fetch", fetchMockReturning((url) => `content for ${url}`));
    mockNextCompletion(
      JSON.stringify({
        findings: [{ text: "Round one learning", sourceUrls: ["https://a.com/q1"] }],
        resolvedGaps: [],
        newGaps: [{ question: "follow-up", section: "Overview" }],
      }),
    );
    mockNextCompletion(emptyExtraction);

    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const context = fetchOnlyContext([]);

    await researchRound("heat pumps", gaps, ["q1"], 0, context, new AbortController().signal);
    await researchRound("heat pumps", [{ question: "follow-up", section: "Overview" }], ["follow-up"], 1, context, new AbortController().signal);

    expect(extractionUserMessageOf(0)).not.toContain("Learnings gathered in earlier rounds");
    expect(extractionUserMessageOf(1)).toContain("Round one learning");
  });

  it("throws if called with a search-mode context (guards against wrong wiring)", async () => {
    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    await expect(
      researchRound("heat pumps", [], [], 0, { mode: "search" }, new AbortController().signal),
    ).rejects.toThrow(/fetch-only/);
  });
});
