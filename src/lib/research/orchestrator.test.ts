import { describe, it, expect } from "vitest";
import { runDeepResearch, type RunDeepResearchInput } from "./orchestrator";
import { DEFAULT_LOOP_CONFIG, type ModelPort, type ModelTurnRequest, type ToolPort } from "./loop/researchLoop";

function scriptedModel(responses: readonly string[]): ModelPort & { calls: ModelTurnRequest[] } {
  const calls: ModelTurnRequest[] = [];
  let index = 0;
  return {
    calls,
    async complete(request, signal) {
      calls.push(request);
      if (signal.aborted) throw new Error("cancelled");
      const response = responses[Math.min(index, responses.length - 1)];
      index++;
      return response;
    },
  };
}

function neverCalledTool(): ToolPort {
  const fail = () => {
    throw new Error("tool should not have been called in this test");
  };
  return { webSearch: fail, openUrl: fail, readPdf: fail, searchInPage: fail };
}

function jsonAction(overrides: { action: string; args: Record<string, unknown>; confidence?: number }): string {
  return JSON.stringify({
    thought: "thinking",
    action: overrides.action,
    args: overrides.args,
    targets_subq: null,
    confidence: overrides.confidence ?? 0.4,
  });
}

function baseInput(overrides: Partial<RunDeepResearchInput> = {}): RunDeepResearchInput {
  return {
    topic: "How does photosynthesis work?",
    providedUrls: [],
    capabilities: { webSearch: false },
    model: scriptedModel([]),
    tool: neverCalledTool(),
    config: DEFAULT_LOOP_CONFIG,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("runDeepResearch", () => {
  it("runs PLAN -> loop -> SYNTHESIZE end to end and returns a populated result", async () => {
    const planResponse = JSON.stringify({ subQuestions: ["What is chlorophyll?"], strategy: "Use general knowledge." });
    const writeAnswer = jsonAction({ action: "write_answer", args: { summary: "final answer" }, confidence: 0.9 });
    const reportMarkdown = "# Report\n\nFinal answer content [S1].";
    const model = scriptedModel([planResponse, writeAnswer, reportMarkdown]);

    const result = await runDeepResearch(baseInput({ model }));

    expect(result.subQuestions).toHaveLength(1);
    expect(result.subQuestions[0].text).toBe("What is chlorophyll?");
    expect(result.termination.reason).toBe("write_answer_confirmed");
    expect(result.termination.partial).toBe(false);
    expect(result.report).toBe(reportMarkdown);
    expect(result.finalState.finalAnswerDraft).toBe("final answer");
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("cascades cleanly to an honest partial report when the signal is already aborted, never throws", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = scriptedModel(["unused", "unused", "unused"]);

    const result = await runDeepResearch(baseInput({ model, signal: controller.signal }));

    expect(result.termination.reason).toBe("cancelled");
    expect(result.termination.partial).toBe(true);
    expect(result.report.length).toBeGreaterThan(0);
    expect(result.report).toContain("fallback");
  });

  it("threads the config's stepBudget through to the loop", async () => {
    const planResponse = JSON.stringify({ subQuestions: ["q1", "q2", "q3"], strategy: "" });
    const model = scriptedModel([
      planResponse,
      jsonAction({ action: "calculate", args: { expression: "1+1" } }),
      jsonAction({ action: "calculate", args: { expression: "2+2" } }),
      "fallback report text",
    ]);

    const result = await runDeepResearch(
      baseInput({ model, config: { ...DEFAULT_LOOP_CONFIG, stepBudget: 2, kDiminishing: 100, reflectEvery: 100, maxRounds: 100 } }),
    );

    expect(result.termination.reason).toBe("step_budget_reached");
    expect(result.finalState.step).toBe(2);
  });

  it("invokes onPhase at plan, research, and synthesize, in order", async () => {
    const planResponse = JSON.stringify({ subQuestions: ["What is chlorophyll?"], strategy: "Use general knowledge." });
    const writeAnswer = jsonAction({ action: "write_answer", args: { summary: "final answer" }, confidence: 0.9 });
    const reportMarkdown = "# Report\n\nFinal answer content [S1].";
    const model = scriptedModel([planResponse, writeAnswer, reportMarkdown]);
    const phases: string[] = [];

    await runDeepResearch(baseInput({ model, onPhase: (phase) => phases.push(phase) }));

    expect(phases).toEqual(["plan", "research", "synthesize"]);
  });
});
