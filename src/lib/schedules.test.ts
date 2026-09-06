import { describe, expect, it } from "vitest";
import {
  computeNextRun,
  dueSchedules,
  describeCadence,
  parseTimeHHMM,
} from "./schedules";
import type { AgentSchedule, ScheduleCadence } from "@/types";

function utc(...parts: [number, number, number, number?, number?]): Date {
  // Local-time constructor helper: (y, m, d, h?, min?) with 1-based month.
  const [y, mo, d, h = 0, min = 0] = parts;
  return new Date(y, mo - 1, d, h, min, 0, 0);
}

describe("parseTimeHHMM", () => {
  it("parses valid times to minutes since midnight", () => {
    expect(parseTimeHHMM("09:30")).toBe(570);
    expect(parseTimeHHMM("0:00")).toBe(0);
    expect(parseTimeHHMM("23:59")).toBe(1439);
  });

  it("rejects malformed times", () => {
    expect(parseTimeHHMM("24:00")).toBeNull();
    expect(parseTimeHHMM("9:60")).toBeNull();
    expect(parseTimeHHMM("9am")).toBeNull();
    expect(parseTimeHHMM(undefined)).toBeNull();
  });
});

describe("computeNextRun", () => {
  it("once: returns runAt when in the future, null when past", () => {
    const cadence: ScheduleCadence = { kind: "once", runAt: utc(2026, 9, 10, 12).toISOString() };
    expect(computeNextRun(cadence, utc(2026, 9, 5))?.getTime()).toBe(utc(2026, 9, 10, 12).getTime());
    expect(computeNextRun(cadence, utc(2026, 9, 10, 12))).toBeNull();
    expect(computeNextRun({ kind: "once" }, utc(2026, 9, 5))).toBeNull();
  });

  it("interval: adds intervalMinutes to from", () => {
    const from = utc(2026, 9, 5, 10);
    const next = computeNextRun({ kind: "interval", intervalMinutes: 30 }, from);
    expect(next?.getTime()).toBe(from.getTime() + 30 * 60_000);
    expect(computeNextRun({ kind: "interval" }, from)).toBeNull();
    expect(computeNextRun({ kind: "interval", intervalMinutes: 0 }, from)).toBeNull();
  });

  it("daily: same day when the time is still ahead", () => {
    const from = utc(2026, 9, 5, 8, 0);
    const next = computeNextRun({ kind: "daily", timeHHMM: "09:30" }, from);
    expect(next).toEqual(utc(2026, 9, 5, 9, 30));
  });

  it("daily: tomorrow when today's time has passed", () => {
    const from = utc(2026, 9, 5, 10, 0);
    const next = computeNextRun({ kind: "daily", timeHHMM: "09:30" }, from);
    expect(next).toEqual(utc(2026, 9, 6, 9, 30));
  });

  it("daily: exact time is not in the past (fires immediately at HH:MM:00)", () => {
    const from = new Date(utc(2026, 9, 5, 9, 30).getTime() + 1); // 1ms after
    const next = computeNextRun({ kind: "daily", timeHHMM: "09:30" }, from);
    expect(next).toEqual(utc(2026, 9, 6, 9, 30));
  });

  it("weekly: picks the next matching weekday and time", () => {
    // 2026-09-05 is a Saturday.
    const from = utc(2026, 9, 5, 12, 0);
    const next = computeNextRun(
      { kind: "weekly", timeHHMM: "09:00", weekdays: [1, 3] }, // Mon, Wed
      from,
    );
    expect(next).toEqual(utc(2026, 9, 7, 9, 0)); // Monday
  });

  it("weekly: today counts when the time is still ahead", () => {
    const from = utc(2026, 9, 5, 8, 0); // Saturday
    const next = computeNextRun(
      { kind: "weekly", timeHHMM: "09:00", weekdays: [6] }, // Sat
      from,
    );
    expect(next).toEqual(utc(2026, 9, 5, 9, 0));
  });

  it("weekly: null with no weekdays", () => {
    expect(computeNextRun({ kind: "weekly", timeHHMM: "09:00" }, utc(2026, 9, 5))).toBeNull();
  });
});

describe("dueSchedules", () => {
  const now = utc(2026, 9, 5, 12, 0);
  const mk = (over: Partial<AgentSchedule>): AgentSchedule => ({
    id: "s1",
    name: "S",
    cadence: { kind: "daily", timeHHMM: "09:00" },
    enabled: true,
    nextRun: utc(2026, 9, 5, 11, 0).toISOString(),
    ...over,
  });

  it("returns enabled schedules whose nextRun has passed", () => {
    const due = mk({});
    const future = mk({ id: "s2", nextRun: utc(2026, 9, 5, 13, 0).toISOString() });
    const disabled = mk({ id: "s3", enabled: false });
    const none = mk({ id: "s4", nextRun: null });
    expect(dueSchedules([due, future, disabled, none], now)).toEqual([due]);
  });

  it("treats a nextRun exactly at now as due", () => {
    const exact = mk({ nextRun: now.toISOString() });
    expect(dueSchedules([exact], now)).toEqual([exact]);
  });
});

describe("describeCadence", () => {
  it("labels each kind", () => {
    expect(describeCadence({ kind: "daily", timeHHMM: "09:00" })).toBe("Daily 09:00");
    expect(describeCadence({ kind: "interval", intervalMinutes: 30 })).toBe("Every 30 min");
    expect(describeCadence({ kind: "interval", intervalMinutes: 120 })).toBe("Every 2 h");
    expect(describeCadence({ kind: "weekly", timeHHMM: "14:30", weekdays: [3, 1] })).toBe(
      "Mon, Wed 14:30",
    );
    expect(describeCadence({ kind: "once", runAt: "not-a-date" })).toBe("Once (invalid time)");
  });
});
