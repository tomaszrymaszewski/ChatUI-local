import { describe, it, expect } from "vitest";
import { detectModeTrigger } from "@/lib/mode-triggers";

describe("detectModeTrigger", () => {
  // ── discuss → council ────────────────────────────────────────────────
  it("detects 'discuss' as council", () => {
    expect(detectModeTrigger("discuss the pros and cons")).toBe("council");
  });

  it("detects 'Discuss' case-insensitively", () => {
    expect(detectModeTrigger("Discuss climate policy")).toBe("council");
  });

  it("detects 'DISCUSS' all-caps", () => {
    expect(detectModeTrigger("DISCUSS the matter")).toBe("council");
  });

  it("tolerates leading whitespace before 'discuss'", () => {
    expect(detectModeTrigger("  discuss AI")).toBe("council");
  });

  it("does NOT trigger on 'discussion' (word boundary)", () => {
    expect(detectModeTrigger("discussion about AI")).toBeNull();
  });

  // ── teach me / i want to learn → learn ───────────────────────────────
  it("detects 'teach me' as learn", () => {
    expect(detectModeTrigger("teach me about quantum computing")).toBe("learn");
  });

  it("detects 'Teach Me' case-insensitively", () => {
    expect(detectModeTrigger("Teach Me calculus")).toBe("learn");
  });

  it("detects 'i want to learn' as learn", () => {
    expect(detectModeTrigger("i want to learn React")).toBe("learn");
  });

  it("detects 'I Want to Learn' case-insensitively", () => {
    expect(detectModeTrigger("I Want to Learn python")).toBe("learn");
  });

  it("does NOT trigger on 'teach' alone", () => {
    expect(detectModeTrigger("teach this lesson")).toBeNull();
  });

  // ── research → research ──────────────────────────────────────────────
  it("detects 'research' as research", () => {
    expect(detectModeTrigger("research the latest AI models")).toBe("research");
  });

  it("detects 'Research' case-insensitively", () => {
    expect(detectModeTrigger("Research renewable energy")).toBe("research");
  });

  it("does NOT trigger on 'researcher' (word boundary)", () => {
    expect(detectModeTrigger("researcher found something")).toBeNull();
  });

  // ── no trigger ───────────────────────────────────────────────────────
  it("returns null for empty string", () => {
    expect(detectModeTrigger("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(detectModeTrigger("   ")).toBeNull();
  });

  it("returns null for normal text", () => {
    expect(detectModeTrigger("what is the capital of France?")).toBeNull();
  });

  it("returns null when trigger is not the first word", () => {
    expect(detectModeTrigger("can you discuss this")).toBeNull();
  });

  it("returns null for 'research shows that' (still triggers — first word)", () => {
    expect(detectModeTrigger("research shows that")).toBe("research");
  });
});
