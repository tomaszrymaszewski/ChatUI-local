import { describe, it, expect } from "vitest";
import { synthesize } from "./synthesize";
import { createInitialSession, type ModelPort, type ModelTurnRequest, type ResearchSession } from "../loop/researchLoop";
import { toFindingId } from "../loop/researchLoop";
import { toSourceId, toSubQuestionId } from "../loop/actions";

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

function stateWithFindings(): ResearchSession {
  const base = createInitialSession("Test goal", [{ id: toSubQuestionId("SQ1"), text: "q1", status: "done" }]);
  return {
    ...base,
    sources: [{ id: toSourceId("S1"), url: "https://example.com", title: "Example", date: null, body: "body", fetchedAt: 0 }],
    findings: [{ id: toFindingId("F1"), text: "a real finding", sourceIds: [toSourceId("S1")], tags: [], targetsSubQ: null, createdAtStep: 1, createdAt: 0 }],
  };
}

describe("synthesize", () => {
  it("returns the model's response verbatim on success", async () => {
    const model = scriptedModel(["# Report\n\nSome markdown."]);
    const state = stateWithFindings();

    const report = await synthesize(state, { model, signal: new AbortController().signal, partial: false });

    expect(report).toBe("# Report\n\nSome markdown.");
  });

  it("returns a deterministic fallback report (never throws) when the model call rejects", async () => {
    const model = rejectingModel();
    const state = stateWithFindings();

    const report = await synthesize(state, { model, signal: new AbortController().signal, partial: false });

    expect(report).toContain("fallback");
    expect(report).toContain("a real finding");
    expect(report).toContain("S1");
    expect(report).toContain("Example");
  });

  it("includes partial-specific instruction wording in the request when partial is true", async () => {
    const model = scriptedModel(["report"]);
    const state = stateWithFindings();

    await synthesize(state, { model, signal: new AbortController().signal, partial: true });

    expect(model.calls[0].systemPrompt).toContain("INCOMPLETE");
  });

  it("omits partial-specific wording when partial is false", async () => {
    const model = scriptedModel(["report"]);
    const state = stateWithFindings();

    await synthesize(state, { model, signal: new AbortController().signal, partial: false });

    expect(model.calls[0].systemPrompt).not.toContain("INCOMPLETE");
  });

  it("renders every default template section heading into the system prompt", async () => {
    const model = scriptedModel(["report"]);
    const state = stateWithFindings();

    await synthesize(state, { model, signal: new AbortController().signal, partial: false });

    const prompt = model.calls[0].systemPrompt;
    expect(prompt).toContain("In brief");
    expect(prompt).toContain("Key findings");
    expect(prompt).toContain("Analysis");
    expect(prompt).toContain("Contradictions & uncertainty");
    expect(prompt).toContain("Sources");
  });

  it("feeds findings with their source ids into the user prompt", async () => {
    const model = scriptedModel(["report"]);
    const state = stateWithFindings();

    await synthesize(state, { model, signal: new AbortController().signal, partial: false });

    expect(model.calls[0].userPrompt).toContain("a real finding");
    expect(model.calls[0].userPrompt).toContain("S1");
  });

  it("the fallback report reflects partial status honestly", async () => {
    const model = rejectingModel();
    const state = stateWithFindings();

    const report = await synthesize(state, { model, signal: new AbortController().signal, partial: true });

    expect(report).toContain("partial");
  });
});
