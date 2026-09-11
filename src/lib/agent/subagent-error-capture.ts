// Subagent failure containment + readable agent errors.
//
// The deepagents `task` tool runs a full sub-agent graph via
// `subagent.invoke(...)`. When that inner run throws (e.g. the empty-response
// guard after repeated reasoning-only turns, a provider error inside the
// subagent, …) the exception propagates out of the tool call. One failing
// task call surfaces as that error; several FAILING PARALLEL task calls are
// collected by LangGraph into an AggregateError ("Multiple errors occurred
// during superstep N") that kills the whole parent run with an opaque
// message.
//
// This middleware wraps the task tool only: its failures become tool RESULTS
// ("the subagent failed — <reason> …") so the parent agent can retry, do the
// work itself, or tell the user — the run survives. Interrupts (structured
// input / HITL) and user aborts still bubble up untouched.

import { ToolMessage, createMiddleware } from "langchain";
import { isGraphBubbleUp } from "@langchain/langgraph";

/** AggregateError without the ES2021 lib types: an Error with an errors[]. */
function isAggregateError(err: unknown): err is Error & { errors: unknown[] } {
  return (
    err instanceof Error && Array.isArray((err as { errors?: unknown }).errors)
  );
}

/**
 * A single readable message for any thrown error. Aggregates (LangGraph's
 * parallel-superstep failures) are flattened into their inner causes —
 * parallel tool calls often fail with the same error, so duplicates are
 * dropped and the list is capped.
 */
export function flattenAgentError(err: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  const walk = (e: unknown, depth: number) => {
    if (!e || depth > 3 || seen.has(e)) return;
    seen.add(e);
    if (isAggregateError(e)) {
      // The aggregate's own message is the generic "Multiple errors
      // occurred…" line — the inner errors carry the real causes.
      for (const inner of e.errors) walk(inner, depth + 1);
      if (e.errors.length === 0 && e.message) parts.push(e.message);
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    if (message) parts.push(message);
  };
  walk(err, 0);
  const unique = [...new Set(parts)];
  if (unique.length === 0) return String(err);
  const top = unique.slice(0, 5).join(" | ");
  return unique.length > 5 ? `${top} (+${unique.length - 5} more)` : top;
}

function isAbortLike(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" ||
      err.name === "CancelledError" ||
      /\babort(ed)?\b/i.test(err.message))
  );
}

/**
 * Turn `task` (subagent) failures into tool results instead of letting them
 * abort the parent run. Everything else — other tools, interrupts, user
 * stops — keeps its default error semantics.
 */
export function subagentErrorCaptureMiddleware() {
  return createMiddleware({
    name: "subagentErrorCapture",
    wrapToolCall: async (request, handler) => {
      try {
        return await handler(request);
      } catch (err) {
        if (request.toolCall.name !== "task") throw err;
        // Structured-input/HITL interrupts and user aborts must bubble.
        if (isGraphBubbleUp(err) || isAbortLike(err)) throw err;
        const reason = flattenAgentError(err);
        return new ToolMessage({
          tool_call_id: request.toolCall.id ?? "",
          name: request.toolCall.name,
          content:
            `Error: the subagent failed — ${reason}. ` +
            "You may retry the task (consider a narrower description), do the " +
            "work yourself with your own tools, or report the failure to the user.",
        });
      }
    },
  });
}
