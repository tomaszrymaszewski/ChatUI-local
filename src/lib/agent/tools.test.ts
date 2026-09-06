import { describe, expect, it } from "vitest";
import { createDeepAgent } from "deepagents";
import { buildAgentTools } from "@/lib/agent/tools";

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
