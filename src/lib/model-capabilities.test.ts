import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// model-capabilities.ts reads localStorage and fetches models.dev — stub both
// so the lookup logic runs hermetically in node.
const storage = new Map<string, string>();

const FAKE_CATALOG = {
  "fireworks-ai": {
    name: "Fireworks AI",
    models: {
      "accounts/fireworks/models/glm-5p3-flash": {
        id: "accounts/fireworks/models/glm-5p3-flash",
        name: "GLM 5.3 Flash",
        modalities: { input: ["text", "image"] },
        limit: { context: 1048573, output: 131072 },
        cost: { input: 0.15, output: 0.5, cache_read: 0.03 },
      },
    },
  },
  openrouter: {
    models: {
      "z-ai/glm-5.3-flash": {
        id: "z-ai/glm-5.3-flash",
        limit: { context: 1310720, output: 131072 },
      },
    },
  },
};

function provider(id: string, baseUrl: string) {
  return { id, name: id, baseUrl, models: [], hasKey: true };
}

beforeEach(() => {
  vi.resetModules();
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => FAKE_CATALOG })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function load() {
  return await import("./model-capabilities");
}

describe("providerKeyForBaseUrl", () => {
  it("maps Fireworks to the fireworks-ai catalog key", async () => {
    const mod = await load();
    expect(mod.providerKeyForBaseUrl("https://api.fireworks.ai/inference/v1")).toBe(
      "fireworks-ai",
    );
  });

  it("maps OpenRouter and z.ai endpoints", async () => {
    const mod = await load();
    expect(mod.providerKeyForBaseUrl("https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(mod.providerKeyForBaseUrl("https://api.z.ai/api/paas/v4")).toBe("zai");
  });

  it("returns null for custom endpoints", async () => {
    const mod = await load();
    expect(mod.providerKeyForBaseUrl("https://my-proxy.internal:8080/v1")).toBeNull();
  });
});

describe("getModelContextWindow", () => {
  it("resolves a prefixed Fireworks id to its catalog window", async () => {
    const mod = await load();
    const tokens = await mod.getModelContextWindow(
      provider("fw", "https://api.fireworks.ai/inference/v1"),
      "accounts/fireworks/models/glm-5p3-flash",
    );
    expect(tokens).toBe(1048573);
  });

  it("falls back to the same model id under another provider", async () => {
    const mod = await load();
    // Unmapped endpoint + a short model name the Fireworks section lacks.
    const resolved = await mod.resolveModelContextWindow(
      provider("custom", "https://my-proxy.internal:8080/v1"),
      "z-ai/glm-5.3-flash",
    );
    expect(resolved).toEqual({ tokens: 1310720, source: "catalog-any" });
  });

  it("returns null for a model no catalog provider serves", async () => {
    const mod = await load();
    const tokens = await mod.getModelContextWindow(
      provider("custom", "https://my-proxy.internal:8080/v1"),
      "no-such-model-xyz",
    );
    expect(tokens).toBeNull();
  });

  it("prefers the user override over the catalog", async () => {
    const mod = await load();
    const p = provider("fw", "https://api.fireworks.ai/inference/v1");
    mod.setContextOverride("fw", "accounts/fireworks/models/glm-5p3-flash", 200000);
    const resolved = await mod.resolveModelContextWindow(
      p,
      "accounts/fireworks/models/glm-5p3-flash",
    );
    expect(resolved).toEqual({ tokens: 200000, source: "override" });
  });
});

describe("getModelOutputLimit", () => {
  it("falls back to the same model id under another provider", async () => {
    const mod = await load();
    const out = await mod.getModelOutputLimit(
      provider("custom", "https://my-proxy.internal:8080/v1"),
      "z-ai/glm-5.3-flash",
    );
    expect(out).toBe(131072);
  });
});

describe("catalog slimming", () => {
  const FAT_CATALOG = {
    openrouter: {
      models: {
        "z-ai/glm-5.3-flash": {
          id: "z-ai/glm-5.3-flash",
          name: "GLM 5.3 Flash",
          description: "A very long marketing paragraph nobody reads at lookup time.",
          cost: { input: 1, output: 2 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 1310720, output: 131072 },
          reasoning_options: { effort: ["low"] },
        },
      },
    },
  };

  it("strips unread fields before caching, keeps lookups working", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => FAT_CATALOG })),
    );
    const mod = await load();
    const tokens = await mod.getModelContextWindow(
      provider("custom", "https://my-proxy.internal:8080/v1"),
      "z-ai/glm-5.3-flash",
    );
    expect(tokens).toBe(1310720);
    const stored = JSON.parse(storage.get("chatui:modelsdev-cache") ?? "{}");
    const entry = stored.data.openrouter.models["z-ai/glm-5.3-flash"];
    expect(Object.keys(entry).sort()).toEqual(["cost", "id", "limit", "modalities", "name"]);
  });

  it("re-slims a fat cache written before slimming existed", async () => {
    storage.set(
      "chatui:modelsdev-cache",
      JSON.stringify({ data: FAT_CATALOG, ts: Date.now() }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("must not fetch");
      }),
    );
    const mod = await load();
    const tokens = await mod.getModelContextWindow(
      provider("custom", "https://my-proxy.internal:8080/v1"),
      "z-ai/glm-5.3-flash",
    );
    expect(tokens).toBe(1310720);
    const stored = JSON.parse(storage.get("chatui:modelsdev-cache") ?? "{}");
    const entry = stored.data.openrouter.models["z-ai/glm-5.3-flash"];
    expect(Object.keys(entry).sort()).toEqual(["cost", "id", "limit", "modalities", "name"]);
  });
});

