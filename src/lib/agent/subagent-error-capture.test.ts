import { describe, expect, it } from "vitest";
import type { ToolMessage } from "langchain";
import {
  flattenAgentError,
  subagentErrorCaptureMiddleware,
} from "@/lib/agent/subagent-error-capture";

// ES2021 AggregateError, built without the ES2021 lib types.
function aggregate(errors: unknown[], message = "Multiple errors occurred during superstep 6."): Error & { errors: unknown[] } {
  const e = new Error(message) as Error & { errors: unknown[] };
  e.errors = errors;
  e.name = "AggregateError";
  return e;
}

/** Minimal ToolCallRequest for driving the middleware's wrapToolCall. */
function request(name: string) {
  return {
    toolCall: { name, id: `call_${name}`, args: {} },
    tool: undefined,
    state: { messages: [] },
  } as unknown as Parameters<
    NonNullable<ReturnType<typeof subagentErrorCaptureMiddleware>["wrapToolCall"]>
  >[0];
}

async function runTool(name: string, handler: () => Promise<unknown>) {
  const mw = subagentErrorCaptureMiddleware();
  return mw.wrapToolCall!(request(name), handler as never) as Promise<ToolMessage>;
}

describe("flattenAgentError", () => {
  it("passes plain error messages through", () => {
    expect(flattenAgentError(new Error("boom"))).toBe("boom");
  });

  it("flattens an aggregate into its inner causes", () => {
    const err = aggregate([new Error("subagent A failed"), new Error("subagent B failed")]);
    expect(flattenAgentError(err)).toBe("subagent A failed | subagent B failed");
  });

  it("flattens nested aggregates", () => {
    const err = aggregate([aggregate([new Error("inner")]), new Error("outer")]);
    expect(flattenAgentError(err)).toBe("inner | outer");
  });

  it("drops duplicate causes from parallel failures", () => {
    const err = aggregate([new Error("same"), new Error("same")]);
    expect(flattenAgentError(err)).toBe("same");
  });

  it("caps long lists", () => {
    const err = aggregate(Array.from({ length: 8 }, (_, i) => new Error(`e${i}`)));
    expect(flattenAgentError(err)).toBe("e0 | e1 | e2 | e3 | e4 (+3 more)");
  });
});

describe("subagentErrorCaptureMiddleware", () => {
  it("turns a failing task call into a tool result", async () => {
    const result = await runTool("task", async () => {
      throw new Error("The model ended this turn with no visible output");
    });
    const content = String(result.content);
    expect(content).toContain("the subagent failed");
    expect(content).toContain("The model ended this turn with no visible output");
    expect(result.tool_call_id).toBe("call_task");
  });

  it("flattens aggregate subagent failures into the tool result", async () => {
    const result = await runTool("task", async () => {
      throw aggregate([new Error("cause A"), new Error("cause B")]);
    });
    expect(String(result.content)).toContain("cause A | cause B");
  });

  it("rethrows failures of other tools untouched", async () => {
    await expect(
      runTool("web_search", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("lets user aborts bubble up", async () => {
    await expect(
      runTool("task", async () => {
        const e = new Error("This operation was aborted");
        e.name = "AbortError";
        throw e;
      }),
    ).rejects.toThrow("aborted");
  });
});
