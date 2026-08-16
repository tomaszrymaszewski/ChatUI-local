import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildResearchSeed,
  computeExpansionFrontier,
  extractUrlsFromText,
  looksLikeUrlList,
  NoResearchInputError,
  validateResearchInput,
} from "./seed";

function textFile(name: string, content: string): { name: string; file: File } {
  return { name, file: new File([content], name, { type: "text/plain" }) };
}

describe("looksLikeUrlList", () => {
  it("recognizes a file that's mostly one URL per line", () => {
    const text = "https://a.com/report\nhttps://b.org/page\nhttps://c.net/doc";
    expect(looksLikeUrlList(text)).toBe(true);
  });

  it("rejects normal prose that happens to mention a URL", () => {
    const text = "This report discusses the org's funding.\nSee https://a.com for more.\nFounded in 2005.";
    expect(looksLikeUrlList(text)).toBe(false);
  });

  it("rejects empty text", () => {
    expect(looksLikeUrlList("")).toBe(false);
  });
});

describe("extractUrlsFromText", () => {
  it("pulls URLs out of prose and dedupes them", () => {
    const text = "Visit https://a.com/x and also https://a.com/x again, plus https://b.org/y.";
    expect(extractUrlsFromText(text)).toEqual(["https://a.com/x", "https://b.org/y"]);
  });

  it("strips trailing sentence punctuation", () => {
    const text = "Source: https://a.com/report.";
    expect(extractUrlsFromText(text)).toEqual(["https://a.com/report"]);
  });

  it("returns an empty array when there are no URLs", () => {
    expect(extractUrlsFromText("no links here")).toEqual([]);
  });
});

describe("validateResearchInput", () => {
  it("throws NoResearchInputError when neither topic nor seed is given", () => {
    expect(() => validateResearchInput(undefined, undefined)).toThrow(NoResearchInputError);
    expect(() => validateResearchInput("  ", "")).toThrow(NoResearchInputError);
  });

  it("passes with only a topic", () => {
    expect(() => validateResearchInput("charity: water", undefined)).not.toThrow();
  });

  it("passes with only a seed", () => {
    expect(() => validateResearchInput(undefined, "some seed text")).not.toThrow();
  });

  it("passes with both", () => {
    expect(() => validateResearchInput("charity: water", "some seed text")).not.toThrow();
  });
});

describe("buildResearchSeed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("inlines a normal document's extracted text, labeled by filename", async () => {
    const { text, sourceCount } = await buildResearchSeed([textFile("report.txt", "Founded in 2005. Mission: clean water.")]);
    expect(text).toContain("--- report.txt ---");
    expect(text).toContain("Founded in 2005");
    expect(sourceCount).toBe(1);
  });

  it("treats a file that's mostly a URL list as URLs to fetch, not literal text", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(`content for ${url}`, { status: 200, headers: { "content-type": "text/plain" } }));
    vi.stubGlobal("fetch", fetchMock);

    const urlListFile = textFile("links.txt", "https://a.com/report\nhttps://b.org/page");
    const { text, sourceCount } = await buildResearchSeed([urlListFile]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text).toContain("--- https://a.com/report ---");
    expect(text).toContain("content for https://a.com/report");
    expect(text).toContain("--- https://b.org/page ---");
    expect(sourceCount).toBe(2);
  });

  it("fetches directly-provided URLs alongside any files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(`content for ${url}`, { status: 200, headers: { "content-type": "text/plain" } })),
    );

    const { text, sourceCount } = await buildResearchSeed(
      [textFile("report.txt", "Some prose content about the organization.")],
      ["https://c.net/extra"],
    );

    expect(text).toContain("--- report.txt ---");
    expect(text).toContain("--- https://c.net/extra ---");
    expect(sourceCount).toBe(2);
  });

  it("degrades gracefully when a URL fetch fails, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));

    const { text, sourceCount } = await buildResearchSeed([], ["https://dead-link.example/x"]);

    expect(text).toContain("[Could not fetch this URL]");
    expect(sourceCount).toBe(1); // still counted as an attempted source
  });
});

describe("computeExpansionFrontier", () => {
  it("allows any embedded link when the seed has no home URLs (pure uploaded document)", () => {
    const seed = {
      text: "This report cites https://news.example.com/story and https://gov.example/filing as sources.",
      sourceCount: 1,
      fetchedUrls: [],
    };
    expect(computeExpansionFrontier(seed)).toEqual([
      "https://news.example.com/story",
      "https://gov.example/filing",
    ]);
  });

  it("restricts the frontier to the same domain as the seed's home URLs", () => {
    const seed = {
      text: "--- https://a.com/report ---\nSee also https://a.com/appendix and, unrelated, https://tracker.example/pixel.",
      sourceCount: 1,
      fetchedUrls: ["https://a.com/report"],
    };
    expect(computeExpansionFrontier(seed)).toEqual(["https://a.com/appendix"]);
  });

  it("excludes URLs already fetched as part of the seed itself", () => {
    const seed = {
      text: "--- https://a.com/report ---\nLinks back to https://a.com/report and forward to https://a.com/appendix.",
      sourceCount: 1,
      fetchedUrls: ["https://a.com/report"],
    };
    expect(computeExpansionFrontier(seed)).toEqual(["https://a.com/appendix"]);
  });
});
