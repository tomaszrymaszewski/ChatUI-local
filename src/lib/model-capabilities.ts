import type { Provider } from "@/types";
import { setItemOrThrowFriendly } from "./storage-pressure";

const CACHE_KEY = "chatui:modelsdev-cache";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const OVERRIDE_KEY = "chatui:vision-overrides";

interface ModelsDevModel {
  id?: string;
  name?: string;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  /** List prices in USD per million tokens (models.dev convention). */
  cost?: { input?: number; output?: number; cache_read?: number };
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

/**
 * The lookups only read id/name/modalities/limit/cost, but a raw api.json
 * entry carries a dozen more fields (description, reasoning_options, …) that
 * bloat the cached payload to ~4.6MB — most of a ~5MB localStorage store.
 * Strip everything unread so the cache stays near ~1MB and leaves room for
 * chats. Returns a slimmed copy; the input is never mutated.
 */
function slimCatalog(data: ModelsDevCatalog): ModelsDevCatalog {
  const out: ModelsDevCatalog = {};
  for (const [providerKey, provider] of Object.entries(data)) {
    const models: Record<string, ModelsDevModel> = {};
    for (const [modelKey, m] of Object.entries(provider?.models ?? {})) {
      models[modelKey] = {
        id: m.id,
        name: m.name,
        modalities: m.modalities,
        limit: m.limit,
        cost: m.cost,
      };
    }
    out[providerKey] = { ...provider, models };
  }
  return out;
}

/** True when any entry carries fields the lookups never read (a pre-slim cache). */
function isFatCatalog(data: ModelsDevCatalog): boolean {
  for (const provider of Object.values(data)) {
    for (const m of Object.values(provider?.models ?? {})) {
      if (
        Object.keys(m).some(
          (k) =>
            k !== "id" &&
            k !== "name" &&
            k !== "modalities" &&
            k !== "limit" &&
            k !== "cost",
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export async function getModelsDevCatalog(): Promise<ModelsDevCatalog | null> {
  const cached = loadCached();
  // Re-slim a fat cache written before slimming existed: this reclaims ~3.5MB
  // on the next lookup instead of waiting out the 24h TTL.
  if (cached) {
    if (!isFatCatalog(cached.data)) return cached.data;
    const slim = slimCatalog(cached.data);
    saveCached(slim);
    return slim;
  }
  if (!catalogPromise) {
    catalogPromise = fetch("https://models.dev/api.json")
      .then((r) => r.json() as Promise<ModelsDevCatalog>)
      .then((data) => {
        const slim = slimCatalog(data);
        saveCached(slim);
        return slim;
      })
      .catch(() => null);
  }
  return catalogPromise;
}

/**
 * Map a provider baseUrl to the models.dev provider key. Keys must match the
 * catalog exactly (e.g. Fireworks is "fireworks-ai", not "fireworks") —
 * otherwise every lookup for that provider silently misses and callers fall
 * back to a small default window. Returns null for custom/unknown endpoints;
 * limit lookups then fall back to a catalog-wide model search.
 */
export function providerKeyForBaseUrl(baseUrl: string): string | null {
  const u = baseUrl.toLowerCase();
  if (u.includes("fireworks.ai")) return "fireworks-ai";
  if (u.includes("openai.com")) return "openai";
  if (u.includes("anthropic.com")) return "anthropic";
  if (u.includes("generativelanguage.googleapis.com") || u.includes("google")) return "google";
  if (u.includes("deepinfra.com")) return "deepinfra";
  if (u.includes("groq.com")) return "groq";
  if (u.includes("mistral.ai")) return "mistral";
  if (u.includes("localhost:11434") || u.includes("ollama")) return "ollama";
  if (u.includes("localhost:1234") || u.includes("lmstudio")) return "lmstudio";
  if (u.includes("x.ai")) return "xai";
  if (u.includes("deepseek.com")) return "deepseek";
  if (u.includes("openrouter.ai")) return "openrouter";
  if (u.includes("api.z.ai") || u.includes("zhipu") || u.includes("bigmodel")) return "zai";
  if (u.includes("together")) return "togetherai";
  if (u.includes("cerebras")) return "cerebras";
  if (u.includes("nebius")) return "nebius";
  if (u.includes("nvidia")) return "nvidia";
  if (u.includes("moonshot")) return "moonshotai";
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
  setItemOrThrowFriendly(OVERRIDE_KEY, JSON.stringify(overrides));
}

export function getVisionOverride(providerId: string, modelName: string): boolean | undefined {
  return loadOverrides()[`${providerId}:${modelName}`];
}

const CONTEXT_OVERRIDE_KEY = "chatui:context-overrides";

function loadContextOverrides(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(CONTEXT_OVERRIDE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Manual context-window override (tokens) for one provider:model pair. */
export function setContextOverride(
  providerId: string,
  modelName: string,
  value: number | undefined,
) {
  const overrides = loadContextOverrides();
  const key = `${providerId}:${modelName}`;
  if (value === undefined) delete overrides[key];
  else overrides[key] = value;
  try {
    localStorage.setItem(CONTEXT_OVERRIDE_KEY, JSON.stringify(overrides));
  } catch {
    // localStorage full or unavailable — override is best-effort
  }
}

export function getContextOverride(providerId: string, modelName: string): number | undefined {
  const value = loadContextOverrides()[`${providerId}:${modelName}`];
  return typeof value === "number" && value > 0 ? value : undefined;
}

/**
 * Candidate spellings of a configured model name for catalog matching.
 * Providers use prefixed ids (e.g. Fireworks serves
 * "accounts/fireworks/models/glm-5p3-flash") while users configure the short
 * form ("glm-5.3-flash"), so match on the raw name, its case-folded form,
 * and its final path segment.
 */
function modelNameCandidates(modelName: string): string[] {
  const out = new Set<string>();
  const trimmed = modelName.trim();
  if (trimmed) out.add(trimmed);
  const lower = trimmed.toLowerCase();
  if (lower) out.add(lower);
  const tail = lower.split("/").filter(Boolean).pop();
  if (tail) out.add(tail);
  return [...out];
}

/** Find a model entry by key, id, or name (case-insensitive, prefix-tolerant). */
function findModelEntry(
  models: Record<string, ModelsDevModel>,
  modelName: string,
): ModelsDevModel | undefined {
  const candidates = new Set(modelNameCandidates(modelName));
  for (const [key, entry] of Object.entries(models)) {
    if (candidates.has(key) || candidates.has(key.toLowerCase())) return entry;
    if (entry.id && candidates.has(entry.id.toLowerCase())) return entry;
    if (entry.name && candidates.has(entry.name.toLowerCase())) return entry;
  }
  return undefined;
}

/**
 * Catalog-wide fallback: context windows belong to the model weights, not
 * the host, so when the provider-scoped lookup misses (unmapped endpoint,
 * prefixed/short name mismatch), any provider serving the same model id
 * gives the right window. Returns the largest context found.
 */
function findContextAnywhere(
  catalog: ModelsDevCatalog,
  modelName: string,
): number | null {
  let best: number | null = null;
  for (const provider of Object.values(catalog)) {
    const models = provider?.models;
    if (!models) continue;
    const entry = findModelEntry(models, modelName);
    const ctx = entry?.limit?.context;
    if (typeof ctx === "number" && ctx > 0 && (best === null || ctx > best)) {
      best = ctx;
    }
  }
  return best;
}

function findOutputAnywhere(
  catalog: ModelsDevCatalog,
  modelName: string,
): number | null {
  let best: number | null = null;
  for (const provider of Object.values(catalog)) {
    const models = provider?.models;
    if (!models) continue;
    const entry = findModelEntry(models, modelName);
    const out = entry?.limit?.output;
    if (typeof out === "number" && out > 0 && (best === null || out > best)) {
      best = out;
    }
  }
  return best;
}

export interface ModelCapabilities {
  vision: boolean;
  source: "override" | "catalog" | "heuristic";
  /** Raw models.dev input modalities (text/image/audio/video/pdf) when known. */
  inputModalities: string[];
}

/** Per-million-token list prices in USD. */
export interface ModelPrices {
  input: number;
  output: number;
  /** Cached-input price; defaults to the input price when unlisted. */
  cacheRead: number;
}

/** Compact list-price line for settings ("$0.15 in / $0.5 out per M"). */
export function formatModelPrices(prices: ModelPrices): string {
  return `$${prices.input} in / $${prices.output} out per M`;
}

/** Session-spend math for one priced usage event. Exported for tests. */
export function priceUsage(
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number },
  prices: ModelPrices | null,
): number {
  if (!prices) return 0;
  const freshInput = Math.max(0, usage.inputTokens - usage.cachedTokens);
  return (
    (freshInput * prices.input +
      usage.cachedTokens * prices.cacheRead +
      usage.outputTokens * prices.output) /
    1_000_000
  );
}

/** Input modalities for a model: this provider's entry first, then any provider. */
function findInputModalities(
  catalog: ModelsDevCatalog,
  providerKey: string | null,
  modelName: string,
): { modalities: string[]; scoped: boolean } | null {
  if (providerKey) {
    const entry = findModelEntry(catalog[providerKey]?.models ?? {}, modelName);
    if (entry?.modalities?.input) {
      return { modalities: entry.modalities.input, scoped: true };
    }
  }
  for (const provider of Object.values(catalog)) {
    const entry = findModelEntry(provider?.models ?? {}, modelName);
    if (entry?.modalities?.input) {
      return { modalities: entry.modalities.input, scoped: false };
    }
  }
  return null;
}

/** Determine if a model supports image input. */
export async function getModelCapabilities(
  provider: Provider,
  modelName: string,
): Promise<ModelCapabilities> {
  const override = getVisionOverride(provider.id, modelName);
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  const catalog = providerKey ? await getModelsDevCatalog() : null;
  const found = catalog ? findInputModalities(catalog, providerKey, modelName) : null;
  const inputModalities = found?.modalities ?? ["text"];
  if (override !== undefined) {
    return { vision: override, source: "override", inputModalities };
  }
  if (found) {
    return {
      vision: found.modalities.includes("image"),
      source: "catalog",
      inputModalities: found.modalities,
    };
  }

  return { vision: heuristicVision(modelName), source: "heuristic", inputModalities: ["text"] };
}

/** Synchronous best-effort check (uses cached catalog if available, else heuristic). */
export function getModelCapabilitiesSync(provider: Provider, modelName: string): ModelCapabilities {
  const override = getVisionOverride(provider.id, modelName);
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  const cached = providerKey ? loadCached() : null;
  const found = cached ? findInputModalities(cached.data, providerKey, modelName) : null;
  const inputModalities = found?.modalities ?? ["text"];
  if (override !== undefined) {
    return { vision: override, source: "override", inputModalities };
  }
  if (found) {
    return {
      vision: found.modalities.includes("image"),
      source: "catalog",
      inputModalities: found.modalities,
    };
  }
  return { vision: heuristicVision(modelName), source: "heuristic", inputModalities: ["text"] };
}

/** Catalog display name for a model ("GLM 5.3 Flash"), any serving provider. */
export function getModelDisplayNameSync(
  provider: Provider,
  modelName: string,
): string | null {
  const cached = loadCached();
  if (!cached) return null;
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  const pick = (models: Record<string, ModelsDevModel>) => {
    const name = findModelEntry(models, modelName)?.name?.trim();
    return name ? name : null;
  };
  if (providerKey) {
    const hit = pick(cached.data[providerKey]?.models ?? {});
    if (hit) return hit;
  }
  for (const p of Object.values(cached.data)) {
    const hit = pick(p?.models ?? {});
    if (hit) return hit;
  }
  return null;
}

/** Catalog provider name ("Fireworks AI") for an endpoint, cached catalog only. */
export function getProviderCatalogName(baseUrl: string): string | null {
  const providerKey = providerKeyForBaseUrl(baseUrl);
  if (!providerKey) return null;
  const name = loadCached()?.data?.[providerKey]?.name?.trim();
  return name ? name : null;
}

function pricesOf(entry: ModelsDevModel | undefined): ModelPrices | null {
  const cost = entry?.cost;
  if (typeof cost?.input !== "number" || typeof cost?.output !== "number") return null;
  return {
    input: cost.input,
    output: cost.output,
    cacheRead: typeof cost.cache_read === "number" ? cost.cache_read : cost.input,
  };
}

/**
 * Per-million-token list prices for a model: this provider's entry first,
 * then the same model id under any other catalog provider. Null when the
 * catalog knows no prices — callers must not fabricate any.
 */
export async function getModelCost(
  provider: Provider,
  modelName: string,
): Promise<ModelPrices | null> {
  const catalog = await getModelsDevCatalog();
  if (!catalog) return null;
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  if (providerKey) {
    const scoped = pricesOf(findModelEntry(catalog[providerKey]?.models ?? {}, modelName));
    if (scoped) return scoped;
  }
  for (const p of Object.values(catalog)) {
    const anywhere = pricesOf(findModelEntry(p?.models ?? {}, modelName));
    if (anywhere) return anywhere;
  }
  return null;
}

/** Synchronous prices (cached catalog + override-free, for settings UI). */
export function getModelCostSync(
  provider: Provider,
  modelName: string,
): ModelPrices | null {
  const cached = loadCached();
  if (!cached) return null;
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  if (providerKey) {
    const scoped = pricesOf(
      findModelEntry(cached.data[providerKey]?.models ?? {}, modelName),
    );
    if (scoped) return scoped;
  }
  for (const p of Object.values(cached.data)) {
    const anywhere = pricesOf(findModelEntry(p?.models ?? {}, modelName));
    if (anywhere) return anywhere;
  }
  return null;
}

export interface ResolvedContextWindow {
  tokens: number;
  /** "override" = user-set, "catalog" = models.dev, "catalog-any" = models.dev under another provider. */
  source: "override" | "catalog" | "catalog-any";
}

/**
 * Best-effort context-window size (tokens): the per-model user override when
 * set, else the models.dev limit for this provider, else the same model id
 * under any other catalog provider (the window belongs to the weights, not
 * the host — this is what makes unmapped endpoints and short/prefixed model
 * names resolve). Returns null when unknown — callers apply their own fallback.
 */
export async function getModelContextWindow(
  provider: Provider,
  modelName: string,
): Promise<number | null> {
  return (await resolveModelContextWindow(provider, modelName))?.tokens ?? null;
}

export async function resolveModelContextWindow(
  provider: Provider,
  modelName: string,
): Promise<ResolvedContextWindow | null> {
  const override = getContextOverride(provider.id, modelName);
  if (override !== undefined) return { tokens: override, source: "override" };
  const catalog = await getModelsDevCatalog();
  if (!catalog) return null;
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  if (providerKey) {
    const entry = findModelEntry(catalog[providerKey]?.models ?? {}, modelName);
    const ctx = entry?.limit?.context;
    if (typeof ctx === "number" && ctx > 0) return { tokens: ctx, source: "catalog" };
  }
  const anywhere = findContextAnywhere(catalog, modelName);
  return anywhere !== null ? { tokens: anywhere, source: "catalog-any" } : null;
}

/** Synchronous best-effort window (cached catalog + override only, for settings UI). */
export function getModelContextWindowSync(
  provider: Provider,
  modelName: string,
): ResolvedContextWindow | null {
  const override = getContextOverride(provider.id, modelName);
  if (override !== undefined) return { tokens: override, source: "override" };
  const cached = loadCached();
  if (!cached) return null;
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  if (providerKey) {
    const entry = findModelEntry(cached.data[providerKey]?.models ?? {}, modelName);
    const ctx = entry?.limit?.context;
    if (typeof ctx === "number" && ctx > 0) return { tokens: ctx, source: "catalog" };
  }
  const anywhere = findContextAnywhere(cached.data, modelName);
  return anywhere !== null ? { tokens: anywhere, source: "catalog-any" } : null;
}

/**
 * Best-effort max output tokens: models.dev limit for this provider, else
 * the same model id under any other catalog provider. Returns null when
 * unknown — callers should apply their own fallback.
 */
export async function getModelOutputLimit(
  provider: Provider,
  modelName: string,
): Promise<number | null> {
  const catalog = await getModelsDevCatalog();
  if (!catalog) return null;
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  if (providerKey) {
    const entry = findModelEntry(catalog[providerKey]?.models ?? {}, modelName);
    const out = entry?.limit?.output;
    if (typeof out === "number" && out > 0) return out;
  }
  return findOutputAnywhere(catalog, modelName);
}
