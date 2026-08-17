import { describe, it, expect } from "vitest";
import { plan, type PlanInput } from "./planner";
import type { ModelPort, ModelTurnRequest } from "../loop/researchLoop";

function scriptedModel(responses: readonly string[]): ModelPort & { calls: ModelTurnRequest[] } {
  const calls: ModelTurnRequest[] = [];
  let index = 0;
  return {
    calls,
    async complete(request) {
      calls.push(request);
      const response = responses[Math.min(index, responses.length - 1)];
      index++;
      return response;
    },
  };
}

function rejectingModel(): ModelPort {
  return {
    async complete() {
      throw new Error("network failure");
    },
  };
}

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    topic: "How does photosynthesis work?",
    providedUrls: [],
    capabilities: { webSearch: false },
    ...overrides,
  };
}

describe("plan", () => {
  it("builds a ResearchSession with sequential branded ids from a valid plan response", async () => {
    const raw = JSON.stringify({
      subQuestions: ["What is chlorophyll?", "What is the light reaction?", "What is the dark reaction?"],
      strategy: "Cover the light and dark reactions separately.",
    });
    const model = scriptedModel([raw]);

    const session = await plan(baseInput(), model, new AbortController().signal);

    expect(session.subQuestions.map((sq) => sq.id)).toEqual(["SQ1", "SQ2", "SQ3"]);
    expect(session.subQuestions.map((sq) => sq.text)).toEqual([
      "What is chlorophyll?",
      "What is the light reaction?",
      "What is the dark reaction?",
    ]);
    expect(session.subQuestions.every((sq) => sq.status === "open")).toBe(true);
  });

  it("includes the topic in the goal", async () => {
    const model = scriptedModel([JSON.stringify({ subQuestions: ["q1"], strategy: "" })]);

    const session = await plan(baseInput({ topic: "The history of the printing press" }), model, new AbortController().signal);

    expect(session.goal).toContain("The history of the printing press");
  });

  it("embeds provided URLs directly in the goal (the only channel that reaches the loop)", async () => {
    const model = scriptedModel([JSON.stringify({ subQuestions: ["q1"], strategy: "" })]);

    const session = await plan(
      baseInput({ providedUrls: ["https://example.com/a", "https://example.com/b"] }),
      model,
      new AbortController().signal,
    );

    expect(session.goal).toContain("https://example.com/a");
    expect(session.goal).toContain("https://example.com/b");
  });

  it("includes a web-search-unavailable note when capabilities.webSearch is false", async () => {
    const model = scriptedModel([JSON.stringify({ subQuestions: ["q1"], strategy: "" })]);

    const session = await plan(baseInput({ capabilities: { webSearch: false } }), model, new AbortController().signal);

    expect(session.goal).toContain("web_search is not available");
  });

  it("omits the web-search-unavailable note when capabilities.webSearch is true", async () => {
    const model = scriptedModel([JSON.stringify({ subQuestions: ["q1"], strategy: "" })]);

    const session = await plan(baseInput({ capabilities: { webSearch: true } }), model, new AbortController().signal);

    expect(session.goal).not.toContain("web_search is not available");
  });

  it("folds the strategy text into the goal when present", async () => {
    const model = scriptedModel([JSON.stringify({ subQuestions: ["q1"], strategy: "Focus on primary sources." })]);

    const session = await plan(baseInput(), model, new AbortController().signal);

    expect(session.goal).toContain("Focus on primary sources.");
  });

  it("falls back to a single topic-mirroring sub-question on invalid JSON, never throws", async () => {
    const model = scriptedModel(["not json at all"]);

    const session = await plan(baseInput({ topic: "Quantum computing basics" }), model, new AbortController().signal);

    expect(session.subQuestions).toHaveLength(1);
    expect(session.subQuestions[0].text).toBe("Quantum computing basics");
    expect(session.subQuestions[0].id).toBe("SQ1");
  });

  it("falls back to a single topic-mirroring sub-question when subQuestions is missing/empty", async () => {
    const model = scriptedModel([JSON.stringify({ subQuestions: [], strategy: "x" })]);

    const session = await plan(baseInput({ topic: "Empty plan topic" }), model, new AbortController().signal);

    expect(session.subQuestions).toHaveLength(1);
    expect(session.subQuestions[0].text).toBe("Empty plan topic");
  });

  it("falls back to a single topic-mirroring sub-question when the model call rejects, never throws", async () => {
    const model = rejectingModel();

    const session = await plan(baseInput({ topic: "Resilience test topic" }), model, new AbortController().signal);

    expect(session.subQuestions).toHaveLength(1);
    expect(session.subQuestions[0].text).toBe("Resilience test topic");
  });

  it("accepts a sub-question count outside the 3-8 guideline rather than rejecting it", async () => {
    const model = scriptedModel([JSON.stringify({ subQuestions: ["only one"], strategy: "" })]);

    const session = await plan(baseInput(), model, new AbortController().signal);

    expect(session.subQuestions).toHaveLength(1);
    expect(session.subQuestions[0].text).toBe("only one");
  });
});
