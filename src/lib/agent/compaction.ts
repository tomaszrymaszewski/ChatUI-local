// Visibility hook for mid-run context compaction.
//
// The agent runtime pairs this middleware with langchain's
// summarizationMiddleware: both trigger on the same absolute token threshold,
// and this one runs first in the middleware array, so its beforeModel hook
// sees the pre-compaction state. When the running thread crosses the
// threshold it emits an activity chip so compaction shows up in the UI like
// any other tool call ("Compacting context — summarizing older turns").
//
// Self-limiting: summarization keeps roughly half the threshold in recent
// messages, so after a compaction pass the count drops back below the
// threshold and this stays quiet until the thread grows again.

import { createMiddleware, countTokensApproximately, type BaseMessage } from "langchain";
import type { RunContext } from "@/lib/agent/run-context";

export function compactionNoticeMiddleware(
  thresholdTokens: number,
  getCtx: () => RunContext | null,
) {
  return createMiddleware({
    name: "compactionNotice",
    beforeModel: async (state) => {
      const messages = (state as { messages?: BaseMessage[] }).messages;
      if (!Array.isArray(messages) || messages.length === 0) return;
      if (countTokensApproximately(messages) < thresholdTokens) return;
      getCtx()?.emit({
        type: "activity",
        activity: {
          id: `compaction-${Date.now()}`,
          kind: "tool",
          name: "compact_context",
          status: "done",
          label: "Compacting context — summarizing older turns",
        },
      });
    },
  });
}
