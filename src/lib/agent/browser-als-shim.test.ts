import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import {
  AsyncLocalStorageProviderSingleton,
  MockAsyncLocalStorage,
} from "@langchain/core/singletons";
import { createDeepAgent } from "deepagents";
import { buildAgentTools } from "@/lib/agent/tools";
import { ensureBrowserAsyncLocalStorage } from "@/lib/agent/browser-als-shim";

// LangChain keeps its global ALS instance on globalThis under this registry
// key (see @langchain/core singletons/async_local_storage/globals). Reading
// it via Symbol.for stays correct even if the package were ever duplicated.
const ALS_GLOBAL_KEY = Symbol.for("ls:tracing_async_local_storage");

function saveGlobalAls(): unknown {
  return (globalThis as Record<symbol, unknown>)[ALS_GLOBAL_KEY];
}

function restoreGlobalAls(value: unknown): void {
  (globalThis as Record<symbol, unknown>)[ALS_GLOBAL_KEY] = value;
}

/** Simulate the browser/WKWebView: no node:async_hooks, nothing installed. */
function simulateBrowser(): void {
  (globalThis as Record<symbol, unknown>)[ALS_GLOBAL_KEY] = undefined;
}

function dedicatedAgentTools() {
  return buildAgentTools(
    true,
    () => null,
    "task",
    true,
    { agentId: "test-agent" } as never,
    "/tmp/chatui-test-deliverables",
  );
}

async function runDelegation() {
  const model = fakeModel()
    .respondWithTools([
      {
        name: "task",
        args: {
          description: "Summarize testing in one line",
          subagent_type: "general-purpose",
        },
      },
    ])
    .respond(new AIMessage("subagent result here"))
    .respond(new AIMessage("parent done"));
  const agent = await createDeepAgent({
    model: model as never,
    tools: dedicatedAgentTools(),
    systemPrompt: "You are a test agent. Spawn subagents with the task tool.",
  });
  const result = await agent.invoke(
    { messages: [{ role: "user", content: "please delegate" }] },
    { configurable: { thread_id: `als-shim-probe-${Date.now()}` } },
  );
  return { model, result };
}

async function runDelegationViaStreamEvents() {
  const model = fakeModel()
    .respondWithTools([
      {
        name: "task",
        args: {
          description: "Summarize testing in one line",
          subagent_type: "general-purpose",
        },
      },
    ])
    .respond(new AIMessage("subagent result here"))
    .respond(new AIMessage("parent done"));
  const agent = await createDeepAgent({
    model: model as never,
    tools: dedicatedAgentTools(),
    systemPrompt: "You are a test agent. Spawn subagents with the task tool.",
  });
  // Same call shape as DeepAgentSession.stream in runtime.ts.
  const run = await (
    agent as unknown as {
      streamEvents: (
        input: unknown,
        opts: unknown,
      ) => Promise<AsyncIterable<unknown>>;
    }
  ).streamEvents(
    { messages: [{ role: "user", content: "please delegate" }] },
    {
      version: "v3",
      configurable: { thread_id: `als-stream-probe-${Date.now()}` },
    },
  );
  for await (const _event of run) {
    // drain the stream; delegation happens while consuming
  }
  return { model };
}

describe("ensureBrowserAsyncLocalStorage", () => {
  let saved: unknown;
  beforeEach(() => {
    saved = saveGlobalAls();
  });
  afterEach(() => {
    restoreGlobalAls(saved);
  });

  it("is a no-op when a real AsyncLocalStorage is installed (Node)", () => {
    const before = AsyncLocalStorageProviderSingleton.getInstance();
    expect(before).not.toBeInstanceOf(MockAsyncLocalStorage);
    ensureBrowserAsyncLocalStorage();
    expect(AsyncLocalStorageProviderSingleton.getInstance()).toBe(before);
  });

  it("round-trips config to synchronous readers when none is installed", () => {
    simulateBrowser();
    expect(AsyncLocalStorageProviderSingleton.getInstance()).toBeInstanceOf(
      MockAsyncLocalStorage,
    );
    ensureBrowserAsyncLocalStorage();

    const seen: unknown[] = [];
    AsyncLocalStorageProviderSingleton.runWithConfig({ tag: "inner" }, () => {
      seen.push(AsyncLocalStorageProviderSingleton.getRunnableConfig());
    });
    expect(seen).toEqual([{ tag: "inner" }]);
  });

  it("nests synchronously and leaves nothing behind afterwards", () => {
    simulateBrowser();
    ensureBrowserAsyncLocalStorage();

    const seen: unknown[] = [];
    AsyncLocalStorageProviderSingleton.runWithConfig("outer", () => {
      AsyncLocalStorageProviderSingleton.runWithConfig("inner", () => {
        seen.push(AsyncLocalStorageProviderSingleton.getRunnableConfig());
      });
      seen.push(AsyncLocalStorageProviderSingleton.getRunnableConfig());
    });
    expect(seen).toEqual(["inner", "outer"]);
    // No leakage: async continuations and later runs see undefined, exactly
    // as with LangChain's MockAsyncLocalStorage.
    expect(AsyncLocalStorageProviderSingleton.getRunnableConfig()).toBeUndefined();
  });

  it("reproduces the browser failure without the shim", async () => {
    simulateBrowser();
    await expect(runDelegation()).rejects.toThrow(/Config not retrievable/);
  });

  it("spawns subagents in browser-like environments with the shim", async () => {
    simulateBrowser();
    ensureBrowserAsyncLocalStorage();
    const { model, result } = await runDelegation();
    expect(model.callCount).toBeGreaterThanOrEqual(3);
    const messages = result.messages as Array<{ content?: unknown }>;
    expect(String(messages[messages.length - 1]?.content ?? "")).toContain(
      "parent done",
    );
  });

  it("spawns subagents over streamEvents with the shim (the app's run path)", async () => {
    simulateBrowser();
    ensureBrowserAsyncLocalStorage();
    const { model } = await runDelegationViaStreamEvents();
    // Parent delegates, the subagent runs, the parent finishes on the result.
    expect(model.callCount).toBeGreaterThanOrEqual(3);
  });
});
