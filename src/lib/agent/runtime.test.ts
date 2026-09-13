import { describe, expect, it } from "vitest";
import { toolCallArgsPreview, toolCallLabel, usageOfMessage } from "./runtime";

describe("toolCallArgsPreview", () => {
  it("previews write_local_file with a path header and content head", () => {
    const preview = toolCallArgsPreview("write_local_file", {
      path: "~/Documents/report.md",
      content: "# Title\n\nbody",
    });
    expect(preview).toMatch(/^~\/Documents\/report\.md\n\n# Title\n\nbody$/);
  });

  it("marks append writes and caps long content with a total-length note", () => {
    const preview = toolCallArgsPreview("write_local_file", {
      path: "/tmp/big.ts",
      append: true,
      content: "x".repeat(5000),
    });
    expect(preview).toMatch(/^\/tmp\/big\.ts \(append\)\n\n/);
    expect(preview).toContain("… truncated (5000 chars total)");
  });

  it("previews create_artifact with a title and language header", () => {
    const preview = toolCallArgsPreview("create_artifact", {
      title: "Sales chart",
      language: "python",
      content: "print(1)",
    });
    expect(preview).toBe("Sales chart (python)\n\nprint(1)");
  });

  it("previews run_python/run_node code and caps run_command at 2000 chars", () => {
    expect(toolCallArgsPreview("run_python", { code: "1+1" })).toBe("1+1");
    expect(toolCallArgsPreview("run_node", { code: "console.log(1)" })).toBe("console.log(1)");
    const long = toolCallArgsPreview("run_command", { command: "x".repeat(3000) });
    expect(long).toContain("… truncated (3000 chars total)");
  });

  it("previews read_local_file with the path only", () => {
    expect(toolCallArgsPreview("read_local_file", { path: "/a/b.txt", reason: "needed" })).toBe(
      "/a/b.txt",
    );
  });

  it("falls back to tightly capped JSON for other tools", () => {
    expect(toolCallArgsPreview("web_search", { query: "rust vs go" })).toBe(
      '{"query":"rust vs go"}',
    );
    const big = toolCallArgsPreview("some_mcp_tool", { payload: "y".repeat(1000) });
    expect(big?.length).toBe(501);
    expect(big?.endsWith("…")).toBe(true);
  });

  it("returns undefined for non-object input and unstringifiable input", () => {
    expect(toolCallArgsPreview("anything", "text")).toBeUndefined();
    expect(toolCallArgsPreview("anything", undefined)).toBeUndefined();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toolCallArgsPreview("anything", circular)).toBeUndefined();
  });
});

describe("toolCallLabel", () => {
  it("labels file tools with the path's basename", () => {
    expect(toolCallLabel("write_local_file", { path: "~/Documents/deck/generator.py" })).toBe(
      "Writing generator.py",
    );
    expect(toolCallLabel("read_local_file", { path: "/etc/hosts" })).toBe("Reading hosts");
  });

  it("keeps the existing labels for other tools", () => {
    expect(toolCallLabel("web_search", { query: "test" })).toBe('Searching "test"');
    expect(toolCallLabel("web_fetch", { url: "https://example.com/x" })).toBe(
      "Fetching example.com",
    );
    expect(toolCallLabel("run_python", {})).toBe("Running Python");
    expect(toolCallLabel("create_artifact", { title: "Report" })).toBe('Creating "Report"');
  });
});

describe("usageOfMessage", () => {
  it("extracts provider usage_metadata from an assembled model message", () => {
    expect(
      usageOfMessage({
        usage_metadata: {
          input_tokens: 120,
          output_tokens: 34,
          input_token_details: { cache_read: 80 },
        },
      }),
    ).toEqual({ inputTokens: 120, cachedTokens: 80, outputTokens: 34 });
  });

  it("defaults missing cache details to zero and rejects empty/absent usage", () => {
    expect(
      usageOfMessage({ usage_metadata: { input_tokens: 5, output_tokens: 0 } }),
    ).toEqual({ inputTokens: 5, cachedTokens: 0, outputTokens: 0 });
    expect(usageOfMessage(undefined)).toBeNull();
    expect(usageOfMessage({})).toBeNull();
    expect(usageOfMessage({ usage_metadata: { input_tokens: 0, output_tokens: 0 } })).toBeNull();
    expect(usageOfMessage({ usage_metadata: { input_tokens: "x" } })).toBeNull();
  });
});
