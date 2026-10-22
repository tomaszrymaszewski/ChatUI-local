// Tolerant parser for ```chart fence specs (Vega-Lite JSON).
//
// Models frequently emit almost-JSON: trailing commas, // or /* */ comments.
// Strict JSON.parse rejects those and the chart fails; jsonc-parser (already a
// dependency) accepts them. Strict JSON is tried first so valid specs keep
// exact JSON semantics and error messages.

import {
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError,
} from "jsonc-parser";
import type { Spec as VegaSpec } from "vega";
import type { TopLevelSpec as VegaLiteSpec } from "vega-lite";

// Same union vega-embed's `embed()` accepts (its VisualizationSpec is not
// exported from the package index). Type-only imports — no bundle impact.
export type ChartSpec = VegaLiteSpec | VegaSpec;

/**
 * Charts render in a full-width message column; a fixed `width` (models almost
 * always set one) leaves a wide white gutter around the plot. Single-view
 * Vega-Lite specs are stretched with width:"container" so the chart fills the
 * block — vega re-evaluates it on window resize. Composed specs (concat/
 * facet/repeat) ignore top-level width and Vega specs size their own canvas,
 * so those keep the author's sizing.
 */
export function makeChartResponsive(spec: ChartSpec): ChartSpec {
  const record = spec as Record<string, unknown>;
  const schema = typeof record.$schema === "string" ? record.$schema : "";
  if (/vega\/v\d/.test(schema) && !schema.includes("vega-lite")) return spec;
  if (["concat", "hconcat", "vconcat", "facet", "repeat"].some((key) => key in record)) {
    return spec;
  }
  if (!("mark" in record || "layer" in record)) return spec;
  return { ...record, width: "container" } as ChartSpec;
}

export function parseChartSpec(spec: string): ChartSpec {
  const trimmed = spec.trim();
  try {
    return JSON.parse(trimmed) as ChartSpec;
  } catch (firstError) {
    const errors: ParseError[] = [];
    const parsed = parseJsonc(trimmed, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });
    if (errors.length === 0) return parsed as ChartSpec;
    // Surface the strict-JSON error when the input is broken JSON either way
    // (e.g. truncated mid-stream): it names the real problem ("Unterminated
    // string") instead of a JSONC quirk.
    throw firstError instanceof Error
      ? firstError
      : new SyntaxError(
          `Invalid chart spec: ${errors
            .map((e) => printParseErrorCode(e.error))
            .join(", ")}`,
        );
  }
}
