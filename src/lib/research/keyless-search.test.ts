import { afterEach, describe, expect, it, vi } from "vitest";
import { extractDuckDuckGoResultUrls, keylessWebSearch } from "./keyless-search";

const SAMPLE_DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.charitywater.org%2F&amp;rut=abc">charity: water</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FCharity%3A_water&amp;rut=def">Charity: water - Wikipedia</a>
</div>
`;

describe("extractDuckDuckGoResultUrls", () => {
  it("decodes destination URLs out of DuckDuckGo's redirect links", () => {
    const urls = extractDuckDuckGoResultUrls(SAMPLE_DDG_HTML, 5);
    expect(urls).toEqual(["https://www.charitywater.org/", "https://en.wikipedia.org/wiki/Charity:_water"]);
  });

  it("caps at maxResults", () => {
    const urls = extractDuckDuckGoResultUrls(SAMPLE_DDG_HTML, 1);
    expect(urls).toEqual(["https://www.charitywater.org/"]);
  });

  it("returns an empty array for HTML with no results (e.g. markup changed)", () => {
    expect(extractDuckDuckGoResultUrls("<html><body>no results</body></html>", 5)).toEqual([]);
  });

  it("dedupes repeated destination URLs", () => {
    const html = SAMPLE_DDG_HTML + SAMPLE_DDG_HTML; // same two results twice
    expect(extractDuckDuckGoResultUrls(html, 10)).toHaveLength(2);
  });
});

describe("keylessWebSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the DuckDuckGo HTML endpoint with the query and parses results", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("html.duckduckgo.com/html/?q=charity%3A%20water");
      return new Response(SAMPLE_DDG_HTML, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const urls = await keylessWebSearch("charity: water", 5);
    expect(urls).toEqual(["https://www.charitywater.org/", "https://en.wikipedia.org/wiki/Charity:_water"]);
  });

  it("degrades to an empty array (never throws) on a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 429 })));
    await expect(keylessWebSearch("anything", 5)).resolves.toEqual([]);
  });

  it("degrades to an empty array if fetch itself rejects (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(keylessWebSearch("anything", 5)).resolves.toEqual([]);
  });
});
