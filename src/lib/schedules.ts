import type { AgentSchedule, ScheduleCadence } from "@/types";

// Scheduled agent runs — localStorage-backed, same pattern as agents.ts.
// The scheduler hook (use-scheduler.ts) advances nextRun and fires headless
// runs while the app is open; nothing runs when the app is closed.

const STORAGE_KEY = "chatui:schedules";
const SCHEDULES_EVENT = "chatui:schedules-changed";

export function loadSchedules(): AgentSchedule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as AgentSchedule[];
    if (!Array.isArray(data)) return [];
    return data.filter((s) => s && typeof s.id === "string" && typeof s.name === "string");
  } catch {
    return [];
  }
}

function persistSchedules(schedules: AgentSchedule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
  window.dispatchEvent(new Event(SCHEDULES_EVENT));
}

export function saveSchedule(
  def: Omit<AgentSchedule, "id"> & { id?: string },
): AgentSchedule {
  const schedules = loadSchedules();
  const existing = def.id ? schedules.find((s) => s.id === def.id) : undefined;
  if (existing) {
    const next: AgentSchedule = { ...existing, ...def, id: existing.id };
    persistSchedules(schedules.map((s) => (s.id === existing.id ? next : s)));
    return next;
  }
  const full: AgentSchedule = { ...def, id: crypto.randomUUID() };
  persistSchedules([full, ...schedules]);
  return full;
}

export function updateSchedule(
  id: string,
  patch: Partial<Omit<AgentSchedule, "id">>,
): AgentSchedule | null {
  const schedules = loadSchedules();
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const next: AgentSchedule = { ...schedules[idx], ...patch, id };
  schedules[idx] = next;
  persistSchedules(schedules);
  return next;
}

export function deleteSchedule(id: string) {
  persistSchedules(loadSchedules().filter((s) => s.id !== id));
}

export function subscribeToSchedules(fn: () => void): () => void {
  window.addEventListener(SCHEDULES_EVENT, fn);
  return () => window.removeEventListener(SCHEDULES_EVENT, fn);
}

/** Minutes since midnight for "HH:MM" (local); null when malformed. */
export function parseTimeHHMM(time: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((time ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function atMinutes(date: Date, minutes: number): Date {
  const d = new Date(date);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The next run time for a cadence, strictly after `from`. Returns null when the
 * cadence can never fire again ("once" in the past) or is malformed.
 * Pure — local time, no side effects — so it stays unit-testable.
 */
export function computeNextRun(cadence: ScheduleCadence, from: Date): Date | null {
  switch (cadence.kind) {
    case "once": {
      if (!cadence.runAt) return null;
      const t = new Date(cadence.runAt);
      return isNaN(t.getTime()) || t.getTime() <= from.getTime() ? null : t;
    }
    case "interval": {
      const mins = cadence.intervalMinutes;
      if (!mins || mins <= 0) return null;
      return new Date(from.getTime() + mins * 60_000);
    }
    case "daily": {
      const time = parseTimeHHMM(cadence.timeHHMM);
      if (time === null) return null;
      let candidate = atMinutes(from, time);
      if (candidate.getTime() <= from.getTime()) {
        candidate = atMinutes(new Date(from.getTime() + 86_400_000), time);
      }
      return candidate;
    }
    case "weekly": {
      const time = parseTimeHHMM(cadence.timeHHMM);
      const days = (cadence.weekdays ?? []).filter((d) => d >= 0 && d <= 6);
      if (time === null || days.length === 0) return null;
      // Scan the next 8 days (today + 7) for the earliest matching slot.
      for (let i = 0; i < 8; i++) {
        const day = new Date(startOfDay(from).getTime() + i * 86_400_000);
        if (!days.includes(day.getDay())) continue;
        const candidate = atMinutes(day, time);
        if (candidate.getTime() > from.getTime()) return candidate;
      }
      return null;
    }
  }
}

/** Schedules that are enabled and due (nextRun at or before `now`). */
export function dueSchedules(schedules: AgentSchedule[], now: Date): AgentSchedule[] {
  return schedules.filter(
    (s) => s.enabled && s.nextRun && new Date(s.nextRun).getTime() <= now.getTime(),
  );
}

/** Short human label for a cadence, e.g. "Daily 09:00", "Every 30 min", "Wed, Fri 14:30". */
export function describeCadence(cadence: ScheduleCadence): string {
  const time = cadence.timeHHMM ?? "";
  switch (cadence.kind) {
    case "once": {
      if (!cadence.runAt) return "Once (no time set)";
      const d = new Date(cadence.runAt);
      return isNaN(d.getTime())
        ? "Once (invalid time)"
        : `Once — ${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    case "interval":
      return cadence.intervalMinutes && cadence.intervalMinutes >= 60
        ? `Every ${Math.round(cadence.intervalMinutes / 60)} h`
        : `Every ${cadence.intervalMinutes ?? 0} min`;
    case "daily":
      return `Daily ${time}`;
    case "weekly": {
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const days = (cadence.weekdays ?? []).slice().sort();
      return days.length ? `${days.map((d) => names[d]).join(", ")} ${time}` : `Weekly ${time}`;
    }
  }
}
