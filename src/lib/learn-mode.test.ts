import { describe, expect, it } from "vitest";
import {
  buildLearnSystemPrompt,
  loadLearnPreferences,
  DEFAULT_LEARN_PREFERENCES,
} from "@/lib/learn-mode";

describe("buildLearnSystemPrompt", () => {
  const prompt = buildLearnSystemPrompt("beginner", "language");

  it("keeps the tutor role and level/subject guidance", () => {
    expect(prompt).toContain("Learn mode");
    expect(prompt).toContain("patient, encouraging tutor");
    expect(prompt).toContain("beginner");
    expect(prompt).toContain("language learning");
  });

  it("runs the intake through the structured-input form", () => {
    expect(prompt).toContain("request_structured_input");
    expect(prompt).toMatch(/what exactly to learn/i);
    expect(prompt).toContain("2-4 fields");
  });

  it("spreads the assessment over one-question forms", () => {
    expect(prompt).toContain("ONE question per form");
    expect(prompt).toContain("3-5 questions");
    expect(prompt).toMatch(/never the whole assessment in a single form/i);
  });

  it("tells the tutor to restate answers visibly (form answers are ephemeral)", () => {
    expect(prompt).toMatch(/Form answers are NOT saved to the chat/);
    expect(prompt).toMatch(/summarize them yourself/);
  });

  it("mandates bite-sized teaching", () => {
    expect(prompt).toContain("One small piece per message");
    expect(prompt).toMatch(/Very simple language/i);
    expect(prompt).toContain("ONE small question or task");
    expect(prompt).toContain("wait for their answer");
  });
});

describe("loadLearnPreferences", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadLearnPreferences()).toEqual(DEFAULT_LEARN_PREFERENCES);
  });
});