describe("model costs", () => {
  const usage = { inputTokens: 100_000, cachedTokens: 80_000, outputTokens: 1_431 };

  it("prices fresh input, cache reads, and output separately", async () => {
    const mod = await load();
    // (20k × 0.15 + 80k × 0.03 + 1431 × 0.5) / 1M = 0.0061155
    expect(
      mod.priceUsage(usage, { input: 0.15, output: 0.5, cacheRead: 0.03 }),
    ).toBeCloseTo(0.0061155, 10);
  });

  it("falls back to the input price when cache_read is unlisted", async () => {
    const mod = await load();
    // (20k × 0.15 + 80k × 0.15 + 1431 × 0.5) / 1M = 0.0157155
    expect(
      mod.priceUsage(usage, { input: 0.15, output: 0.5, cacheRead: 0.15 }),
    ).toBeCloseTo(0.0157155, 10);
  });

  it("prices nothing without catalog prices", async () => {
    const mod = await load();
    expect(mod.priceUsage(usage, null)).toBe(0);
  });

  it("resolves scoped prices, null when the catalog knows none", async () => {
    const mod = await load();
    const scoped = await mod.getModelCost(
      provider("fw", "https://api.fireworks.ai/inference/v1"),
      "accounts/fireworks/models/glm-5p3-flash",
    );
    expect(scoped).toEqual({ input: 0.15, output: 0.5, cacheRead: 0.03 });
    // The openrouter entry carries limits but no cost.
    const missing = await mod.getModelCost(
      provider("custom", "https://my-proxy.internal:8080/v1"),
      "z-ai/glm-5.3-flash",
    );
    expect(missing).toBeNull();
  });
});

describe("catalog names", () => {
  it("returns the catalog display name for a known model", async () => {
    const mod = await load();
    storage.set(
      "chatui:modelsdev-cache",
      JSON.stringify({ data: FAKE_CATALOG, ts: Date.now() }),
    );
    expect(
      mod.getModelDisplayNameSync(
        provider("fw", "https://api.fireworks.ai/inference/v1"),
        "accounts/fireworks/models/glm-5p3-flash",
      ),
    ).toBe("GLM 5.3 Flash");
    expect(
      mod.getModelDisplayNameSync(
        provider("custom", "https://my-proxy.internal:8080/v1"),
        "no-such-model-xyz",
      ),
    ).toBeNull();
  });

  it("returns the catalog provider name for a known endpoint", async () => {
    const mod = await load();
    storage.set(
      "chatui:modelsdev-cache",
      JSON.stringify({ data: FAKE_CATALOG, ts: Date.now() }),
    );
    expect(mod.getProviderCatalogName("https://api.fireworks.ai/inference/v1")).toBe(
      "Fireworks AI",
    );
    expect(mod.getProviderCatalogName("https://my-proxy.internal:8080/v1")).toBeNull();
  });
});

describe("input modalities", () => {
  it("reports catalog modalities alongside vision", async () => {
    const mod = await load();
    storage.set(
      "chatui:modelsdev-cache",
      JSON.stringify({ data: FAKE_CATALOG, ts: Date.now() }),
    );
    const caps = mod.getModelCapabilitiesSync(
      provider("fw", "https://api.fireworks.ai/inference/v1"),
      "accounts/fireworks/models/glm-5p3-flash",
    );
    expect(caps.vision).toBe(true);
    expect(caps.inputModalities).toEqual(["text", "image"]);
  });

  it("falls back to text-only for unknown models", async () => {
    const mod = await load();
    const caps = mod.getModelCapabilitiesSync(
      provider("custom", "https://my-proxy.internal:8080/v1"),
      "no-such-model-xyz",
    );
    expect(caps.inputModalities).toEqual(["text"]);
  });
});

describe("getModelContextWindowSync", () => {
  it("reads the cached catalog without network", async () => {
    const mod = await load();
    storage.set(
      "chatui:modelsdev-cache",
      JSON.stringify({ data: FAKE_CATALOG, ts: Date.now() }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("must not fetch");
      }),
    );
    const resolved = mod.getModelContextWindowSync(
      provider("custom", "https://my-proxy.internal:8080/v1"),
      "z-ai/glm-5.3-flash",
    );
    expect(resolved).toEqual({ tokens: 1310720, source: "catalog-any" });
  });
});
