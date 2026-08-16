import { afterEach, describe, expect, it, vi } from "vitest";
import { searchTavily, TavilySearchError } from "./tavily";
import { TAVILY_MAX_CONTENT_CHARS } from "./config";

describe("searchTavily", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates with a Bearer token and maps results", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.tavily.com/search");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-test");
      const body = JSON.parse(init.body as string);
      expect(body.query).toBe("charity: water funding");
      return new Response(
        JSON.stringify({
          results: [
            { url: "https://a.com", title: "A", content: "content a" },
            { url: "https://b.com", title: "B", content: "content b" },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTavily(
      "charity: water funding",
      { apiKey: "tvly-test" },
      new AbortController().signal,
    );

    expect(results).toEqual([
      { url: "https://a.com", title: "A", content: "content a" },
      { url: "https://b.com", title: "B", content: "content b" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("truncates result content to TAVILY_MAX_CONTENT_CHARS", async () => {
    const longContent = "x".repeat(TAVILY_MAX_CONTENT_CHARS + 1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ results: [{ url: "https://a.com", title: "A", content: longContent }] }),
            { status: 200 },
          ),
      ),
    );

    const results = await searchTavily("q", { apiKey: "k" }, new AbortController().signal);
    expect(results[0].content.length).toBe(TAVILY_MAX_CONTENT_CHARS);
  });

  it("throws TavilySearchError on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid api key", { status: 401 })),
    );

    await expect(searchTavily("q", { apiKey: "bad" }, new AbortController().signal)).rejects.toThrow(
      TavilySearchError,
    );
  });

  it("returns an empty array when the response has no results field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );

    const results = await searchTavily("q", { apiKey: "k" }, new AbortController().signal);
    expect(results).toEqual([]);
  });
});
