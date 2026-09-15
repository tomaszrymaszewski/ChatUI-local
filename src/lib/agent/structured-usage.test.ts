import { describe, expect, it } from "vitest";
import { invokeStructuredWithReasoning as invokeDiscussStructured } from "@/lib/agent/discuss";
import { invokeStructuredWithReasoning as invokeResearchStructured } from "@/lib/agent/deep-research";
import type { AgentEvent } from "@/lib/agent/types";

/**
 * Structured-output sub-calls (council digests/alignment checks, research
 * clarify/plan/gap checks) are billed model calls like any other — their
 * usage must reach the session widget through the same event funnel.
 */
describe("structured sub-call usage", () => {
  /** Minimal streamEvents v3 shape: per-message reasoning plus an assembled output. */
  function fakeAgent(messageOutputs: unknown[]) {
    return {
      streamEvents: async () => ({
        messages: messageOutputs.map((output) => ({
          reasoning: (async function* () {
            yield "thinking";
          })(),
          output: Promise.resolve(output),
        })),
        output: Promise.resolve({ structuredResponse: {} }),
      }),
    };
  }

  const usageBody = {
    usage_metadata: {
      input_tokens: 1000,
      output_tokens: 50,
      input_token_details: { cache_read: 800 },
    },
  };

  it.each([
    ["council", invokeDiscussStructured],
    ["research", invokeResearchStructured],
  ])("%s emits one usage event per message", async (_label, invoke) => {
    const events: AgentEvent[] = [];
    await invoke(
      fakeAgent([usageBody]),
      { messages: [] },
      (e) => events.push(e),
      "test-id",
      "Test",
      new AbortController().signal,
    );
    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toEqual({
      type: "usage",
      usage: { inputTokens: 1000, cachedTokens: 800, outputTokens: 50 },
    });
  });

  it.each([
    ["council", invokeDiscussStructured],
    ["research", invokeResearchStructured],
  ])("%s emits nothing when the message carries no usage", async (_label, invoke) => {
    const events: AgentEvent[] = [];
    await invoke(
      fakeAgent([{}]),
      { messages: [] },
      (e) => events.push(e),
      "test-id",
      "Test",
      new AbortController().signal,
    );
    expect(events.filter((e) => e.type === "usage")).toHaveLength(0);
  });
});
