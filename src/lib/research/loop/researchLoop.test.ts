import { describe, it, expect } from "vitest";
import {
  extractFirstJsonObject,
  parseAndValidateAction,
  describeActionError,
  toSourceId,
  toSubQuestionId,
  type ValidationContext,
} from "./actions";
import { evaluateExpression } from "./calculate";

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
