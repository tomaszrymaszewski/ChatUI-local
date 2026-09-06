import { useEffect } from "react";
import { toast } from "sonner";
import type { AgentSchedule } from "@/types";
import { dueSchedules, computeNextRun, loadSchedules, updateSchedule } from "@/lib/schedules";
import { loadWorkflows } from "@/lib/workflows";
import { runHeadlessTask, runWorkflowSteps } from "@/lib/headless-run";

/**
 * Fires due schedules while the app is open. Mounted once (ChatView). Ticks
 * every 30s; overdue schedules (app was closed) are caught up on the first
 * tick. Runs execute sequentially — an army, but one that queues politely.
 */
const TICK_MS = 30_000;

/** Schedule ids with a run in progress — guards against double-firing. */
const inFlight = new Set<string>();

async function fireSchedule(schedule: AgentSchedule) {
  const now = new Date();
  // Advance nextRun before running so a long run never re-fires on the next
  // tick; "once" schedules have nothing after this run.
  const next = computeNextRun(schedule.cadence, now);
  updateSchedule(schedule.id, { nextRun: next ? next.toISOString() : null });
  inFlight.add(schedule.id);
  try {
    if (schedule.workflowId) {
      const workflow = loadWorkflows().find((w) => w.id === schedule.workflowId);
      if (!workflow) {
        updateSchedule(schedule.id, {
          lastRun: now.toISOString(),
          lastStatus: "error",
        });
        toast.error(`Schedule "${schedule.name}" failed: workflow not found`);
        return;
      }
      const outcomes = await runWorkflowSteps(workflow);
      const last = outcomes[outcomes.length - 1];
      const failed = outcomes.find((o) => o.error);
      updateSchedule(schedule.id, {
        lastRun: now.toISOString(),
        lastStatus: failed ? "error" : "ok",
        lastSessionId: last?.sessionId,
      });
      if (failed) {
        toast.error(`Workflow "${workflow.name}" failed: ${failed.error ?? "unknown error"}`);
      } else {
        toast.success(`Workflow "${workflow.name}" finished (${workflow.steps.length} steps)`);
      }
    } else {
      const outcome = await runHeadlessTask({
        agentId: schedule.agentId,
        prompt: schedule.prompt ?? "",
        title: schedule.name,
      });
      updateSchedule(schedule.id, {
        lastRun: now.toISOString(),
        lastStatus: outcome.error ? "error" : "ok",
        lastSessionId: outcome.sessionId,
      });
      if (outcome.error) {
        toast.error(`Schedule "${schedule.name}" failed: ${outcome.error}`);
      } else {
        toast.success(`Schedule "${schedule.name}" finished`);
      }
    }
  } catch (err) {
    updateSchedule(schedule.id, {
      lastRun: now.toISOString(),
      lastStatus: "error",
    });
    toast.error(
      `Schedule "${schedule.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    inFlight.delete(schedule.id);
  }
}

async function tick() {
  const due = dueSchedules(loadSchedules(), new Date()).filter(
    (s) => !inFlight.has(s.id),
  );
  for (const schedule of due) {
    await fireSchedule(schedule);
  }
}

export function useScheduler() {
  useEffect(() => {
    // First tick runs immediately: catches up schedules that came due while
    // the app was closed.
    void tick();
    const timer = setInterval(() => void tick(), TICK_MS);
    return () => clearInterval(timer);
  }, []);
}
