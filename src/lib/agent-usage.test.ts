import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dayKey,
  estimateTokens,
  getAgentDailyUsage,
  loadAgentUsage,
  recordAgentUsage,
} from "@/lib/agent-usage";

// vitest runs in node (no DOM): stub the browser storage/event surface the
// module uses.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
vi.stubGlobal("window", {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
});

beforeEach(() => {
  mem.clear();
});

describe("estimateTokens", () => {
  it("estimates ~4 chars per token with a floor of 1", () => {
    expect(estimateTokens(0)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(400)).toBe(100);
    expect(estimateTokens(401)).toBe(101);
  });
});

describe("recordAgentUsage", () => {
  it("accumulates tokens and runs within the same day", () => {
    const at = new Date(2026, 8, 4, 10, 0);
    recordAgentUsage("a1", 100, at);
    recordAgentUsage("a1", 50, new Date(2026, 8, 4, 18, 0));
    const entries = loadAgentUsage();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ agentId: "a1", day: dayKey(at), tokens: 150, runs: 2 });
  });

  it("keeps separate buckets per day and per agent", () => {
    recordAgentUsage("a1", 10, new Date(2026, 8, 3));
    recordAgentUsage("a1", 20, new Date(2026, 8, 4));
    recordAgentUsage("a2", 30, new Date(2026, 8, 4));
    expect(loadAgentUsage()).toHaveLength(3);
  });

  it("ignores empty agent ids and non-positive token counts", () => {
    recordAgentUsage("", 100);
    recordAgentUsage("a1", 0);
    expect(loadAgentUsage()).toHaveLength(0);
  });
});

describe("getAgentDailyUsage", () => {
  it("returns zero-filled trailing days oldest-first", () => {
    const now = new Date(2026, 8, 4, 12, 0);
    recordAgentUsage("a1", 80, new Date(2026, 8, 4, 9, 0));
    const days = getAgentDailyUsage("a1", 3, now);
    expect(days).toHaveLength(3);
    expect(days.map((d) => d.day)).toEqual([
      dayKey(new Date(2026, 8, 2)),
      dayKey(new Date(2026, 8, 3)),
      dayKey(new Date(2026, 8, 4)),
    ]);
    expect(days[0].tokens).toBe(0);
    expect(days[2]).toMatchObject({ tokens: 80, runs: 1 });
  });

  it("isolates agents from each other", () => {
    const now = new Date(2026, 8, 4, 12, 0);
    recordAgentUsage("a2", 40, now);
    expect(getAgentDailyUsage("a1", 1, now)[0].tokens).toBe(0);
    expect(getAgentDailyUsage("a2", 1, now)[0].tokens).toBe(40);
  });
});
