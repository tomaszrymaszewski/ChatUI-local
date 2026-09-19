import { describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { createDeepAgent } from "deepagents";
import { buildAgentTools } from "@/lib/agent/tools";

// Dedicated agents run the task profile inside their filesystem sandbox.
// This locks in that those runs expose the `task` tool (the
// general-purpose subagent) and can actually spawn a subagent —
// regressions here would silently take subagents away from every agent.
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

const SYSTEM_PROMPT =
  "You are a test agent. Spawn subagents with the task tool.";

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
    systemPrompt: SYSTEM_PROMPT,
  });
  const result = await agent.invoke(
    { messages: [{ role: "user", content: "please delegate" }] },
    { configurable: { thread_id: `subagent-probe-${Date.now()}` } },
  );
  return { model, result };
}

describe("dedicated-agent subagents", () => {
  it("passes the delegation prompt to the spawned subagent", async () => {
    const { model } = await runDelegation();
    // Call 0: parent delegates via task. Call 1: the subagent itself runs.
    expect(model.callCount).toBeGreaterThanOrEqual(2);
    const subagentMessages = model.calls[1]?.messages ?? [];
    const seenBySubagent = subagentMessages
      .map((m: { content?: unknown }) => String(m.content ?? ""))
      .join("\n");
    expect(seenBySubagent).toContain("Summarize testing in one line");
  });

  it("completes a general-purpose subagent round trip", async () => {
    const { model, result } = await runDelegation();
    // Parent delegates, the subagent runs, the parent finishes on the result.
    expect(model.callCount).toBeGreaterThanOrEqual(3);
    const messages = result.messages as Array<{ content?: unknown }>;
    expect(String(messages[messages.length - 1]?.content ?? "")).toContain(
      "parent done",
    );
  });
});
