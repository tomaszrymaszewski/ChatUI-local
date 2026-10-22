import { describe, expect, it } from "vitest";
import { chunkStreamingMarkdown, splitTextAtWorkEnds } from "@/lib/work-segments";
import type { WorkSegment } from "@/lib/agent/types";

function segment(id: string, textOffset: number, endTextOffset?: number): WorkSegment {
  return { id, startedAt: 0, textOffset, endTextOffset };
}

describe("splitTextAtWorkEnds", () => {
  it("splits content at each work block end", () => {
    const content = "First part. Second part. Third part.";
    const segments = [
      segment("work-1", 0, "First part. ".length),
      segment("work-2", "First part. ".length, "First part. Second part. ".length),
    ];
    expect(splitTextAtWorkEnds(content, segments)).toEqual([
      "First part. ",
      "Second part. ",
      "Third part.",
    ]);
  });

  it("keeps a single part when the text all arrived after the only work block", () => {
    const content = "Only answer text.";
    expect(splitTextAtWorkEnds(content, [segment("work-1", 0, content.length)])).toEqual([
      "Only answer text.",
    ]);
  });

  it("falls back to textOffset when a segment has no end offset", () => {
    const content = "One. Two.";
    const segments = [segment("work-1", 0), segment("work-2", "One. ".length)];
    expect(splitTextAtWorkEnds(content, segments)).toEqual(["One. ", "Two."]);
  });

  it("ignores boundaries at 0, past the end, and duplicates", () => {
    const content = "Text.";
    const segments = [
      segment("work-1", 0, 0),
      segment("work-2", 0, 0),
      segment("work-3", 0, content.length),
      segment("work-4", 0, content.length + 5),
    ];
    expect(splitTextAtWorkEnds(content, segments)).toEqual(["Text."]);
  });

  it("drops whitespace-only parts and returns the content when there are no segments", () => {
    const content = "Answer. \n\n";
    expect(splitTextAtWorkEnds(content, [segment("work-1", 0, "Answer. ".length)])).toEqual([
      "Answer. ",
    ]);
    expect(splitTextAtWorkEnds(content, [])).toEqual(["Answer. \n\n"]);
  });

  it("sorts out-of-order segments by boundary", () => {
    const content = "AA BB CC";
    const segments = [segment("work-2", 0, "AA BB ".length), segment("work-1", 0, "AA ".length)];
    expect(splitTextAtWorkEnds(content, segments)).toEqual(["AA ", "BB ", "CC"]);
  });
});

describe("chunkStreamingMarkdown", () => {
  const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(4);

  it("returns small content as a single chunk", () => {
    expect(chunkStreamingMarkdown("short text")).toEqual(["short text"]);
    expect(chunkStreamingMarkdown("a".repeat(2999))).toEqual(["a".repeat(2999)]);
  });

  it("splits at blank lines once the chunk reaches the minimum size", () => {
    const content = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkStreamingMarkdown(content, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // Exactly one newline (the blank line's) is dropped per cut.
    expect(chunks.join("\n")).toBe(content);
  });

  it("never splits inside a fenced code block, even across blank lines", () => {
    const code = `\`\`\`python\n${"x = 1\n\n".repeat(50)}\`\`\``;
    const content = `${para}\n\n${code}\n\n${para}`;
    const chunks = chunkStreamingMarkdown(content, 100);
    expect(chunks.some((c) => c.includes("```python") && !c.trimEnd().endsWith("```"))).toBe(false);
    expect(chunks.some((c) => c.includes("```python"))).toBe(true);
  });

  it("never splits inside a $$ math block", () => {
    const math = `$$\n${"x^2 + y^2\n\n".repeat(50)}$$`;
    const content = `${para}\n\n${math}\n\n${para}`;
    const chunks = chunkStreamingMarkdown(content, 100);
    const mathChunk = chunks.find((c) => c.includes("$$"));
    expect(mathChunk?.trim()).toBe(math);
    expect(chunks.join("\n")).toBe(content);
  });

  it("keeps leading chunk contents stable as content grows (memo-safety)", () => {
    const first = `${para}\n\n${para}\n\n${para}`;
    const grown = `${first}\n\n${para}\n\n${para}\n\n${para}`;
    const before = chunkStreamingMarkdown(first, 100);
    const after = chunkStreamingMarkdown(grown, 100);
    // Every chunk but possibly the last must be byte-identical after growth.
    for (let i = 0; i < before.length - 1; i++) {
      expect(after[i]).toBe(before[i]);
    }
    expect(after.length).toBeGreaterThanOrEqual(before.length);
  });
});
