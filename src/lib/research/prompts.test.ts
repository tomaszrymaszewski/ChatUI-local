import { describe, expect, it } from "vitest";
import { buildPlannerUserMessage, buildPlannerUserMessageAdaptive } from "./prompts";

describe("buildPlannerUserMessageAdaptive", () => {
  it("query-only: delegates to buildPlannerUserMessage unchanged", () => {
    const adaptive = buildPlannerUserMessageAdaptive("charity: water", undefined, undefined);
    const original = buildPlannerUserMessage("charity: water", undefined);
    expect(adaptive).toBe(original);
  });

  it("query-only: still delegates unchanged when ourOrgContext is set", () => {
    const adaptive = buildPlannerUserMessageAdaptive("charity: water", undefined, "Acme Foundation");
    const original = buildPlannerUserMessage("charity: water", "Acme Foundation");
    expect(adaptive).toBe(original);
  });

  it("seed-only: frames questions as deepening/verifying the seed, not a bare topic line", () => {
    const message = buildPlannerUserMessageAdaptive(undefined, "Annual report excerpt: founded 2005, HQ in NYC.", undefined);
    expect(message).toContain("DEEPEN and VERIFY");
    expect(message).toContain("Annual report excerpt: founded 2005, HQ in NYC.");
    expect(message).not.toContain("Organization to research:");
  });

  it("both: uses the seed as grounding context and the topic as the focus", () => {
    const message = buildPlannerUserMessageAdaptive("charity: water", "Annual report excerpt: founded 2005.", undefined);
    expect(message).toContain('Organization to research: charity: water');
    expect(message).toContain("grounding context");
    expect(message).toContain("Annual report excerpt: founded 2005.");
  });

  it("throws when neither topic nor seed is given", () => {
    expect(() => buildPlannerUserMessageAdaptive(undefined, undefined, undefined)).toThrow();
    expect(() => buildPlannerUserMessageAdaptive("  ", "", undefined)).toThrow();
  });

  it("treats whitespace-only topic/seed as absent", () => {
    const message = buildPlannerUserMessageAdaptive("   ", "real seed content", undefined);
    expect(message).toContain("DEEPEN and VERIFY");
    expect(message).not.toContain("Organization to research:");
  });
});
