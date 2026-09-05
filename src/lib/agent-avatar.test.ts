import { describe, expect, it } from "vitest";
import {
  agentAvatarParams,
  agentAvatarCurvePath,
} from "@/lib/agent-avatar";

describe("agentAvatarParams", () => {
  it("is deterministic for the same id", () => {
    const a = agentAvatarParams("agent-123");
    const b = agentAvatarParams("agent-123");
    expect(b).toEqual(a);
  });

  it("derives a hue in [0, 360) and three curves", () => {
    const p = agentAvatarParams("some-agent-id");
    expect(p.hue).toBeGreaterThanOrEqual(0);
    expect(p.hue).toBeLessThan(360);
    expect(p.curves).toHaveLength(3);
  });

  it("uses tones of the same hue: increasing lightness per curve", () => {
    const p = agentAvatarParams("another-agent");
    const tones = p.curves.map((c) => c.tone);
    expect(tones[0]).toBeLessThan(tones[1]);
    expect(tones[1]).toBeLessThan(tones[2]);
    for (const t of tones) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(100);
    }
  });

  it("keeps curves inside the 32×32 viewBox", () => {
    const p = agentAvatarParams("bounds-check");
    for (const c of p.curves) {
      expect(c.y - c.amp).toBeGreaterThanOrEqual(0);
      expect(c.y + c.amp).toBeLessThanOrEqual(32);
    }
  });

  it("usually distinguishes different agents", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const hues = new Set(ids.map((id) => agentAvatarParams(id).hue));
    // 6 random-ish ids should produce more than one distinct avatar.
    expect(hues.size).toBeGreaterThan(1);
  });
});

describe("agentAvatarCurvePath", () => {
  it("emits an S-curve path anchored at the curve's y", () => {
    const path = agentAvatarCurvePath({ y: 16, amp: 5, up: true, tone: 50, width: 2 });
    expect(path).toContain("M 2 16");
    expect(path).toContain("30 16");
    expect(path).toMatch(/^M 2 16 C 10\.5 11(\.\d+)?, 21\.5 21(\.\d+)?, 30 16$/);
  });

  it("mirrors the S when up is false", () => {
    const up = agentAvatarCurvePath({ y: 16, amp: 5, up: true, tone: 50, width: 2 });
    const down = agentAvatarCurvePath({ y: 16, amp: 5, up: false, tone: 50, width: 2 });
    expect(up).not.toBe(down);
  });
});
