import { describe, expect, it, vi } from "vitest";
import { HumanMessage } from "langchain";
import type { RunContext } from "@/lib/agent/run-context";
import { compactionNoticeMiddleware } from "./compaction";

/** Minimal RunContext stub — the middleware only touches emit. */
function fakeCtx(): { ctx: RunContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  return { ctx: { emit } as unknown as RunContext, emit };
}

const stateWith = (n: number) => ({
  messages: Array.from({ length: n }, (_, i) => new HumanMessage({ content: "x".repeat(400), id: `m${i}` })),
}) as never;

/** The d.ts types the hook as { hook, canJumpTo? }, but createMiddleware
 *  passes the plain function through — trust the runtime shape. */
async function beforeModel(mw: ReturnType<typeof compactionNoticeMiddleware>, state: never) {
  const fn = mw.beforeModel as unknown as { hook?: (s: never) => Promise<unknown> } | ((s: never) => Promise<unknown>);
  const hook = typeof fn === "function" ? fn : fn.hook!;
  return hook(state);
}

describe("compactionNoticeMiddleware", () => {
  it("emits a compact_context activity when the thread crosses the threshold", async () => {
    const { ctx, emit } = fakeCtx();
    // 40 messages x ~104 tokens ≈ 4160 > 4000 threshold.
    const mw = compactionNoticeMiddleware(4000, () => ctx);
    await beforeModel(mw, stateWith(40));
    expect(emit).toHaveBeenCalledTimes(1);
    const event = emit.mock.calls[0][0];
    expect(event.type).toBe("activity");
    expect(event.activity.name).toBe("compact_context");
    expect(event.activity.kind).toBe("tool");
    expect(event.activity.status).toBe("done");
  });

  it("stays quiet below the threshold", async () => {
    const { ctx, emit } = fakeCtx();
    const mw = compactionNoticeMiddleware(4000, () => ctx);
    await beforeModel(mw, stateWith(10));
    expect(emit).not.toHaveBeenCalled();
  });

  it("does nothing without a run context", async () => {
    const mw = compactionNoticeMiddleware(10, () => null);
    await expect(beforeModel(mw, stateWith(40))).resolves.toBeUndefined();
  });
});
