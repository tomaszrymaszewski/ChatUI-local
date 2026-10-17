import { describe, expect, it } from "vitest";
import {
  buildPostRunSuggestionPrompt,
  parsePostRunSuggestion,
  SUGGESTION_MODES,
  type SuggestionConnectorOption,
  type SuggestionSkillOption,
} from "./suggestions";

const SKILLS: SuggestionSkillOption[] = [
  { name: "pptx", title: "PowerPoint decks", description: "Create and edit .pptx decks." },
  { name: "blender", title: "Blender 3D", description: "Model, render, and script Blender scenes." },
];

const CONNECTORS: SuggestionConnectorOption[] = [
  { id: "gmail", name: "Gmail", tagline: "Read and send email." },
  { id: "notion", name: "Notion", tagline: "Search and update Notion pages." },
];

describe("buildPostRunSuggestionPrompt", () => {
  it("lists only the provided options and the mode whitelist", () => {
    const { system, user } = buildPostRunSuggestionPrompt({
      transcript: [
        { role: "user", content: "make me a slide deck" },
        { role: "assistant", content: "I can help with that." },
      ],
      skills: SKILLS,
      connectors: CONNECTORS,
      allowModes: true,
    });
    expect(user).toContain("pptx — PowerPoint decks");
    expect(user).toContain("gmail — Gmail");
    expect(user).toContain(`Modes: ${SUGGESTION_MODES.join(", ")}`);
    expect(user).toContain("User: make me a slide deck");
    expect(system).toContain('{"kind":"skill"|"connector"|"mode"');
    expect(system).toContain("most replies need NO card");
  });

  it("omits modes and the mode kind when modes are not allowed", () => {
    const { system, user } = buildPostRunSuggestionPrompt({
      transcript: [{ role: "user", content: "hi" }],
      skills: [],
      connectors: CONNECTORS,
      allowModes: false,
    });
    expect(user).not.toContain("Modes:");
    expect(user).not.toContain("Not-installed skills");
    expect(system).not.toContain('|"mode"');
  });
});

describe("parsePostRunSuggestion", () => {
  const opts = { skills: SKILLS, connectors: CONNECTORS, allowModes: true };

  it("accepts a skill from the provided list", () => {
    const out = parsePostRunSuggestion(
      '{"kind":"skill","target":"pptx","title":"Install PowerPoint skill","reason":"You asked for slides."}',
      opts,
    );
    expect(out).toEqual({
      kind: "skill",
      target: "pptx",
      title: "Install PowerPoint skill",
      reason: "You asked for slides.",
    });
  });

  it("accepts a connector from the provided list", () => {
    const out = parsePostRunSuggestion(
      '{"kind":"connector","target":"gmail","title":"Connect Gmail","reason":"To send the draft."}',
      opts,
    );
    expect(out?.kind).toBe("connector");
    expect(out?.target).toBe("gmail");
  });

  it("accepts a whitelisted mode only when modes are allowed", () => {
    const raw = '{"kind":"mode","target":"research","title":"Research mode","reason":"Deep dive."}';
    expect(parsePostRunSuggestion(raw, opts)?.kind).toBe("mode");
    expect(parsePostRunSuggestion(raw, { ...opts, allowModes: false })).toBeNull();
  });

  it("rejects targets that are not in the catalogs", () => {
    expect(
      parsePostRunSuggestion('{"kind":"skill","target":"nonexistent"}', opts),
    ).toBeNull();
    expect(
      parsePostRunSuggestion('{"kind":"connector","target":"notion-2"}', opts),
    ).toBeNull();
    expect(
      parsePostRunSuggestion('{"kind":"mode","target":"task"}', opts),
    ).toBeNull();
  });

  it("returns null for none, malformed JSON, and missing fields", () => {
    expect(parsePostRunSuggestion('{"kind":"none"}', opts)).toBeNull();
    expect(parsePostRunSuggestion("no json here", opts)).toBeNull();
    expect(parsePostRunSuggestion('{"kind":"skill"}', opts)).toBeNull();
    expect(parsePostRunSuggestion("", opts)).toBeNull();
  });

  it("fills a default title and reason when the model omits them", () => {
    const out = parsePostRunSuggestion('{"kind":"skill","target":"blender"}', opts);
    expect(out?.title).toContain("Blender 3D");
    expect(out?.reason).toBeTruthy();
  });

  it("tolerates surrounding prose around the JSON object", () => {
    const out = parsePostRunSuggestion(
      'Here is my verdict: {"kind":"connector","target":"notion"} — done.',
      opts,
    );
    expect(out?.kind).toBe("connector");
    expect(out?.target).toBe("notion");
  });
});
