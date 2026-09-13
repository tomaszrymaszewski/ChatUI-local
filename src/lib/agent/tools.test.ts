import { describe, expect, it } from "vitest";
import { createDeepAgent } from "deepagents";
import type { z } from "zod";
import { buildAgentTools, cadenceFromToolInput, scheduleFromToolInput } from "@/lib/agent/tools";
import { createMcpProxy } from "@/lib/agent/mcp";

// Reserved by the deepagents runtime (createDeepAgent throws
// TOOL_NAME_COLLISION for custom tools using these names; deepagents@1.13.2
// FILESYSTEM_TOOL_NAMES + "task"). Our sandboxed file tools must stay clear.
const RESERVED = new Set([
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "delete",
  "glob",
  "grep",
  "execute",
  "task",
]);

describe("buildAgentTools file tools", () => {
  it("uses sandbox-specific names that do not collide with deepagents built-ins", () => {
    const tools = buildAgentTools(true, () => null, "task", true);
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_local_file");
    expect(names).toContain("write_local_file");
    for (const name of names) {
      expect(RESERVED.has(name), `${name} collides with a deepagents built-in`).toBe(false);
    }
  });

  it("omits file tools when not enabled", () => {
    const names = buildAgentTools(true, () => null, "task", false).map((t) => t.name);
    expect(names).not.toContain("read_local_file");
    expect(names).not.toContain("write_local_file");
  });

  it("accepts the chunked-write append flag on write_local_file", () => {
    const tools = buildAgentTools(true, () => null, "task", true);
    const write = tools.find((t) => t.name === "write_local_file");
    expect(write).toBeDefined();
    const parsed = (write!.schema as z.ZodObject).parse({
      path: "/tmp/out.py",
      content: "chunk",
      append: true,
    });
    expect(parsed.append).toBe(true);
    const noAppend = (write!.schema as z.ZodObject).parse({ path: "/tmp/out.py", content: "full" });
    expect(noAppend.append).toBeUndefined();
  });

  it("passes createDeepAgent's built-in name check (the reported crash)", () => {
    const tools = buildAgentTools(true, () => null, "task", true);
    expect(() =>
      createDeepAgent({ model: "openai:gpt-4o", tools, systemPrompt: "test" }),
    ).not.toThrow();
  });
});

describe("automation tools", () => {
  it("are available in the plain chat profile", () => {
    const names = buildAgentTools(true, () => null, "chat").map((t) => t.name);
    for (const name of [
      "schedule_task",
      "list_schedules",
      "update_schedule",
      "delete_schedule",
      "create_workflow",
      "delete_workflow",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("exposes get_task_thoughts in every profile", () => {
    for (const profile of ["chat", "task", "setup"] as const) {
      const names = buildAgentTools(true, () => null, profile, true).map((t) => t.name);
      expect(names).toContain("get_task_thoughts");
    }
  });

  it("maps the tool's snake_case cadence onto the stored ScheduleCadence", () => {
    expect(
      cadenceFromToolInput({ kind: "weekly", time_hhmm: "09:00", weekdays: [1, 3] }),
    ).toEqual({ kind: "weekly", timeHHMM: "09:00", weekdays: [1, 3] });
    expect(cadenceFromToolInput({ kind: "interval", interval_minutes: 30 })).toEqual({
      kind: "interval",
      intervalMinutes: 30,
    });
    expect(cadenceFromToolInput({ kind: "daily" })).toEqual({ kind: "daily" });
  });

  it("rejects invalid cadences without touching storage", () => {
    const res = scheduleFromToolInput(
      { name: "x", prompt: "hi", cadence: { kind: "daily" } },
      undefined,
      new Date("2026-01-20T10:00:00"),
    );
    expect(res.error).toContain("time_hhmm");
    expect(res.schedule).toBeUndefined();
  });

  it("requires a prompt or a workflow_id", () => {
    const res = scheduleFromToolInput(
      { name: "x", cadence: { kind: "daily", time_hhmm: "09:00" } },
      undefined,
      new Date("2026-01-20T10:00:00"),
    );
    expect(res.error).toContain("prompt");
  });

  it("rejects a prompt together with a workflow_id", () => {
    const res = scheduleFromToolInput(
      { name: "x", prompt: "hi", workflow_id: "nope", cadence: { kind: "daily", time_hhmm: "09:00" } },
      undefined,
      new Date("2026-01-20T10:00:00"),
    );
    expect(res.error).toContain("either prompt or workflow_id");
  });
});

describe("mcp proxy tools", () => {
  it("are exposed per-run and do not collide with reserved names", () => {
    const proxy = createMcpProxy();
    const names = proxy.tools.map((t) => t.name);
    expect(names).toContain("list_mcp_tools");
    expect(names).toContain("call_mcp_tool");
    for (const name of names) {
      expect(RESERVED.has(name), `${name} collides with a deepagents built-in`).toBe(false);
    }
    void proxy.dispose();
  });

  it("accepts (server, tool, args) at the schema level", () => {
    const proxy = createMcpProxy();
    const call = proxy.tools.find((t) => t.name === "call_mcp_tool");
    expect(call).toBeDefined();
    const parsed = (call!.schema as z.ZodObject).parse({
      server: "github",
      tool: "create_issue",
      args: { title: "Bug" },
    });
    expect(parsed.args).toEqual({ title: "Bug" });
    void proxy.dispose();
  });

  it("declines servers outside a sandboxed run's connector allowlist", async () => {
    const proxy = createMcpProxy(null, ["zapier"]);
    const list = proxy.tools.find((t) => t.name === "list_mcp_tools");
    const result = await list!.invoke({ server: "github" });
    expect(result).toContain("not available in this run");
    await proxy.dispose();
  });
});
