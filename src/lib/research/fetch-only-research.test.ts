import { afterEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";
import type { ResearchContext } from "./types";
import { FETCH_ONLY_MAX_FETCHES_PER_ROUND } from "./config";

const { streamChatCompletionMock } = vi.hoisted(() => ({ streamChatCompletionMock: vi.fn() }));
vi.mock("@/lib/llm", () => ({
  streamChatCompletion: streamChatCompletionMock,
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

const fetchOnlyContext = (seedUrls: string[]): ResearchContext => ({ mode: "fetch-only", seedUrls });

describe("fetch-only research round", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    streamChatCompletionMock.mockReset();
  });

  it("caps fetches at FETCH_ONLY_MAX_FETCHES_PER_ROUND and carries the rest to the next round", async () => {
    const urls = Array.from({ length: FETCH_ONLY_MAX_FETCHES_PER_ROUND + 2 }, (_, i) => `https://a.com/page${i}`);
    vi.stubGlobal("fetch", fetchMockReturning((url) => `content for ${url}`));
    mockNextCompletion(JSON.stringify({ findings: [], resolvedGaps: [], newGaps: [] }));
    mockNextCompletion(JSON.stringify({ findings: [], resolvedGaps: [], newGaps: [] }));

    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const context = fetchOnlyContext(urls);

    const round1 = await researchRound("Acme NGO", [], [], 0, context, new AbortController().signal);
    expect(round1.newSources).toHaveLength(FETCH_ONLY_MAX_FETCHES_PER_ROUND);

    const round2 = await researchRound("Acme NGO", [], [], 1, context, new AbortController().signal);
    expect(round2.newSources).toHaveLength(2); // the remaining 2 URLs
  });

  it("never re-fetches a URL already consumed in a prior round (cross-round dedup)", async () => {
    const urls = ["https://a.com/1", "https://a.com/2"];
    const fetchMock = fetchMockReturning((url) => `content for ${url}`);
    vi.stubGlobal("fetch", fetchMock);
    mockNextCompletion(JSON.stringify({ findings: [], resolvedGaps: [], newGaps: [] }));

    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const context = fetchOnlyContext(urls);

    await researchRound("Acme NGO", [], [], 0, context, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Frontier is now exhausted — round 2 should fetch nothing new.
    const round2 = await researchRound("Acme NGO", [], [], 1, context, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no additional calls
    expect(round2.newSources).toHaveLength(0);
    expect(round2.findings).toHaveLength(0);
  });

  it("builds sources from actually-fetched URLs, never from the model's claimed sourceUrls", async () => {
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

    const result = await researchRound("Acme NGO", [], [], 0, context, new AbortController().signal);

    expect(result.newSources).toEqual([{ url: "https://a.com/real", title: "https://a.com/real", foundInRound: 0 }]);
    expect(result.findings[0].sourceUrls).toEqual(["https://a.com/real"]); // the fake URL was filtered out
  });

  it("degrades gracefully to an empty result when the frontier is exhausted", async () => {
    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    const result = await researchRound("Acme NGO", [], [], 0, fetchOnlyContext([]), new AbortController().signal);

    expect(result).toEqual({ findings: [], newSources: [], resolvedGaps: [], newGaps: [], tokensUsed: 0 });
    expect(streamChatCompletionMock).not.toHaveBeenCalled(); // no extraction call with nothing fetched
  });

  it("throws if called with a search-mode context (guards against wrong wiring)", async () => {
    const { researchRound } = createFetchOnlyResearchFunctions(provider, "some-model", undefined);
    await expect(
      researchRound("Acme NGO", [], [], 0, { mode: "search" }, new AbortController().signal),
    ).rejects.toThrow(/fetch-only/);
  });
});
