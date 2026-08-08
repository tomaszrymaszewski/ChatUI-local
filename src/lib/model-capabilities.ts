import type { Provider } from "@/types";

const CACHE_KEY = "chatui:modelsdev-cache";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const OVERRIDE_KEY = "chatui:vision-overrides";

interface ModelsDevModel {
  id?: string;
  name?: string;
  modalities?: { input?: string[]; output?: string[] };
}

type ModelsDevCatalog = Record<string, {
  id?: string;
  name?: string;
  models?: Record<string, ModelsDevModel>;
}>;

let catalogPromise: Promise<ModelsDevCatalog | null> | null = null;

function loadCached(): { data: ModelsDevCatalog; ts: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed.ts ?? 0) > CACHE_TTL) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCached(data: ModelsDevCatalog) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full or unavailable — skip caching
  }
}

export async function getModelsDevCatalog(): Promise<ModelsDevCatalog | null> {
  const cached = loadCached();
  if (cached) return cached.data;
  if (!catalogPromise) {
    catalogPromise = fetch("https://models.dev/api.json")
      .then((r) => r.json() as Promise<ModelsDevCatalog>)
      .then((data) => {
        saveCached(data);
        return data;
      })
      .catch(() => null);
  }
  return catalogPromise;
}

/** Map a provider baseUrl to the models.dev provider key. */
function providerKeyForBaseUrl(baseUrl: string): string | null {
  const u = baseUrl.toLowerCase();
  if (u.includes("fireworks.ai")) return "fireworks";
  if (u.includes("openai.com")) return "openai";
  if (u.includes("anthropic.com")) return "anthropic";
  if (u.includes("generativelanguage.googleapis.com") || u.includes("google")) return "google";
  if (u.includes("deepinfra.com")) return "deepinfra";
  if (u.includes("groq.com")) return "groq";
  if (u.includes("mistral.ai")) return "mistral";
  if (u.includes("localhost:11434") || u.includes("ollama")) return "ollama";
  if (u.includes("x.ai")) return "xai";
  if (u.includes("deepseek.com")) return "deepseek";
  return null;
}

const VISION_KEYWORDS = [
  "vision", "gpt-4o", "gpt-4.1", "gpt-4.5", "gpt-5", "claude-3", "claude-4",
  "sonnet", "opus", "haiku", "gemini", "llava", "qwen-vl", "qwen2-vl",
  "cogvlm", "pixtral", "phi-3.5-vision", "phi-4", "llama-3.2-90b", "llama-3.2-11b",
  "mistral-small-3", "internvl", "minicpm", "gemma-3", "moondream",
];

function heuristicVision(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return VISION_KEYWORDS.some((k) => lower.includes(k));
}

function loadOverrides(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function setVisionOverride(providerId: string, modelName: string, value: boolean | undefined) {
  const overrides = loadOverrides();
  const key = `${providerId}:${modelName}`;
  if (value === undefined) delete overrides[key];
  else overrides[key] = value;
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides));
}

export function getVisionOverride(providerId: string, modelName: string): boolean | undefined {
  return loadOverrides()[`${providerId}:${modelName}`];
}

export interface ModelCapabilities {
  vision: boolean;
  source: "override" | "catalog" | "heuristic";
}

/** Determine if a model supports image input. */
export async function getModelCapabilities(
  provider: Provider,
  modelName: string,
): Promise<ModelCapabilities> {
  const override = getVisionOverride(provider.id, modelName);
  if (override !== undefined) {
    return { vision: override, source: "override" };
  }

  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  if (providerKey) {
    const catalog = await getModelsDevCatalog();
    if (catalog && catalog[providerKey]?.models) {
      const models = catalog[providerKey].models!;
      // Match by key, id, or name
      const entry =
        models[modelName] ??
        Object.values(models).find(
          (m) => m.id === modelName || m.name?.toLowerCase() === modelName.toLowerCase(),
        );
      if (entry?.modalities?.input) {
        return {
          vision: entry.modalities.input.includes("image"),
          source: "catalog",
        };
      }
    }
  }

  return { vision: heuristicVision(modelName), source: "heuristic" };
}

/** Synchronous best-effort check (uses cached catalog if available, else heuristic). */
export function getModelCapabilitiesSync(provider: Provider, modelName: string): ModelCapabilities {
  const override = getVisionOverride(provider.id, modelName);
  if (override !== undefined) {
    return { vision: override, source: "override" };
  }
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  if (providerKey) {
    const cached = loadCached();
    if (cached?.data?.[providerKey]?.models) {
      const models = cached.data[providerKey].models!;
      const entry =
        models[modelName] ??
        Object.values(models).find(
          (m) => m.id === modelName || m.name?.toLowerCase() === modelName.toLowerCase(),
        );
      if (entry?.modalities?.input) {
        return { vision: entry.modalities.input.includes("image"), source: "catalog" };
      }
    }
  }
  return { vision: heuristicVision(modelName), source: "heuristic" };
}
