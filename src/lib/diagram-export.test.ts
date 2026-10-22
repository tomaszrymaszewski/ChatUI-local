import { describe, expect, it } from "vitest";
import { svgDimensions } from "@/lib/diagram-export";

describe("svgDimensions", () => {
  it("reads numeric width/height attributes (vega output)", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="744" height="264" viewBox="0 0 744 264">`;
    expect(svgDimensions(svg)).toEqual({ width: 744, height: 264 });
  });

  it("falls back to the viewBox when width is a percentage (mermaid output)", () => {
    const svg = `<svg id="mermaid-1" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 411.6171875px;" viewBox="0 0 411.6171875 162">`;
    expect(svgDimensions(svg)).toEqual({ width: 411.6171875, height: 162 });
  });

  it("fills a missing dimension from the viewBox", () => {
    const svg = `<svg width="320" viewBox="0 0 320 240">`;
    expect(svgDimensions(svg)).toEqual({ width: 320, height: 240 });
  });

  it("uses fallback dimensions when nothing is declared", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">`;
    expect(svgDimensions(svg)).toEqual({ width: 800, height: 600 });
  });

  it("ignores zero and negative attributes", () => {
    const svg = `<svg width="0" height="-5" viewBox="0 0 100 50">`;
    expect(svgDimensions(svg)).toEqual({ width: 100, height: 50 });
  });

  it("returns the fallback when the markup has no svg tag at all", () => {
    expect(svgDimensions("not a diagram")).toEqual({ width: 800, height: 600 });
  });
});
