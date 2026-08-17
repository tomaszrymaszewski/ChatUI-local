import { describe, it, expect, vi } from "vitest";
import {
  extractFirstJsonObject,
  parseAndValidateAction,
  describeActionError,
  toSourceId,
  toSubQuestionId,
  type ValidationContext,
  type ModelAction,
} from "./actions";
import { evaluateExpression } from "./calculate";
import {
  runIteration,
  createInitialSession,
  checkTermination,
  checkReflectionTrigger,
  foldState,
  DEFAULT_LOOP_CONFIG,
  type LoopConfig,
  type ModelPort,
  type ModelTurnRequest,
  type ToolPort,
  type IterationDeps,
  type ResearchSession,
  type SubQuestion,
  type WebSearchHit,
  type FetchedPage,
} from "./researchLoop";

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    existingSourceIds: new Set(),
    existingSubQuestionIds: new Set(),
    ...overrides,
  };
}

describe("actions: extractFirstJsonObject", () => {
  it("extracts a bare JSON object with no fence", () => {
    const result = extractFirstJsonObject('{"a": 1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('{"a": 1}');
  });

  it("strips a ```json fenced block", () => {
    const result = extractFirstJsonObject('```json\n{"a": 1}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toEqual({ a: 1 });
  });

  it("strips a bare ``` fenced block with no language tag", () => {
    const result = extractFirstJsonObject('```\n{"a": 1}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toEqual({ a: 1 });
  });

  it("ignores braces inside string literals when scanning depth", () => {
    const result = extractFirstJsonObject('{"a": "} not the end {"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toEqual({ a: "} not the end {" });
  });

  it("ignores escaped quotes inside strings", () => {
    const result = extractFirstJsonObject('{"a": "she said \\"hi\\""}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toEqual({ a: 'she said "hi"' });
  });

  it("handles nested objects", () => {
    const result = extractFirstJsonObject('{"a": {"b": {"c": 1}}}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toEqual({ a: { b: { c: 1 } } });
  });

  it("takes only the first balanced object when extra text follows", () => {
    const result = extractFirstJsonObject('{"a": 1} some trailing chatter {"b": 2}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.value)).toEqual({ a: 1 });
  });

  it("fails on unbalanced braces", () => {
    const result = extractFirstJsonObject('{"a": {"b": 1}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_json");
  });

  it("fails on input with no braces at all", () => {
    const result = extractFirstJsonObject("no json here");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_json");
  });

  it("fails on empty input", () => {
    const result = extractFirstJsonObject("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_json");
  });
});

describe("actions: parseAndValidateAction", () => {
  it("parses a valid web_search action", () => {
    const raw = JSON.stringify({
      thought: "need to find X",
      action: "web_search",
      args: { query: "example query" },
      targets_subq: null,
      confidence: 0.4,
    });
    const result = parseAndValidateAction(raw, ctx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("web_search");
      expect(result.value.targetsSubQ).toBeNull();
      if (result.value.action === "web_search") {
        expect(result.value.args.query).toBe("example query");
      }
    }
  });

  it("parses a valid write_answer action with a targets_subq", () => {
    const raw = JSON.stringify({
      thought: "done",
      action: "write_answer",
      args: { summary: "final answer" },
      targets_subq: "SQ1",
      confidence: 0.9,
    });
    const result = parseAndValidateAction(raw, ctx({ existingSubQuestionIds: new Set([toSubQuestionId("SQ1")]) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetsSubQ).toBe("SQ1");
  });

  it("maps save_note's optional subq_status wire field to subqStatus", () => {
    const raw = JSON.stringify({
      thought: "note",
      action: "save_note",
      args: { text: "finding", source_ids: ["S1"], tags: [], subq_status: "done" },
      targets_subq: "SQ1",
      confidence: 0.7,
    });
    const result = parseAndValidateAction(
      raw,
      ctx({
        existingSourceIds: new Set([toSourceId("S1")]),
        existingSubQuestionIds: new Set([toSubQuestionId("SQ1")]),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.value.action === "save_note") {
      expect(result.value.args.subqStatus).toBe("done");
    }
  });

  it("parses compare_sources with a required conflict flag", () => {
    const raw = JSON.stringify({
      thought: "comparing",
      action: "compare_sources",
      args: { subject: "revenue", source_ids: ["S1", "S2"], summary: "differs", conflict: true },
      targets_subq: null,
      confidence: 0.5,
    });
    const result = parseAndValidateAction(
      raw,
      ctx({ existingSourceIds: new Set([toSourceId("S1"), toSourceId("S2")]) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.value.action === "compare_sources") {
      expect(result.value.args.conflict).toBe(true);
    }
  });

  it("rejects invalid JSON", () => {
    const result = parseAndValidateAction("not json at all", ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_json");
  });

  it("rejects an unknown action name", () => {
    const raw = JSON.stringify({
      thought: "x",
      action: "delete_everything",
      args: {},
      targets_subq: null,
      confidence: 0.5,
    });
    const result = parseAndValidateAction(raw, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("schema_invalid");
  });

  it("rejects a missing required arg", () => {
    const raw = JSON.stringify({
      thought: "x",
      action: "web_search",
      args: {},
      targets_subq: null,
      confidence: 0.5,
    });
    const result = parseAndValidateAction(raw, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("schema_invalid");
  });

  it("rejects confidence outside [0,1]", () => {
    const raw = JSON.stringify({
      thought: "x",
      action: "reflect",
      args: {},
      targets_subq: null,
      confidence: 1.5,
    });
    const result = parseAndValidateAction(raw, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("schema_invalid");
  });

  it("rejects an unknown top-level targets_subq", () => {
    const raw = JSON.stringify({
      thought: "x",
      action: "reflect",
      args: {},
      targets_subq: "SQ99",
      confidence: 0.3,
    });
    const result = parseAndValidateAction(raw, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unknown_subq");
  });

  it("rejects an unknown source_id referenced in save_note.source_ids", () => {
    const raw = JSON.stringify({
      thought: "x",
      action: "save_note",
      args: { text: "t", source_ids: ["S99"], tags: [] },
      targets_subq: null,
      confidence: 0.3,
    });
    const result = parseAndValidateAction(raw, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unknown_source");
  });

  it("rejects an unknown source_id referenced in search_in_page.source_id", () => {
    const raw = JSON.stringify({
      thought: "x",
      action: "search_in_page",
      args: { source_id: "S99", query: "q" },
      targets_subq: null,
      confidence: 0.3,
    });
    const result = parseAndValidateAction(raw, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unknown_source");
  });
});

describe("actions: describeActionError", () => {
  it("always ends with the corrective re-ask instruction", () => {
    const cases: Array<Parameters<typeof describeActionError>[0]> = [
      { kind: "invalid_json", message: "bad" },
      { kind: "schema_invalid", message: "bad shape" },
      { kind: "unknown_source", sourceId: "S99" },
      { kind: "unknown_subq", subQuestionId: "SQ99" },
    ];
    for (const error of cases) {
      expect(describeActionError(error)).toContain("Reply again with ONLY a valid JSON action.");
    }
  });

  it("mentions the offending id for unknown_source/unknown_subq", () => {
    expect(describeActionError({ kind: "unknown_source", sourceId: "S99" })).toContain("S99");
    expect(describeActionError({ kind: "unknown_subq", subQuestionId: "SQ99" })).toContain("SQ99");
  });
});

describe("calculate: evaluateExpression", () => {
  it("evaluates basic addition and subtraction", () => {
    const result = evaluateExpression("2 + 3 - 1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(4);
  });

  it("respects multiplication/division precedence over addition", () => {
    const result = evaluateExpression("2 + 3 * 4");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(14);
  });

  it("respects parentheses", () => {
    const result = evaluateExpression("(2 + 3) * 4");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(20);
  });

  it("supports right-associative exponentiation", () => {
    const result = evaluateExpression("2 ^ 3 ^ 2"); // 2^(3^2) = 2^9 = 512
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(512);
  });

  it("supports unary minus", () => {
    const result = evaluateExpression("-5 + 3");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(-2);
  });

  it("supports modulo", () => {
    const result = evaluateExpression("10 % 3");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
  });

  it("rejects division by zero", () => {
    const result = evaluateExpression("1 / 0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("division_by_zero");
  });

  it("rejects modulo by zero", () => {
    const result = evaluateExpression("1 % 0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("division_by_zero");
  });

  it("rejects malformed expressions", () => {
    const result = evaluateExpression("2 + * 3");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("parse_error");
  });

  it("rejects unbalanced parentheses", () => {
    const result = evaluateExpression("(2 + 3");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("parse_error");
  });

  it("rejects trailing garbage after a valid expression", () => {
    const result = evaluateExpression("2 + 3 foo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("parse_error");
  });

  it("rejects empty input", () => {
    const result = evaluateExpression("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("parse_error");
  });

  it("rejects unknown characters (no identifiers, no ambient scope)", () => {
    const result = evaluateExpression("globalThis");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("parse_error");
  });

  it("rejects pathologically long input", () => {
    const result = evaluateExpression("1" + "+1".repeat(500));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("parse_error");
  });

  it("handles decimal numbers", () => {
    const result = evaluateExpression("1.5 + 2.5");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// researchLoop: test doubles
// ---------------------------------------------------------------------------

interface ScriptedModel extends ModelPort {
  readonly calls: ModelTurnRequest[];
}

function scriptedModel(responses: readonly string[]): ScriptedModel {
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

function jsonAction(
  overrides: {
    thought?: string;
    action?: string;
    args?: Record<string, unknown>;
    targets_subq?: string | null;
    confidence?: number;
  } = {},
): string {
  return JSON.stringify({
    thought: overrides.thought ?? "thinking",
    action: overrides.action ?? "calculate",
    args: overrides.args ?? { expression: "1+1" },
    targets_subq: overrides.targets_subq ?? null,
    confidence: overrides.confidence ?? 0.5,
  });
}

interface StubToolCalls {
  web_search: string[];
  open_url: string[];
  read_pdf: string[];
  search_in_page: Array<{ sourceId: string; query: string }>;
}

function stubTool(overrides: Partial<ToolPort> = {}): ToolPort & { calls: StubToolCalls } {
  const calls: StubToolCalls = { web_search: [], open_url: [], read_pdf: [], search_in_page: [] };
  return {
    calls,
    async webSearch(query, signal) {
      calls.web_search.push(query);
      if (overrides.webSearch) return overrides.webSearch(query, signal);
      const hits: WebSearchHit[] = [{ url: "https://example.com", title: "Example", snippet: "an example" }];
      return hits;
    },
    async openUrl(url, signal) {
      calls.open_url.push(url);
      if (overrides.openUrl) return overrides.openUrl(url, signal);
      const page: FetchedPage = { title: "Example page", date: null, body: "body text" };
      return page;
    },
    async readPdf(url, signal) {
      calls.read_pdf.push(url);
      if (overrides.readPdf) return overrides.readPdf(url, signal);
      const page: FetchedPage = { title: "PDF", date: null, body: "pdf body" };
      return page;
    },
    async searchInPage(sourceId, query, signal) {
      calls.search_in_page.push({ sourceId, query });
      if (overrides.searchInPage) return overrides.searchInPage(sourceId, query, signal);
      return ["match"];
    },
  };
}

function fixedClock(ms: number) {
  return () => ms;
}

function makeDeps(overrides: Partial<IterationDeps> = {}): IterationDeps {
  return {
    model: scriptedModel([jsonAction()]),
    tool: stubTool(),
    clock: fixedClock(0),
    signal: new AbortController().signal,
    config: DEFAULT_LOOP_CONFIG,
    ...overrides,
  };
}

function calcAction(overrides: Partial<ModelAction> = {}): ModelAction {
  return {
    thought: "calculating",
    action: "calculate",
    args: { expression: "1+1" },
    targetsSubQ: null,
    confidence: 0.3,
    ...overrides,
  } as ModelAction;
}

// ---------------------------------------------------------------------------
// researchLoop: §10 test matrix
// ---------------------------------------------------------------------------

describe("researchLoop: §10 test matrix", () => {
  it("1. dispatches the correct tool for a valid action and folds state (step++)", async () => {
    const model = scriptedModel([jsonAction({ action: "web_search", args: { query: "ngo competitors" } })]);
    const tool = stubTool();
    const deps = makeDeps({ model, tool });
    const state = createInitialSession("goal", []);

    const result = await runIteration(state, deps);

    expect(tool.calls.web_search.length).toBe(1);
    expect(result.state.step).toBe(1);
    expect(result.events.some((e) => e.type === "step_start" && e.action === "web_search")).toBe(true);
  });

  it("2. recovers from invalid JSON via the retry ladder", async () => {
    const model = scriptedModel(["not json", jsonAction({ action: "calculate", args: { expression: "1+1" } })]);
    const deps = makeDeps({ model });
    const state = createInitialSession("goal", []);

    const result = await runIteration(state, deps);

    expect(model.calls.length).toBe(2);
    expect(model.calls[1].userPrompt).toContain("Reply again with ONLY a valid JSON action.");
    expect(result.state.step).toBe(1);
  });

  it("3. fails forward to reflect (never throws) when retries are exhausted", async () => {
    const model = scriptedModel(["garbage", "still garbage", "more garbage"]);
    const deps = makeDeps({ model });
    const state = createInitialSession("goal", []);

    const result = await runIteration(state, deps);

    expect(model.calls.length).toBe(3);
    expect(result.state.lastObservation?.kind).toBe("reflection_ack");
  });

  it("4. rejects an action referencing an unknown source id and re-asks", async () => {
    const model = scriptedModel([
      jsonAction({ action: "save_note", args: { text: "t", source_ids: ["S99"], tags: [] } }),
      jsonAction({ action: "calculate", args: { expression: "1+1" } }),
    ]);
    const deps = makeDeps({ model });
    const state = createInitialSession("goal", []);

    await runIteration(state, deps);

    expect(model.calls.length).toBe(2);
    expect(model.calls[1].userPrompt).toContain("S99");
  });

  it("5. returns cached results on a web_search dedup hit without calling the tool", async () => {
    const cachedHits: WebSearchHit[] = [{ url: "https://cached.example", title: "Cached", snippet: "..." }];
    const model = scriptedModel([jsonAction({ action: "web_search", args: { query: "Example Query" } })]);
    const tool = stubTool();
    const deps = makeDeps({ model, tool });
    const state: ResearchSession = {
      ...createInitialSession("goal", []),
      searchCache: { "example query": { hits: cachedHits, firstSeenStep: 0 } },
    };

    await runIteration(state, deps);

    expect(tool.calls.web_search.length).toBe(0);
  });

  it("6. returns the cached source on an open_url dedup hit without re-fetching", async () => {
    const model = scriptedModel([jsonAction({ action: "open_url", args: { url: "https://example.com/page" } })]);
    const tool = stubTool();
    const deps = makeDeps({ model, tool });
    const existingSource = {
      id: toSourceId("S1"),
      url: "https://example.com/page",
      title: "Existing",
      date: null,
      body: "already fetched",
      fetchedAt: 0,
    };
    const state: ResearchSession = {
      ...createInitialSession("goal", []),
      sources: [existingSource],
      urlCache: { "https://example.com/page": existingSource.id },
    };

    const result = await runIteration(state, deps);

    expect(tool.calls.open_url.length).toBe(0);
    expect(result.state.sources.length).toBe(1);
  });

  it("7. diminishing returns: reflects once, then terminates if still no progress", () => {
    const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, kDiminishing: 3, reflectEvery: 100, maxRounds: 100, stepBudget: 100 };
    const action = calcAction({ args: { expression: "1/0" } });
    const toolOutput = { kind: "calculation_error" as const, expression: "1/0", error: { kind: "division_by_zero" as const } };

    let state = createInitialSession("goal", []);
    state = foldState(state, action, toolOutput, fixedClock(0)); // step 1
    state = foldState(state, action, toolOutput, fixedClock(0)); // step 2
    state = foldState(state, action, toolOutput, fixedClock(0)); // step 3

    expect(checkReflectionTrigger(state, action, config)).toEqual({ forced: true, reason: "diminishing_returns" });
    expect(checkTermination(state, action, config, false)).toBeNull();

    // apply the reflection adjustment the way runIteration would before the next fold
    state = { ...state, diminishingReturnsReflectionUsed: true };
    state = foldState(state, action, toolOutput, fixedClock(0)); // step 4, still no progress

    expect(checkTermination(state, action, config, false)).toEqual({ reason: "diminishing_returns", partial: true });
  });

  it("8. STEP_BUDGET reached forces a partial finalize", async () => {
    const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, stepBudget: 2, kDiminishing: 100, reflectEvery: 100, maxRounds: 100 };
    const model = scriptedModel([
      jsonAction({ action: "calculate", args: { expression: "1+1" } }),
      jsonAction({ action: "calculate", args: { expression: "2+2" } }),
    ]);
    const deps = makeDeps({ model, config });

    let state = createInitialSession("goal", []);
    const first = await runIteration(state, deps);
    expect(first.termination).toBeNull();
    state = first.state;

    const second = await runIteration(state, deps);
    expect(second.termination).toEqual({ reason: "step_budget_reached", partial: true });
    expect(second.state.step).toBe(2);
  });

  it("9. premature finalize guard forces a reflect instead of finishing on overconfident write_answer", async () => {
    const subQuestions: SubQuestion[] = [
      { id: toSubQuestionId("SQ1"), text: "a", status: "open" },
      { id: toSubQuestionId("SQ2"), text: "b", status: "open" },
      { id: toSubQuestionId("SQ3"), text: "c", status: "open" },
    ];
    const guardedAction = calcAction({ action: "write_answer", args: { summary: "done" }, confidence: 0.9 } as Partial<ModelAction>);
    const state = createInitialSession("goal", subQuestions);

    expect(checkReflectionTrigger(state, guardedAction, DEFAULT_LOOP_CONFIG)).toEqual({ forced: true, reason: "premature_finalize_guard" });
    expect(checkTermination(state, guardedAction, DEFAULT_LOOP_CONFIG, false)).toBeNull();

    const model = scriptedModel([
      jsonAction({ action: "write_answer", args: { summary: "done" }, confidence: 0.9 }),
      jsonAction({ action: "calculate", args: { expression: "1+1" } }),
    ]);
    const deps = makeDeps({ model });

    const first = await runIteration(state, deps);
    expect(first.termination).toBeNull();

    await runIteration(first.state, deps);
    expect(model.calls.length).toBe(2); // the loop continued to the second scripted turn
  });

  it("10. aborts to a partial cancellation when the signal fires mid-tool-call", async () => {
    const controller = new AbortController();
    const captured: { signal: AbortSignal | null } = { signal: null };
    const tool = stubTool({
      openUrl: (_url, signal) => {
        captured.signal = signal;
        controller.abort();
        return new Promise((_resolve, reject) => reject(new Error("aborted mid-flight")));
      },
    });
    const model = scriptedModel([jsonAction({ action: "open_url", args: { url: "https://example.com" } })]);
    const deps = makeDeps({ model, tool, signal: controller.signal });
    const state = createInitialSession("goal", []);

    const result = await runIteration(state, deps);

    expect(result.termination).toEqual({ reason: "cancelled", partial: true });
    expect(captured.signal?.aborted).toBe(true);
  });

  it("11. converts a tool timeout into an OBSERVATION and keeps the loop going (no throw)", async () => {
    vi.useFakeTimers();
    try {
      const tool = stubTool({
        webSearch: (_query, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("timed out")));
          }),
      });
      const model = scriptedModel([jsonAction({ action: "web_search", args: { query: "slow query" } })]);
      const deps = makeDeps({ model, tool });
      const state = createInitialSession("goal", []);

      const resultPromise = runIteration(state, deps);
      await vi.advanceTimersByTimeAsync(DEFAULT_LOOP_CONFIG.toolTimeoutMs + 10);
      await vi.advanceTimersByTimeAsync(DEFAULT_LOOP_CONFIG.toolTimeoutMs + 10);
      const result = await resultPromise;

      expect(result.state.lastObservation?.kind).toBe("tool_error");
      expect(result.state.step).toBe(1);
      expect(result.termination).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("12. reflection at REFLECT_EVERY emits a round_boundary event and advances the round counter", async () => {
    const config: LoopConfig = { ...DEFAULT_LOOP_CONFIG, reflectEvery: 2, kDiminishing: 100, stepBudget: 100, maxRounds: 100 };
    const model = scriptedModel([
      jsonAction({ action: "calculate", args: { expression: "1+1" } }),
      jsonAction({ action: "calculate", args: { expression: "2+2" } }),
      jsonAction({ action: "calculate", args: { expression: "3+3" } }),
      jsonAction({ action: "calculate", args: { expression: "4+4" } }),
    ]);
    const deps = makeDeps({ model, config });

    let state = createInitialSession("goal", []);
    const r1 = await runIteration(state, deps);
    state = r1.state;
    expect(state.round).toBe(0);

    const r2 = await runIteration(state, deps);
    state = r2.state;
    expect(state.round).toBe(1);
    expect(r2.events.some((e) => e.type === "round_boundary" && e.round === 1)).toBe(true);

    const r3 = await runIteration(state, deps);
    state = r3.state;
    const r4 = await runIteration(state, deps);
    state = r4.state;
    expect(state.round).toBe(2);
  });
});
