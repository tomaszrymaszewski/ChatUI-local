// Context compression for agent runs, backed by the local Headroom proxy.
//
// Two hooks, both best-effort (a down or slow proxy passes everything through):
//   1. wrapToolCall — shrink large tool results (web_fetch tables, run_python
//      logs, MCP payloads) *before* they enter langgraph state, so they stop
//      being re-sent to the model on every subsequent turn.
//   2. compressHistoryMessages — shrink older replayed turns before they're
//      sent, complementing the hard token-budget eviction in history.ts
//      (compression shrinks, truncation evicts).
//
// Both are gated on the user's "compress context" setting and skip payloads too
// short / already dense to deserve a proxy round-trip. Compression is lossy but
// bounded: Headroom preserves error items, statistical outliers, and boundaries,
// and we only ever replace a string content with a strictly shorter one.

import { createMiddleware, ToolMessage } from "langchain";
import { compressMessages, headroomAvailable } from "@/lib/headroom-client";
import { loadUserSettings } from "@/hooks/use-user-settings";
import type { AgentMessage } from "./runtime";

/** Tool results under this many chars aren't worth a compression round-trip. */
const MIN_TOOL_OUTPUT_CHARS = 1200;
/** History turns under this length pass through untouched. */
const MIN_HISTORY_CHARS = 120;

function enabled(): boolean {
  return loadUserSettings().contextCompression;
}

/**
 * Middleware that compresses large string tool results right after execution,
 * before they're written into agent state. Covers built-in AND MCP tools (one
 * hook at the agent boundary). Returns a new middleware via createMiddleware.
 */
export function toolCompressionMiddleware(modelName: string) {
  return createMiddleware({
    name: "contextCompression",
    wrapToolCall: async (request, handler) => {
      const result = await handler(request);
      if (!enabled() || !(result instanceof ToolMessage) || result.status === "error") {
        return result;
      }
      const content = result.content;
      if (typeof content !== "string" || content.length < MIN_TOOL_OUTPUT_CHARS) {
        return result;
      }
      if (!headroomAvailable()) return result;
      const id = (result as ToolMessage).tool_call_id ?? request.toolCall.id;
      const { messages, compressed } = await compressMessages(
        [{ role: "tool", content, tool_call_id: id }],
        modelName,
      );
      if (!compressed || messages.length !== 1) return result;
      const out = messages[0] as { content?: unknown } | undefined;
      const next = out?.content;
      // Only accept a strictly shorter result; the proxy returns blocks under
      // its own minimum byte-identical, which is fine to skip.
      if (typeof next !== "string" || next.length >= content.length) return result;
      // Mutate in place: preserves the message's uuid, tool_call_id, name and
      // additional_kwargs (e.g. artifact data) that a reconstructed message
      // would otherwise need careful copying to keep.
      (result as ToolMessage).content = next;
      return result;
    },
  });
}

/**
 * Compress string-content history turns (all but the most recent message, which
 * is kept verbatim). Returns the messages unchanged when compression is off,
 * the proxy is unavailable, or nothing got smaller.
 */
export async function compressHistoryMessages(
  messages: AgentMessage[],
  modelName: string,
): Promise<AgentMessage[]> {
  if (!enabled() || !headroomAvailable() || messages.length < 2) return messages;

  const eligible: { index: number; role: string; content: string }[] = [];
  messages.forEach((m, index) => {
    if (index === messages.length - 1) return; // keep the latest turn verbatim
    if (typeof m.content !== "string") return;
    if (m.content.length < MIN_HISTORY_CHARS) return;
    eligible.push({ index, role: m.role, content: m.content });
  });
  if (eligible.length < 2) return messages;

  const payload = eligible.map((e) => ({ role: e.role, content: e.content }));
  const { messages: out, compressed } = await compressMessages(payload, modelName);
  if (!compressed || out.length !== eligible.length) return messages;

  const next = messages.slice();
  let changed = false;
  out.forEach((msg, i) => {
    const target = eligible[i];
    const content = (msg as { content?: unknown } | undefined)?.content;
    if (typeof content !== "string" || content.length >= target.content.length) return;
    next[target.index] = { ...next[target.index], content };
    changed = true;
  });
  return changed ? next : messages;
}
