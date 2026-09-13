import { describe, expect, it } from "vitest";
import {
  applySkillDiskHeader,
  applySkillRuntimeNotes,
  MAX_ADVERTISED_SKILLS,
  virtualSkillPathToReal,
} from "./skills";

const PPTX_MD = `---
name: pptx
description: Create and edit PowerPoint decks.
---

# PPTX creation

| Task | Approach |
|---|---|
| **Create** a new deck | Write a \`pptxgenjs\` script |
`;

describe("applySkillRuntimeNotes", () => {
  it("injects the runtime note right after the front-matter for document skills", () => {
    const out = applySkillRuntimeNotes("pptx", PPTX_MD);
    const lines = out.split("\n");
    // Front-matter block stays first and intact.
    expect(lines[0]).toBe("---");
    expect(lines[3]).toBe("---");
    expect(lines[4]).toBe("");
    expect(lines[5]).toContain("App runtime note");
    expect(out).toContain("python-pptx");
    expect(out).toContain("pptxgenjs/Node creation path below is disabled");
    // The original skill content is preserved below the note.
    expect(out).toContain("pptxgenjs` script");
  });

  it("leaves skills without a runtime note untouched", () => {
    expect(applySkillRuntimeNotes("xlsx", PPTX_MD)).toBe(PPTX_MD);
    expect(applySkillRuntimeNotes("fastapi", PPTX_MD)).toBe(PPTX_MD);
  });

  it("prepends the note when the content has no front-matter", () => {
    const out = applySkillRuntimeNotes("docx", "# no front matter");
    expect(out).toMatch(/^> \*\*App runtime note[\s\S]*python-docx[\s\S]*# no front matter$/);
  });
});

describe("virtualSkillPathToReal", () => {
  const dir = "/Users/me/Library/Application Support/com.tomaszrymaszewski.chatui/skills";

  it("maps /skills/<name>/… onto the real skills directory", () => {
    expect(virtualSkillPathToReal("/skills/pptx/SKILL.md", dir)).toBe(
      `${dir}/pptx/SKILL.md`,
    );
    expect(virtualSkillPathToReal("/skills/pptx/scripts/thumbnail.py", dir)).toBe(
      `${dir}/pptx/scripts/thumbnail.py`,
    );
  });

  it("returns null for non-skill paths, bare /skills, and traversal attempts", () => {
    expect(virtualSkillPathToReal("/etc/passwd", dir)).toBeNull();
    expect(virtualSkillPathToReal("/skills", dir)).toBeNull();
    expect(virtualSkillPathToReal("/skills/", dir)).toBeNull();
    expect(virtualSkillPathToReal("/skills/../secrets.txt", dir)).toBeNull();
    expect(virtualSkillPathToReal("/skills/pptx/../../x", dir)).toBeNull();
  });
});

describe("applySkillDiskHeader", () => {
  it("states the real disk location after the front-matter so parsing still works", () => {
    const dir = "/Users/me/AppData";
    const out = applySkillDiskHeader("pptx", `${dir}/pptx`, PPTX_MD);
    const lines = out.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[3]).toBe("---");
    expect(out).toContain(`Disk location`);
    expect(out).toContain(`${dir}/pptx`);
    expect(out).toContain("read_file` on the virtual path `/skills/pptx/SKILL.md`");
    expect(out).toContain("# PPTX creation");
  });

  it("keeps the runtime note when both are applied (header first)", () => {
    const out = applySkillDiskHeader(
      "pptx",
      "/skills-home/pptx",
      applySkillRuntimeNotes("pptx", PPTX_MD),
    );
    const headerIdx = out.indexOf("Disk location");
    const noteIdx = out.indexOf("App runtime note");
    expect(headerIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(headerIdx);
    // Front-matter stays parseable at the top.
    expect(out.startsWith("---\nname: pptx")).toBe(true);
  });
});

describe("MAX_ADVERTISED_SKILLS", () => {
  it("caps the advertised skill list at a prompt-friendly number", () => {
    expect(MAX_ADVERTISED_SKILLS).toBeGreaterThanOrEqual(10);
    expect(MAX_ADVERTISED_SKILLS).toBeLessThanOrEqual(50);
  });
});
