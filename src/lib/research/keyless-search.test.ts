import { afterEach, describe, expect, it, vi } from "vitest";
import { extractBingRssResultUrls, extractDuckDuckGoResultUrls, keylessWebSearch } from "./keyless-search";

const SAMPLE_BING_RSS = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>Bing: charity water</title><link>http://www.bing.com:80/search?q=charity+water</link><description>Search results</description><image><url>http://www.bing.com:80/s/a/rsslogo.gif</url><title>charity water</title><link>http://www.bing.com:80/search?q=charity+water</link></image>
<item><title>charity: water</title><link>https://www.charitywater.org/</link><description>clean water</description></item>
<item><title>Charity: water - Wikipedia</title><link>https://en.wikipedia.org/wiki/Charity:_water</link><description>org</description></item>
</channel></rss>`;

const SAMPLE_DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.charitywater.org%2F&amp;rut=abc">charity: water</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FCharity%3A_water&amp;rut=def">Charity: water - Wikipedia</a>
</div>
`;

describe("extractBingRssResultUrls", () => {
  it("pulls result URLs out of <item> blocks, ignoring channel-level links", () => {
    const urls = extractBingRssResultUrls(SAMPLE_BING_RSS, 5);
    expect(urls).toEqual(["https://www.charitywater.org/", "https://en.wikipedia.org/wiki/Charity:_water"]);
  });

  it("caps at maxResults", () => {
    const urls = extractBingRssResultUrls(SAMPLE_BING_RSS, 1);
    expect(urls).toEqual(["https://www.charitywater.org/"]);
  });

  it("returns an empty array for XML with no items (e.g. markup changed)", () => {
    expect(extractBingRssResultUrls("<rss><channel></channel></rss>", 5)).toEqual([]);
  });

  it("dedupes repeated result URLs", () => {
    const xml = SAMPLE_BING_RSS + SAMPLE_BING_RSS; // same items twice
    expect(extractBingRssResultUrls(xml, 10)).toHaveLength(2);
  });

  it("unwraps CDATA-wrapped links", () => {
    const xml = "<item><title>x</title><link><![CDATA[https://example.com/]]></link></item>";
    expect(extractBingRssResultUrls(xml, 5)).toEqual(["https://example.com/"]);
  });
});

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

  it("prefers the Bing RSS endpoint and parses its results", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("www.bing.com/search?q=charity%3A%20water&format=rss");
      return new Response(SAMPLE_BING_RSS, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const urls = await keylessWebSearch("charity: water", 5);
    expect(urls).toEqual(["https://www.charitywater.org/", "https://en.wikipedia.org/wiki/Charity:_water"]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Bing succeeded, no DDG fallback
  });

  it("falls back to DuckDuckGo when Bing yields no results (e.g. 202 anomaly page)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("www.bing.com")) return new Response("anomaly challenge", { status: 202 });
      expect(url).toContain("html.duckduckgo.com/html/?q=charity%3A%20water");
      return new Response(SAMPLE_DDG_HTML, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const urls = await keylessWebSearch("charity: water", 5);
    expect(urls).toEqual(["https://www.charitywater.org/", "https://en.wikipedia.org/wiki/Charity:_water"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("degrades to an empty array (never throws) when both engines fail", async () => {
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
