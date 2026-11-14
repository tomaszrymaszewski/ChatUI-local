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

/**
 * Text and axis colors for a dark chat background. Vega-Lite's defaults are
 * black and would vanish on it.
 */
const DARK_CHART_CONFIG: Record<string, Record<string, string>> = {
  axis: {
    labelColor: "#a3a3a3",
    titleColor: "#e5e5e5",
    domainColor: "#525252",
    tickColor: "#525252",
    gridColor: "#333333",
  },
  legend: { labelColor: "#a3a3a3", titleColor: "#e5e5e5" },
  header: { labelColor: "#a3a3a3", titleColor: "#e5e5e5" },
  title: { color: "#fafafa", subtitleColor: "#a3a3a3" },
  text: { color: "#fafafa" },
  rule: { color: "#737373" },
};

/**
 * Themes a chart for the chat background. The canvas is always transparent
 * (Vega-Lite paints white by default). In dark mode the default text and axis
 * colors get light replacements. Colors the spec sets itself win.
 */
export function themeChartSpec(spec: ChartSpec, dark: boolean): ChartSpec {
  const record = spec as Record<string, unknown>;
  const themed: Record<string, unknown> = { ...record, background: "transparent" };
  if (!dark) return themed as ChartSpec;
  const author = (record.config ?? {}) as Record<string, unknown>;
  const config: Record<string, unknown> = { ...author };
  for (const [section, defaults] of Object.entries(DARK_CHART_CONFIG)) {
    const own = author[section];
    config[section] = {
      ...defaults,
      ...(own !== null && typeof own === "object" ? (own as object) : {}),
    };
  }
  themed.config = config;
  return themed as ChartSpec;
}
