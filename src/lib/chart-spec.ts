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
