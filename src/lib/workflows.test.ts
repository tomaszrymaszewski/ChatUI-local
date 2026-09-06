import { describe, expect, it } from "vitest";
import { renderStepPrompt, PREVIOUS_PLACEHOLDER } from "./workflows";

describe("renderStepPrompt", () => {
  it("injects the previous output in place of every placeholder", () => {
    expect(
      renderStepPrompt({ prompt: `Summarize: ${PREVIOUS_PLACEHOLDER} (end of ${PREVIOUS_PLACEHOLDER})` }, "alpha\nbeta"),
    ).toBe("Summarize: alpha\nbeta (end of alpha\nbeta)");
  });

  it("leaves prompts without the placeholder untouched", () => {
    expect(renderStepPrompt({ prompt: "Hello world" }, "x")).toBe("Hello world");
  });

  it("strips the placeholder on the first step (no previous output)", () => {
    expect(renderStepPrompt({ prompt: `Review: ${PREVIOUS_PLACEHOLDER}` }, null)).toBe("Review: ");
  });

  it("treats an empty string as no previous output", () => {
    expect(renderStepPrompt({ prompt: `A ${PREVIOUS_PLACEHOLDER} B` }, "")).toBe("A  B");
  });
});
