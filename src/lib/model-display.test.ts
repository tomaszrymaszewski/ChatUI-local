import { describe, expect, it } from "vitest";
import { formatModelName, modelLabel } from "@/lib/model-display";

describe("formatModelName", () => {
  it("formats the user's examples", () => {
    expect(formatModelName("accounts/fireworks/models/glm-5p3")).toBe("Glm 5.3");
    expect(formatModelName("accounts/fireworks/models/deepseek-v4-pro-0813")).toBe(
      "Deepseek V4 Pro",
    );
  });

  it("strips registry prefixes and vendor namespaces", () => {
    expect(formatModelName("accounts/fireworks/models/glm-5p3-flash")).toBe("Glm 5.3 Flash");
    expect(formatModelName("accounts/fireworks/routers/kimi-k3-fast")).toBe("Kimi K3 Fast");
    expect(formatModelName("google/gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    expect(formatModelName("Qwen/Qwen3.5-9B")).toBe("Qwen 3.5 9B");
    expect(formatModelName("deepseek/deepseek-v4-flash")).toBe("Deepseek V4 Flash");
    expect(formatModelName("~openai/gpt-mini-latest")).toBe("Gpt Mini");
  });

  it("drops date and build suffixes", () => {
    expect(formatModelName("deepseek-v4-flash:0731")).toBe("Deepseek V4 Flash");
    expect(formatModelName("gpt-4o-2024-11-20")).toBe("Gpt 4O");
    expect(formatModelName("claude-sonnet-4-5-20250929")).toBe("Claude Sonnet 4.5");
    expect(formatModelName("deepseek-ai/DeepSeek-V4-Pro-0813")).toBe("Deepseek V4 Pro");
  });

  it("merges adjacent single digits into point versions", () => {
    expect(formatModelName("claude-haiku-4-5")).toBe("Claude Haiku 4.5");
    expect(formatModelName("claude-3-5-sonnet")).toBe("Claude 3.5 Sonnet");
  });

  it("drops a trailing latest tag", () => {
    expect(formatModelName("gemini-flash-lite-latest")).toBe("Gemini Flash Lite");
  });

  it("splits letter-to-digit joins but keeps size tokens intact", () => {
    expect(formatModelName("llama3.2")).toBe("Llama 3.2");
    expect(formatModelName("qwen2.5")).toBe("Qwen 2.5");
    expect(formatModelName("meta-llama/llama-3.3-70b-instruct")).toBe("Llama 3.3 70B Instruct");
    expect(formatModelName("gpt-oss-120b")).toBe("Gpt Oss 120B");
    expect(formatModelName("gemma4:31b")).toBe("Gemma 4 31B");
  });

  it("expands fireworks p-encoded decimals", () => {
    expect(formatModelName("llama-v3p1-70b-instruct")).toBe("Llama V3.1 70B Instruct");
    expect(formatModelName("kimi-k2p7-code")).toBe("Kimi K2.7 Code");
    expect(formatModelName("qwen3p8-max")).toBe("Qwen 3.8 Max");
  });

  it("handles simple ids and fallbacks", () => {
    expect(formatModelName("gpt-5-mini")).toBe("Gpt 5 Mini");
    expect(formatModelName("mistral")).toBe("Mistral");
    expect(formatModelName("  ")).toBe("  ");
    expect(formatModelName("latest")).toBe("Latest");
  });
});

describe("modelLabel", () => {
  it("prefers a manually set display name", () => {
    expect(modelLabel({ name: "gpt-5-mini", displayName: "My Model" })).toBe("My Model");
  });

  it("treats a display name equal to the raw id as unset", () => {
    expect(modelLabel({ name: "gpt-5-mini", displayName: "gpt-5-mini" })).toBe("Gpt 5 Mini");
  });

  it("formats when no display name exists", () => {
    expect(modelLabel({ name: "accounts/fireworks/models/glm-5p3" })).toBe("Glm 5.3");
    expect(modelLabel({ name: "gpt-5-mini", displayName: undefined })).toBe("Gpt 5 Mini");
  });
});
