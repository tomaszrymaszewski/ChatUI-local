import { describe, expect, it } from "vitest";
import { parseChartSpec } from "@/lib/chart-spec";

const VALID_SPEC = `{
  "mark": "line",
  "data": {"values": [
    {"term": 0.25, "yield": 4.14, "market": "US Treasury"},
    {"term": 30, "yield": 5.34, "market": "US Treasury"}
  ]},
  "encoding": {
    "x": {"field": "term", "type": "quantitative", "scale": {"type": "log"}},
    "y": {"field": "yield", "type": "quantitative"}
  },
  "width": 560, "height": 320
}`;

describe("parseChartSpec", () => {
  it("parses the reported yield-curve spec", () => {
    const parsed = parseChartSpec(VALID_SPEC) as {
      mark: string;
      encoding: { x: { scale: { type: string } } };
    };
    expect(parsed.mark).toBe("line");
    expect(parsed.encoding.x.scale.type).toBe("log");
  });

  it("tolerates trailing commas from model output", () => {
    const parsed = parseChartSpec(
      `{"mark": "bar", "data": {"values": [{"a": 1},]},}`,
    ) as { mark: string };
    expect(parsed.mark).toBe("bar");
  });

  it("tolerates comments from model output", () => {
    const parsed = parseChartSpec(
      `{
        // yield curve
        "mark": "line", /* trailing note */
      }`,
    ) as { mark: string };
    expect(parsed.mark).toBe("line");
  });

  it("throws a JSON SyntaxError for truncated mid-stream input", () => {
    // A partial fence ("Unterminated string") must still throw so the UI can
    // show "rendering…" and retry when more content arrives — never silently
    // render half a spec.
    expect(() => parseChartSpec(`{"mark": "li`)).toThrow(SyntaxError);
  });
});
