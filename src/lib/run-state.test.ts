import { describe, expect, it } from "vitest";
import {
  findActiveRunMessage,
  isRunRecordActive,
  RUN_ACTIVE_WINDOW_MS,
} from "./run-state";

const NOW = Date.now();

function record(overrides: Record<string, unknown>) {
  return {
    role: "assistant" as const,
    timestamp: new Date(NOW),
    updatedAt: NOW,
    ...overrides,
  };
}

describe("isRunRecordActive", () => {
  it("is active for a fresh unfinalized run with an open segment", () => {
    expect(
      isRunRecordActive(
        record({
          workStartedAt: NOW - 60_000,
          workSegments: [{ id: "w1", startedAt: NOW - 60_000, textOffset: 0 }],
        }),
      ),
    ).toBe(true);
  });

  it("is not active once the run is finalized", () => {
    expect(
      isRunRecordActive(
        record({
          workStartedAt: NOW - 60_000,
          workEndedAt: NOW,
          workSegments: [
            { id: "w1", startedAt: NOW - 60_000, textOffset: 0, endedAt: NOW },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("is not active when the last write is older than the liveness window", () => {
    expect(
      isRunRecordActive(
        record({
          updatedAt: NOW - RUN_ACTIVE_WINDOW_MS - 1,
          workStartedAt: NOW - 120_000,
          workSegments: [{ id: "w1", startedAt: NOW - 120_000, textOffset: 0 }],
        }),
      ),
    ).toBe(false);
  });

  it("falls back to the creation timestamp for legacy records without updatedAt", () => {
    const fresh = record({ timestamp: new Date(NOW - 1_000), updatedAt: undefined });
    delete (fresh as Record<string, unknown>).updatedAt;
    expect(isRunRecordActive({ ...fresh, workStartedAt: NOW - 1_000 })).toBe(true);

    const stale = record({ timestamp: new Date(NOW - 600_000), updatedAt: undefined });
    delete (stale as Record<string, unknown>).updatedAt;
    expect(isRunRecordActive({ ...stale, workStartedAt: NOW - 600_000 })).toBe(false);
  });

  it("is not active without any work tracking", () => {
    expect(isRunRecordActive(record({}))).toBe(false);
  });
});

describe("findActiveRunMessage", () => {
  it("returns the newest tracked record while it is live", () => {
    const live = record({
      workStartedAt: NOW - 5_000,
      workSegments: [{ id: "w1", startedAt: NOW - 5_000, textOffset: 0 }],
    });
    const messages = [
      record({ role: "user" }),
      record({ workStartedAt: NOW - 300_000, workEndedAt: NOW - 200_000 }),
      live,
    ];
    expect(findActiveRunMessage(messages)).toBe(live);
  });

  it("skips placeholder stubs and returns null when the latest run is finalized", () => {
    const messages = [
      record({ workStartedAt: NOW - 5_000, workEndedAt: NOW }),
      record({ content: "", workStartedAt: undefined }),
    ];
    expect(findActiveRunMessage(messages)).toBeNull();
  });

  it("returns null when the newest tracked record is stale", () => {
    const messages = [
      record({
        updatedAt: NOW - RUN_ACTIVE_WINDOW_MS - 5_000,
        workStartedAt: NOW - 600_000,
        workSegments: [{ id: "w1", startedAt: NOW - 600_000, textOffset: 0 }],
      }),
    ];
    expect(findActiveRunMessage(messages)).toBeNull();
  });
});
