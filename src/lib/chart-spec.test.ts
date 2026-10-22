import { describe, expect, it } from "vitest";
import { makeChartResponsive, parseChartSpec } from "@/lib/chart-spec";

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

describe("makeChartResponsive", () => {
  it("stretches a fixed-width single-view spec to the container", () => {
    const parsed = parseChartSpec(VALID_SPEC);
    expect(makeChartResponsive(parsed)).toMatchObject({ width: "container" });
  });

  it("stretches layered specs too", () => {
    const layered = parseChartSpec(`{"layer": [{"mark": "line"}], "width": 300}`);
    expect(makeChartResponsive(layered)).toMatchObject({ width: "container" });
  });

  it("leaves composed specs untouched (top-level width is ignored there)", () => {
    for (const key of ["concat", "hconcat", "vconcat", "facet", "repeat"]) {
      const composed = parseChartSpec(`{"${key}": [], "width": 300}`);
      expect(makeChartResponsive(composed)).toMatchObject({ width: 300 });
    }
  });

  it("leaves Vega (non-Lite) specs untouched", () => {
    const vega = parseChartSpec(
      `{"$schema": "https://vega.github.io/schema/vega/v5.json", "marks": [], "width": 400}`,
    );
    expect(makeChartResponsive(vega)).toMatchObject({ width: 400 });
  });

  it("keeps specs without a mark/layer untouched", () => {
    const other = parseChartSpec(`{"data": {"values": []}, "width": 250}`);
    expect(makeChartResponsive(other)).toMatchObject({ width: 250 });
  });

  it("is idempotent for already-responsive specs", () => {
    const responsive = parseChartSpec(`{"mark": "bar", "width": "container"}`);
    expect(makeChartResponsive(responsive)).toMatchObject({ width: "container" });
  });
});
