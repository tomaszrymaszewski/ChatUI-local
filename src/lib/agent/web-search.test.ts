import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserFetch, httpFetch } from "@/lib/http-fetch";
import {
  bingHtmlUrl,
  bingRssUrl,
  ddgHtmlUrl,
  extractBingHtmlResults,
  extractBingRssResults,
  extractDuckDuckGoResults,
  unwrapBingRedirect,
  webSearch,
} from "./web-search";

vi.mock("@/lib/http-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http-fetch")>();
  return { ...actual, httpFetch: vi.fn(), browserFetch: vi.fn() };
});

const SAMPLE_BING_RSS = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>Bing: charity water</title><link>http://www.bing.com:80/search?q=charity+water</link><description>Search results</description>
<item><title>charity: water</title><link>https://www.charitywater.org/</link><description>clean water for everyone</description></item>
<item><title>Charity: water - Wikipedia</title><link>https://en.wikipedia.org/wiki/Charity:_water</link><description>org page</description></item>
</channel></rss>`;

const SAMPLE_DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.charitywater.org%2F&amp;rut=abc">charity: water</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FCharity%3A_water&amp;rut=def">Charity: water - Wikipedia</a>
</div>
`;

describe("extractBingRssResults", () => {
  it("pulls title, url, and snippet out of <item> blocks", () => {
    const results = extractBingRssResults(SAMPLE_BING_RSS, 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("charity: water");
    expect(results[0].url).toBe("https://www.charitywater.org/");
    expect(results[0].snippet).toBe("clean water for everyone");
    expect(results[1].url).toBe("https://en.wikipedia.org/wiki/Charity:_water");
  });

  it("caps at maxResults", () => {
    const results = extractBingRssResults(SAMPLE_BING_RSS, 1);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://www.charitywater.org/");
  });

  it("returns an empty array for XML with no items", () => {
    expect(extractBingRssResults("<rss><channel></channel></rss>", 5)).toEqual([]);
  });

  it("dedupes repeated result URLs", () => {
    const xml = SAMPLE_BING_RSS + SAMPLE_BING_RSS;
    expect(extractBingRssResults(xml, 10)).toHaveLength(2);
  });

  it("unwraps CDATA-wrapped links and titles", () => {
    const xml =
      "<item><title><![CDATA[My Title]]></title><link><![CDATA[https://example.com/]]></link><description><![CDATA[<p>desc</p>]]></description></item>";
    const results = extractBingRssResults(xml, 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("My Title");
    expect(results[0].url).toBe("https://example.com/");
    expect(results[0].snippet).toBe("desc");
  });

  it("falls back to url as title when title is empty", () => {
    const xml = "<item><link>https://example.com/</link></item>";
    const results = extractBingRssResults(xml, 5);
    expect(results[0].title).toBe("https://example.com/");
  });
});

describe("extractDuckDuckGoResults", () => {
  it("pulls title and url from result__a anchors", () => {
    const results = extractDuckDuckGoResults(SAMPLE_DDG_HTML, 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("charity: water");
    expect(results[0].url).toBe("https://www.charitywater.org/");
    expect(results[1].url).toBe("https://en.wikipedia.org/wiki/Charity:_water");
  });

  it("caps at maxResults", () => {
    const results = extractDuckDuckGoResults(SAMPLE_DDG_HTML, 1);
    expect(results).toHaveLength(1);
  });

  it("returns an empty array for HTML with no results", () => {
    expect(extractDuckDuckGoResults("<html><body>nothing</body></html>", 5)).toEqual([]);
  });

  it("dedupes repeated result URLs", () => {
    const html = SAMPLE_DDG_HTML + SAMPLE_DDG_HTML;
    expect(extractDuckDuckGoResults(html, 10)).toHaveLength(2);
  });

  it("falls back to raw uddg extraction when class-based regex misses", () => {
    const html = `<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">link</a>`;
    const results = extractDuckDuckGoResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/page");
  });
});

describe("unwrapBingRedirect", () => {
  it("unwraps /ck/a redirects to the real target URL", () => {
    expect(
      unwrapBingRedirect(
        "https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly93d3cuY2hhcml0eXdhdGVyLm9yZy8%3D&ntb=1",
      ),
    ).toBe("https://www.charitywater.org/");
  });

  it("passes direct URLs through untouched", () => {
    expect(unwrapBingRedirect("https://www.charitywater.org/")).toBe("https://www.charitywater.org/");
  });

  it("returns empty for a redirect with no decodable target", () => {
    expect(unwrapBingRedirect("https://www.bing.com/ck/a?!&p=abc&ntb=1")).toBe("");
  });
});

describe("extractBingHtmlResults", () => {
  const SAMPLE_BING_HTML = `
<ul class="b_vList">
<li class="b_algo"><div class="b_tpcn"><a class="tilk" href="https://www.bing.com/ck/a?!&amp;&amp;p=favicon&amp;u=a1aHR0cHM6Ly93d3cuY2hhcml0eXdhdGVyLm9yZy8&amp;ntb=1"><div class="tpic"></div></a></div><h2><a href="https://www.charitywater.org/">charity: water</a></h2><p>clean water for everyone</p></li>
<li class="b_algo" data-priority="2"><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvQ2hhcml0eTpfd2F0ZXI=&amp;ntb=1">Charity: <strong>water</strong> - Wikipedia</a></h2><div class="b_caption"><p>org page &amp; more</p></div></li>
<li class="b_ad"><h2><a href="https://ads.example.com/">Sponsored</a></h2><p>buy things</p></li>
</ul>`;

  it("pulls title, url, and snippet out of b_algo blocks", () => {
    const results = extractBingHtmlResults(SAMPLE_BING_HTML, 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("charity: water");
    expect(results[0].url).toBe("https://www.charitywater.org/");
    expect(results[0].snippet).toBe("clean water for everyone");
    expect(results[1].title).toBe("Charity: water - Wikipedia");
    expect(results[1].url).toBe("https://en.wikipedia.org/wiki/Charity:_water");
    expect(results[1].snippet).toBe("org page & more");
  });

  it("prefers the h2 title anchor over the earlier favicon anchor", () => {
    const results = extractBingHtmlResults(SAMPLE_BING_HTML, 5);
    expect(results[0].title).not.toContain("tpic");
    expect(results[0].url).toBe("https://www.charitywater.org/");
  });

  it("ignores sponsored (b_ad) blocks", () => {
    const results = extractBingHtmlResults(SAMPLE_BING_HTML, 5);
    expect(results.some((r) => r.url.includes("ads.example.com"))).toBe(false);
  });

  it("caps at maxResults", () => {
    expect(extractBingHtmlResults(SAMPLE_BING_HTML, 1)).toHaveLength(1);
  });

  it("returns an empty array for HTML with no results", () => {
    expect(extractBingHtmlResults("<html><body>nothing</body></html>", 5)).toEqual([]);
  });

  it("dedupes repeated result URLs", () => {
    expect(extractBingHtmlResults(SAMPLE_BING_HTML + SAMPLE_BING_HTML, 10)).toHaveLength(2);
  });
});

describe("webSearch backend order", () => {
  const plainRss = (body: string) => ({
    status: 200,
    statusText: "OK",
    contentType: "application/rss+xml",
    body,
  });
  const renderedHtml = (body: string) => ({
    status: 200,
    statusText: "OK",
    contentType: "text/html",
    body,
  });

  beforeEach(() => {
    vi.mocked(httpFetch).mockReset();
    vi.mocked(browserFetch).mockReset();
    // Plain HTTP finds nothing by default; each test opts into a hit.
    vi.mocked(httpFetch).mockResolvedValue(plainRss("<rss><channel></channel></rss>"));
  });

  it("serves headless-Chrome DuckDuckGo results before touching plain HTTP", async () => {
    vi.mocked(browserFetch).mockResolvedValue(renderedHtml(SAMPLE_DDG_HTML));
    const results = await webSearch("charity water", 5);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://www.charitywater.org/");
    expect(vi.mocked(browserFetch).mock.calls[0][0]).toContain("duckduckgo.com");
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("falls through to headless-Chrome Bing HTML when DuckDuckGo is empty", async () => {
    vi.mocked(browserFetch)
      .mockResolvedValueOnce(renderedHtml("<html><body>no results</body></html>"))
      .mockResolvedValueOnce(
        renderedHtml(
          `<li class="b_algo"><h2><a href="https://www.charitywater.org/">charity: water</a></h2><p>clean water</p></li>`,
        ),
      );
    const results = await webSearch("charity water", 5);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://www.charitywater.org/");
    expect(vi.mocked(browserFetch).mock.calls[1][0]).toContain("bing.com");
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("falls back to plain-HTTP Bing RSS when no browser is available", async () => {
    vi.mocked(browserFetch).mockRejectedValue(new Error("headless browser fetch is only available in the desktop app"));
    vi.mocked(httpFetch).mockResolvedValue(plainRss(SAMPLE_BING_RSS));
    const results = await webSearch("charity water", 5);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://www.charitywater.org/");
  });

  it("skips a bot-challenged browser render and keeps going", async () => {
    vi.mocked(browserFetch)
      .mockResolvedValueOnce(renderedHtml("<html><body><div class='anomaly-modal'>challenge</div></body></html>"))
      .mockResolvedValueOnce(renderedHtml("<html><body>no results</body></html>"));
    vi.mocked(httpFetch).mockResolvedValue(plainRss(SAMPLE_BING_RSS));
    const results = await webSearch("charity water", 5);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://www.charitywater.org/");
  });

  it("returns an empty array when every backend misses", async () => {
    vi.mocked(browserFetch).mockResolvedValue(renderedHtml("<html><body>no results</body></html>"));
    await expect(webSearch("charity water", 5)).resolves.toEqual([]);
  });
});

describe("search url builders", () => {
  it("pins Bing RSS to the en-US market (no IP-based geo results)", () => {
    const url = new URL(bingRssUrl("charity water & clean"));
    expect(url.origin + url.pathname).toBe("https://www.bing.com/search");
    expect(url.searchParams.get("q")).toBe("charity water & clean");
    expect(url.searchParams.get("format")).toBe("rss");
    expect(url.searchParams.get("mkt")).toBe("en-US");
    expect(url.searchParams.get("setlang")).toBe("en");
    expect(url.searchParams.get("cc")).toBe("US");
  });

  it("pins DuckDuckGo to no-region so results follow the query, not the IP", () => {
    const url = new URL(ddgHtmlUrl("charity water"));
    expect(url.origin + url.pathname).toBe("https://html.duckduckgo.com/html/");
    expect(url.searchParams.get("q")).toBe("charity water");
    expect(url.searchParams.get("kl")).toBe("wt-wt");
  });

  it("pins Bing HTML to the en-US market (no IP-based geo results)", () => {
    const url = new URL(bingHtmlUrl("charity water"));
    expect(url.origin + url.pathname).toBe("https://www.bing.com/search");
    expect(url.searchParams.get("q")).toBe("charity water");
    expect(url.searchParams.get("mkt")).toBe("en-US");
    expect(url.searchParams.get("setlang")).toBe("en");
    expect(url.searchParams.get("cc")).toBe("US");
    expect(url.searchParams.get("format")).toBeNull();
  });
});
