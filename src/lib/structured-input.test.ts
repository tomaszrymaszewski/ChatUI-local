import { describe, expect, it } from "vitest";
import {
  CUSTOM_OPTION_LABEL,
  CUSTOM_OPTION_VALUE,
  hasCustomEquivalent,
  isMissingRequired,
  resolveFieldValue,
  selectItems,
} from "@/lib/structured-input";
import type { StructuredInputRequest } from "@/lib/agent/types";

const selectField = (
  overrides: Partial<StructuredInputRequest["fields"][number]> = {},
): StructuredInputRequest["fields"][number] => ({
  name: "choice",
  label: "Pick one",
  type: "select",
  ...overrides,
});

describe("select custom option", () => {
  it("appends a trailing Custom entry to the model's options", () => {
    const items = selectItems(["Email", "Calendar"]);
    expect(items.map((i) => i.label)).toEqual(["Email", "Calendar", CUSTOM_OPTION_LABEL]);
    expect(items[2].value).toBe(CUSTOM_OPTION_VALUE);
  });

  it("never duplicates the model's own custom/other option", () => {
    for (const existing of ["Custom", "custom…", "Other", "Something else", "None of these"]) {
      const items = selectItems(["Email", existing]);
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.value)).not.toContain(CUSTOM_OPTION_VALUE);
    }
  });

  it("still appends Custom when no options were given", () => {
    expect(selectItems([]).map((i) => i.label)).toEqual([CUSTOM_OPTION_LABEL]);
    expect(selectItems(undefined).map((i) => i.label)).toEqual([CUSTOM_OPTION_LABEL]);
  });

  it("resolves the sentinel to the user's free text", () => {
    const field = selectField();
    expect(resolveFieldValue(field, CUSTOM_OPTION_VALUE, "smoke signals")).toBe("smoke signals");
    expect(resolveFieldValue(field, CUSTOM_OPTION_VALUE, "")).toBe("");
    expect(resolveFieldValue(field, "Email", "ignored")).toBe("Email");
  });

  it("keeps required validation working through the custom box", () => {
    const required = selectField({ required: true });
    expect(isMissingRequired(required, resolveFieldValue(required, CUSTOM_OPTION_VALUE, ""))).toBe(true);
    expect(isMissingRequired(required, resolveFieldValue(required, CUSTOM_OPTION_VALUE, "x"))).toBe(false);
    expect(isMissingRequired(required, "Email")).toBe(false);
    expect(isMissingRequired(required, "")).toBe(true);
    expect(isMissingRequired(selectField(), "")).toBe(false);
  });

  it("leaves non-select fields untouched", () => {
    const text = selectField({ name: "q", type: "text" });
    expect(resolveFieldValue(text, CUSTOM_OPTION_VALUE, "x")).toBe(CUSTOM_OPTION_VALUE);
    expect(hasCustomEquivalent(undefined)).toBe(false);
  });
});
