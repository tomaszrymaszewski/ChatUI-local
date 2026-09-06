// Per-agent token usage — localStorage-backed daily buckets, same pattern
// as agents/schedules. The runtime doesn't report provider token counts, so
// runs are logged with a chars/4 estimate (the chart labels values as such).
// Recording starts when the user first runs an agent; history before that
// simply shows zeros.

export interface AgentUsageEntry {
  agentId: string;
  /** Local calendar day "YYYY-MM-DD". */
  day: string;
  tokens: number;
  runs: number;
}

const STORAGE_KEY = "chatui:agent-usage.v1";
const USAGE_EVENT = "chatui:agent-usage-changed";
/** Cap stored history so the key can't grow unboundedly. */
const MAX_ENTRIES = 2000;

/** Rough token estimate: ~4 chars per token for English prose/code. */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function loadAgentUsage(): AgentUsageEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as AgentUsageEntry[];
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e) =>
        e &&
        typeof e.agentId === "string" &&
        typeof e.day === "string" &&
        typeof e.tokens === "number" &&
        typeof e.runs === "number",
    );
  } catch {
    return [];
  }
}

function persistUsage(entries: AgentUsageEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  window.dispatchEvent(new Event(USAGE_EVENT));
}

export function subscribeToAgentUsage(fn: () => void): () => void {
  window.addEventListener(USAGE_EVENT, fn);
  return () => window.removeEventListener(USAGE_EVENT, fn);
}

/** Log one completed run for an agent (tokens should be estimated via estimateTokens). */
export function recordAgentUsage(agentId: string, tokens: number, at: Date = new Date()) {
  if (!agentId || !(tokens > 0)) return;
  const day = dayKey(at);
  const entries = loadAgentUsage();
  const existing = entries.find((e) => e.agentId === agentId && e.day === day);
  if (existing) {
    existing.tokens += tokens;
    existing.runs += 1;
  } else {
    entries.push({ agentId, day, tokens, runs: 1 });
  }
  persistUsage(entries);
}

export interface DailyUsage {
  day: string;
  /** Short label like "Mon 12". */
  label: string;
  tokens: number;
  runs: number;
}

/**
 * Last `days` daily buckets for one agent, oldest first, zero-filled.
 * `now` is injectable for tests.
 */
export function getAgentDailyUsage(
  agentId: string,
  days: number,
  now: Date = new Date(),
): DailyUsage[] {
  const entries = loadAgentUsage();
  const byDay = new Map<string, AgentUsageEntry>();
  for (const e of entries) {
    if (e.agentId === agentId) byDay.set(e.day, e);
  }
  const out: DailyUsage[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const day = dayKey(d);
    const e = byDay.get(day);
    out.push({
      day,
      label: d.toLocaleDateString([], { weekday: "short", day: "numeric" }),
      tokens: e?.tokens ?? 0,
      runs: e?.runs ?? 0,
    });
  }
  return out;
}
