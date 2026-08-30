import { describe, expect, it } from "vitest";
import { extractBingRssResults, extractDuckDuckGoResults } from "./web-search";

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
