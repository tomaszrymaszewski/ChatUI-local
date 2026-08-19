import { describe, expect, it } from "vitest";
import { buildPlannerUserMessage, buildPlannerUserMessageAdaptive, buildSynthesisUserMessage } from "./prompts";
import type { ResearchSession } from "./types";

describe("buildPlannerUserMessageAdaptive", () => {
  it("query-only: delegates to buildPlannerUserMessage unchanged", () => {
    const adaptive = buildPlannerUserMessageAdaptive("How do heat pumps perform in very cold climates?", undefined, undefined);
    const original = buildPlannerUserMessage("How do heat pumps perform in very cold climates?", undefined);
    expect(adaptive).toBe(original);
  });

  it("query-only: still delegates unchanged when context is set", () => {
    const adaptive = buildPlannerUserMessageAdaptive("How do heat pumps perform in very cold climates?", undefined, "Acme HVAC research team");
    const original = buildPlannerUserMessage("How do heat pumps perform in very cold climates?", "Acme HVAC research team");
    expect(adaptive).toBe(original);
  });

  it("seed-only: frames questions as deepening/verifying the seed, not a bare topic line", () => {
    const message = buildPlannerUserMessageAdaptive(undefined, "Report excerpt: founded 2005, HQ in NYC.", undefined);
    expect(message).toContain("DEEPEN and VERIFY");
    expect(message).toContain("Report excerpt: founded 2005, HQ in NYC.");
    expect(message).not.toContain("Research question:");
  });

  it("both: uses the seed as grounding context and the topic as the focus", () => {
    const message = buildPlannerUserMessageAdaptive("How do heat pumps perform in very cold climates?", "Report excerpt: founded 2005.", undefined);
    expect(message).toContain("Research question: How do heat pumps perform in very cold climates?");
    expect(message).toContain("grounding context");
    expect(message).toContain("Report excerpt: founded 2005.");
  });

  it("throws when neither topic nor seed is given", () => {
    expect(() => buildPlannerUserMessageAdaptive(undefined, undefined, undefined)).toThrow();
    expect(() => buildPlannerUserMessageAdaptive("  ", "", undefined)).toThrow();
  });

  it("treats whitespace-only topic/seed as absent", () => {
    const message = buildPlannerUserMessageAdaptive("   ", "real seed content", undefined);
    expect(message).toContain("DEEPEN and VERIFY");
    expect(message).not.toContain("Research question:");
  });
});

describe("buildSynthesisUserMessage", () => {
  it("lists the proposed report sections deduped from the research plan, in order", () => {
    const session: ResearchSession = {
      topic: "How do heat pumps perform in very cold climates?",
      plan: [
        { question: "q1", section: "Efficiency at Low Temperatures" },
        { question: "q2", section: "Cost & Incentives" },
        { question: "q3", section: "Efficiency at Low Temperatures" },
      ],
      rounds: [],
      findings: [],
      sources: [],
      gaps: [],
      phase: "synthesizing",
      notes: [],
    };

    const message = buildSynthesisUserMessage(session);
    expect(message).toContain("1. Efficiency at Low Temperatures");
    expect(message).toContain("2. Cost & Incentives");
    expect(message).not.toContain("3. Efficiency at Low Temperatures"); // deduped
  });
});
