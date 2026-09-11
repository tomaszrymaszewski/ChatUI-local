import { describe, it, expect, vi } from "vitest";

// models.ts pulls getProviderApiKey (localStorage-backed) and the models.dev
// catalog (network) — replace both so the test runs hermetically in node.
vi.mock("@/lib/llm", () => ({ getProviderApiKey: async () => "test-key" }));
vi.mock("@/lib/model-capabilities", () => ({ getModelOutputLimit: async () => 8192 }));

import { createChatModel } from "./models";
import type { Provider, ReasoningEffort } from "@/types";

const provider: Provider = {
  id: "test",
  name: "Test",
  baseUrl: "https://api.example.com/v1",
  models: [{ id: "glm-5.3", name: "glm-5.3" }],
  hasKey: true,
};

/** Builds a model and returns its modelKwargs — where reasoning_effort must land. */
async function effortKwargs(modelName: string, effort?: ReasoningEffort): Promise<Record<string, unknown>> {
  const model = await createChatModel(provider, modelName, effort);
  return model.modelKwargs ?? {};
}

describe("createChatModel reasoning_effort", () => {
  it("sends reasoning_effort for GLM on default (provider would otherwise think at max)", async () => {
    const kwargs = await effortKwargs("glm-5.3", "default");
    expect(kwargs.reasoning_effort).toBe("low");
  });

  it("maps GLM efforts onto the low/high/max enum the provider accepts", async () => {
    expect((await effortKwargs("glm-5.3", "low")).reasoning_effort).toBe("low");
    expect((await effortKwargs("glm-5.3", "medium")).reasoning_effort).toBe("high");
    expect((await effortKwargs("glm-5.3", "high")).reasoning_effort).toBe("max");
    expect((await effortKwargs("glm-5.3")).reasoning_effort).toBe("low");
  });

  it("sends nothing for non-GLM models on default (provider default applies)", async () => {
    const kwargs = await effortKwargs("gpt-4o", "default");
    expect(kwargs.reasoning_effort).toBeUndefined();
  });

  it("passes explicit non-GLM efforts through as reasoning_effort", async () => {
    expect((await effortKwargs("gpt-4o", "high")).reasoning_effort).toBe("high");
    expect((await effortKwargs("gpt-4o", "low")).reasoning_effort).toBe("low");
  });
});
