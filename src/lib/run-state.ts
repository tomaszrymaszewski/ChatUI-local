import type { Message } from "@/types";

/**
 * How long an unfinalized run record counts as "live" after its last write.
 * While a run makes progress its record is refreshed at least every 2.5s
 * (the crash-safety save); the window is generous so quiet stretches (a long
 * tool call) and sync latency don't make a live run look dead.
 */
export const RUN_ACTIVE_WINDOW_MS = 90_000;

/** Milliseconds since the record's last write (updatedAt, or the creation
 *  timestamp for legacy records). Infinity when unparseable. */
export function runRecordAge(
  msg: Pick<Message, "updatedAt" | "timestamp">,
): number {
  const stamp =
    typeof msg.updatedAt === "number" && Number.isFinite(msg.updatedAt)
      ? msg.updatedAt
      : msg.timestamp instanceof Date
        ? msg.timestamp.getTime()
        : Date.parse(String(msg.timestamp));
  return Number.isFinite(stamp) ? Date.now() - stamp : Number.POSITIVE_INFINITY;
}

type RunRecordFields = Pick<
  Message,
  "workStartedAt" | "workEndedAt" | "workSegments" | "updatedAt" | "timestamp"
>;

/**
 * True when an assistant message record describes a run that is still in
 * progress: work tracking exists, the run was never finalized (no
 * workEndedAt / open last segment), and the record was written recently.
 * A finalized record (even just now) is not active; a stale unfinalized one
 * belongs to a dead context and is treated as ended.
 */
export function isRunRecordActive(msg: RunRecordFields): boolean {
  if (msg.workEndedAt !== undefined) return false;
  const hasTracking =
    msg.workStartedAt !== undefined || (msg.workSegments?.length ?? 0) > 0;
  if (!hasTracking) return false;
  const last = msg.workSegments?.at(-1);
  if (last && last.endedAt !== undefined) return false;
  return runRecordAge(msg) < RUN_ACTIVE_WINDOW_MS;
}

/**
 * The newest run-bearing assistant record of a session, when that run is
 * still live — i.e. some app context (another window/instance, or another
 * device syncing in) is mid-run in this chat. Returns null when the latest
 * run is finalized (or nothing has run yet). Placeholder messages (empty
 * assistant stubs created before a run starts) carry no tracking and are
 * skipped.
 */
export function findActiveRunMessage(
  messages: Array<Pick<Message, "role"> & RunRecordFields>,
): (Pick<Message, "role"> & RunRecordFields) | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const hasTracking =
      msg.workStartedAt !== undefined || (msg.workSegments?.length ?? 0) > 0;
    if (!hasTracking) continue;
    // The newest tracked record decides: if it is finalized, older
    // unfinalized leftovers are dead by definition.
    return isRunRecordActive(msg) ? msg : null;
  }
  return null;
}
