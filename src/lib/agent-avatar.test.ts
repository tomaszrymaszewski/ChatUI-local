import { describe, expect, it, vi, afterEach } from "vitest";
import {
  agentAvatarParams,
  agentAvatarCurvePath,
} from "@/lib/agent-avatar";

/** In-memory localStorage stand-in — the salt registry persists there. */
function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("never gives two agents the same look, even when raw hashes collide", () => {
    stubStorage();
    // Enough agents to exhaust the ~24 visually distinct hue families twice
    // over — collisions in the raw hash are guaranteed, so any duplicate look
    // means the probe-and-claim logic failed.
    const ids = Array.from({ length: 50 }, (_, i) => `agent-${i}`);
    const sigs = new Set(
      ids.map((id) => {
        const p = agentAvatarParams(id);
        return `${Math.floor(p.hue / 15)}:${p.curves.map((c) => `${c.amp}|${c.up ? 1 : 0}|${c.tone}`).join(";")}`;
      }),
    );
    expect(sigs.size).toBe(ids.length);
  });

  it("spreads agents across distinct hue families while families remain", () => {
    stubStorage();
    const ids = Array.from({ length: 20 }, (_, i) => `spread-${i}`);
    const buckets = ids.map((id) => Math.floor(agentAvatarParams(id).hue / 15));
    expect(new Set(buckets).size).toBe(20);
  });

  it("keeps the claimed salt stable across repeated calls", () => {
    const store = stubStorage();
    const first = agentAvatarParams("stable-agent");
    const second = agentAvatarParams("stable-agent");
    expect(second).toEqual(first);
    expect(store.get("chatui:avatar-salts")).toContain("stable-agent");
  });

  it("derives a different look for a colliding id instead of matching an existing agent", () => {
    stubStorage();
    // Find an id pair whose raw derivation lands in the same hue family.
    let collidingId = "";
    const base = agentAvatarParams("anchor-agent");
    const baseBucket = Math.floor(base.hue / 15);
    for (let i = 0; i < 5000; i++) {
      const candidate = `probe-${i}`;
      const p = agentAvatarParams(candidate);
      if (Math.floor(p.hue / 15) === baseBucket) {
        collidingId = candidate;
        break;
      }
    }
    expect(collidingId).not.toBe("");

    // Re-derive from scratch: the anchor claims its family first, so the
    // colliding id must probe to a different hue family.
    stubStorage();
    const anchor = agentAvatarParams("anchor-agent");
    const probed = agentAvatarParams(collidingId);
    expect(Math.floor(probed.hue / 15)).not.toBe(Math.floor(anchor.hue / 15));
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
