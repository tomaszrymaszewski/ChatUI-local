import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/files", () => ({
  extractFileText: vi.fn(),
}));
vi.mock("@/lib/tools", () => ({
  executeTool: vi.fn(),
}));

import { extractFileText } from "@/lib/files";
import { executeTool } from "@/lib/tools";
import {
  looksLikeUrlList,
  extractUrlsFromText,
  fetchUrlContent,
  buildResearchSeed,
  computeExpansionFrontier,
  validateResearchInput,
  NoResearchInputError,
  type SeedFile,
  type SeedResult,
} from "./seed";

const mockedExtractFileText = vi.mocked(extractFileText);
const mockedExecuteTool = vi.mocked(executeTool);

beforeEach(() => {
  mockedExtractFileText.mockReset();
  mockedExecuteTool.mockReset();
});

describe("seed: looksLikeUrlList", () => {
  it("returns true for a plain list of URLs", () => {
    expect(looksLikeUrlList("https://a.com\nhttps://b.com\nhttps://c.com")).toBe(true);
  });

  it("returns false for prose", () => {
    expect(looksLikeUrlList("This is a regular paragraph of text with no urls in it at all.")).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(looksLikeUrlList("")).toBe(false);
  });

  it("returns false when fewer than 80% of lines are URLs", () => {
    expect(looksLikeUrlList("https://a.com\nsome text\nmore text\nother text\nyet more")).toBe(false);
  });
});

describe("seed: extractUrlsFromText", () => {
  it("extracts URLs from surrounding prose", () => {
    expect(extractUrlsFromText("See https://example.com/page for details.")).toEqual(["https://example.com/page"]);
  });

  it("strips trailing punctuation", () => {
    expect(extractUrlsFromText("Check this out: https://example.com/page.")).toEqual(["https://example.com/page"]);
  });

  it("de-duplicates repeated URLs", () => {
    expect(extractUrlsFromText("https://a.com and again https://a.com")).toEqual(["https://a.com"]);
  });

  it("returns an empty array when there are no URLs", () => {
    expect(extractUrlsFromText("no links here")).toEqual([]);
  });
});

describe("seed: fetchUrlContent", () => {
  it("returns the fetched content on success", async () => {
    mockedExecuteTool.mockResolvedValue({ tool_call_id: "x", content: "page body" });
    expect(await fetchUrlContent("https://example.com")).toBe("page body");
  });

  it("returns null (never throws) when the tool reports an error", async () => {
    mockedExecuteTool.mockResolvedValue({ tool_call_id: "x", content: "Error: fetch failed" });
    expect(await fetchUrlContent("https://example.com")).toBeNull();
  });
});

describe("seed: buildResearchSeed", () => {
  it("treats a URL-list file as URLs to fetch, not literal text", async () => {
    mockedExtractFileText.mockResolvedValue("https://a.com\nhttps://b.com");
    mockedExecuteTool.mockResolvedValue({ tool_call_id: "x", content: "fetched body" });

    const files: SeedFile[] = [{ name: "urls.txt", file: new File([""], "urls.txt") }];
    const seed = await buildResearchSeed(files, []);

    expect(seed.fetchedUrls).toEqual(["https://a.com", "https://b.com"]);
    expect(seed.sourceCount).toBe(2);
    expect(seed.text).toContain("fetched body");
  });

  it("treats a regular document as literal grounding text", async () => {
    mockedExtractFileText.mockResolvedValue("This document explains photosynthesis in detail.");

    const files: SeedFile[] = [{ name: "doc.txt", file: new File([""], "doc.txt") }];
    const seed = await buildResearchSeed(files, []);

    expect(seed.sourceCount).toBe(1);
    expect(seed.fetchedUrls).toEqual([]);
    expect(seed.text).toContain("photosynthesis");
    expect(seed.text).toContain("doc.txt");
  });

  it("degrades gracefully when file extraction fails", async () => {
    mockedExtractFileText.mockResolvedValue("");

    const files: SeedFile[] = [{ name: "broken.pdf", file: new File([""], "broken.pdf") }];
    const seed = await buildResearchSeed(files, []);

    expect(seed.text).toContain("Could not extract content");
    expect(seed.sourceCount).toBe(0);
  });

  it("fetches direct URLs and tracks them", async () => {
    mockedExecuteTool.mockResolvedValue({ tool_call_id: "x", content: "direct url body" });

    const seed = await buildResearchSeed([], ["https://example.com/direct"]);

    expect(seed.fetchedUrls).toEqual(["https://example.com/direct"]);
    expect(seed.sourceCount).toBe(1);
    expect(seed.text).toContain("direct url body");
  });

  it("returns an empty result for no files and no URLs", async () => {
    const seed = await buildResearchSeed([], []);
    expect(seed.sourceCount).toBe(0);
    expect(seed.fetchedUrls).toEqual([]);
    expect(seed.text).toBe("");
  });
});

describe("seed: computeExpansionFrontier", () => {
  it("returns every linked URL when the seed has no home URLs", () => {
    const seed: SeedResult = { text: "See https://a.com and https://b.com", sourceCount: 1, fetchedUrls: [] };
    expect(computeExpansionFrontier(seed)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("restricts to the same domain(s) as the seed's home URLs", () => {
    const seed: SeedResult = {
      text: "Related: https://home.com/other-page and https://unrelated.com/page",
      sourceCount: 1,
      fetchedUrls: ["https://home.com/main"],
    };
    expect(computeExpansionFrontier(seed)).toEqual(["https://home.com/other-page"]);
  });

  it("excludes URLs that are already fetchedUrls", () => {
    const seed: SeedResult = {
      text: "https://home.com/main and https://home.com/other",
      sourceCount: 1,
      fetchedUrls: ["https://home.com/main"],
    };
    expect(computeExpansionFrontier(seed)).toEqual(["https://home.com/other"]);
  });
});

describe("seed: validateResearchInput / NoResearchInputError", () => {
  it("throws NoResearchInputError when both topic and seed are empty", () => {
    expect(() => validateResearchInput(undefined, undefined)).toThrow(NoResearchInputError);
    expect(() => validateResearchInput("   ", "")).toThrow(NoResearchInputError);
  });

  it("does not throw when a topic is present", () => {
    expect(() => validateResearchInput("a topic", undefined)).not.toThrow();
  });

  it("does not throw when seed text is present", () => {
    expect(() => validateResearchInput(undefined, "some seed text")).not.toThrow();
  });
});
