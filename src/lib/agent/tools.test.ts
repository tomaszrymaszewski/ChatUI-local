import { describe, expect, it } from "vitest";
import { createDeepAgent } from "deepagents";
import { buildAgentTools, cadenceFromToolInput, scheduleFromToolInput } from "@/lib/agent/tools";

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
