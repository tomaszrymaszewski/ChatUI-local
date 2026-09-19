import type { StructuredInputRequest } from "@/lib/agent/types";

/**
 * Sentinel value for the trailing "Custom…" entry appended to every select
 * field. Never reaches the agent: submit resolves it to the user's free
 * text (see resolveFieldValue).
 */
export const CUSTOM_OPTION_VALUE = "__chatui_custom__";

export const CUSTOM_OPTION_LABEL = "Custom…";

/** Options the model may have provided that already mean "write it myself". */
const CUSTOM_EQUIVALENTS = /^(custom|other|something else|write (my )?own|none of (these|the above))[.…]*$/i;

/** True when the options already end in a custom/other escape hatch. */
export function hasCustomEquivalent(options?: string[]): boolean {
  return (options ?? []).some((o) => CUSTOM_EQUIVALENTS.test(o.trim()));
}

export interface SelectItem {
  value: string;
  label: string;
}

/**
 * Items for a select field: the model's 1-3 options plus a trailing Custom…
 * entry (unless the model already provided one). The agent is told not to
 * add its own — this is the UI-level guarantee it always exists.
 */
export function selectItems(options?: string[]): SelectItem[] {
  const items = (options ?? []).map((o) => ({ value: o, label: o }));
  if (!hasCustomEquivalent(options)) {
    items.push({ value: CUSTOM_OPTION_VALUE, label: CUSTOM_OPTION_LABEL });
  }
  return items;
}

/**
 * Resolve what a field submits: a select sitting on the Custom… sentinel
 * submits the free text ("" when untouched, so optional fields stay omitted
 * and required ones stay missing).
 */
export function resolveFieldValue(
  field: StructuredInputRequest["fields"][number],
  stored: string | number | boolean | undefined,
  customText: string,
): string | number | boolean | undefined {
  if (field.type === "select" && stored === CUSTOM_OPTION_VALUE) {
    return customText;
  }
  return stored;
}

/** Missing-required check on resolved values (mirrors the form's submit). */
export function isMissingRequired(
  field: StructuredInputRequest["fields"][number],
  resolved: string | number | boolean | undefined,
): boolean {
  return (
    !!field.required &&
    (resolved === undefined || resolved === "" || resolved === false)
  );
}
