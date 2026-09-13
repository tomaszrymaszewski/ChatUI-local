import { describe, expect, it } from "vitest";
import { buildKnowledgeBlock } from "./knowledge-retrieval";
import type { KnowledgeHit } from "./knowledge-index";

function hit(over: Partial<KnowledgeHit>): KnowledgeHit {
  return {
    id: "h1",
    sourceType: "chat",
    sourceRef: "s1",
    sourceTitle: "Chat title",
    chunkIndex: 0,
    text: "hello world",
    extra: null,
    distance: 0.1,
    ...over,
  };
}

describe("buildKnowledgeBlock (skills/connectors split)", () => {
  it("splits capability hits into their own section with actionable hints", () => {
    const block = buildKnowledgeBlock([
      hit({
        id: "k1",
        sourceType: "skill",
        sourceRef: "pptx",
        sourceTitle: "Presentations",
        extra: { kind: "catalog" },
      }),
      hit({
        id: "k2",
        sourceType: "connector",
        sourceRef: "notion",
        sourceTitle: "Notion",
        text: "Notion. Read and update pages.",
      }),
      hit({ id: "k3", sourceType: "chat" }),
    ]);
    expect(block).toContain("Relevant skills & connectors");
    expect(block).toContain("Relevant knowledge from the user's library");
    // Uninstalled catalog skill → search_skills hint with the exact query.
    expect(block).toContain('search_skills("pptx")');
    // Skills section comes before the user-data section.
    expect(block.indexOf("Relevant skills")).toBeLessThan(block.indexOf("Relevant knowledge"));
  });

  it("points at the virtual path for installed/bundled skills", () => {
    const block = buildKnowledgeBlock([
      hit({
        id: "k1",
        sourceType: "skill_doc",
        sourceRef: "fastapi",
        sourceTitle: "fastapi",
        extra: { kind: "installed" },
      }),
    ]);
    expect(block).toContain("read_file /skills/fastapi/SKILL.md");
    expect(block).not.toContain("search_skills");
  });

  it("returns only the user-data section when no skills/connectors match", () => {
    const block = buildKnowledgeBlock([hit({})]);
    expect(block).not.toContain("Relevant skills");
    expect(block).toContain("Relevant knowledge from the user's library");
  });

  it("returns empty when there are no hits", () => {
    expect(buildKnowledgeBlock([])).toBe("");
  });
});
