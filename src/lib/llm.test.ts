import { describe, it, expect } from "vitest";
import { capTitleWords, instantChatTitle } from "@/lib/llm";

describe("capTitleWords", () => {
  it("keeps a short title unchanged (minus trailing punctuation)", () => {
    expect(capTitleWords("Rust async patterns.")).toBe("Rust async patterns");
  });

  it("truncates to 4 words", () => {
    expect(capTitleWords("How do I parse a JSON file in Rust", 4)).toBe(
      "How do I parse",
    );
  });

  it("supports a custom word cap", () => {
    expect(capTitleWords("one two three four", 2)).toBe("one two");
  });

  it("strips quotes and newlines", () => {
    expect(capTitleWords('"Reactive\nProgramming" in Vue.js today')).toBe(
      "Reactive Programming in Vue.js",
    );
  });

  it("returns empty for whitespace-only input", () => {
    expect(capTitleWords("   ")).toBe("");
  });
});

describe("instantChatTitle", () => {
  it("uses the first 4 words of the message", () => {
    expect(instantChatTitle("what is the best way to cook rice")).toBe(
      "What is the best",
    );
  });

  it("capitalizes the first letter", () => {
    expect(instantChatTitle("fixing a memory leak")).toBe("Fixing a memory leak");
  });

  it("strips mode-trigger prefixes", () => {
    expect(instantChatTitle("research the history of the Ming dynasty")).toBe(
      "The history of the",
    );
    expect(instantChatTitle("teach me linear algebra")).toBe("Linear algebra");
    expect(instantChatTitle("i want to learn python properly")).toBe(
      "Python properly",
    );
    expect(instantChatTitle("discuss the pros of nuclear power")).toBe(
      "The pros of nuclear",
    );
  });

  it("falls back to New Chat for empty input", () => {
    expect(instantChatTitle("")).toBe("New Chat");
    expect(instantChatTitle("   ")).toBe("New Chat");
  });

  it("handles a message that is only a trigger word", () => {
    expect(instantChatTitle("research")).toBe("New Chat");
  });

  it("falls back to a word-based title for attachments-only sends", () => {
    expect(instantChatTitle("Attachments")).toBe("Attachments");
  });
});
