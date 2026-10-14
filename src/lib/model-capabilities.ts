import type { Provider } from "@/types";
import { getProviderApiKey } from "@/lib/llm";
import { fetchAnthropicModels, isAnthropicProvider, type AnthropicModelInfo } from "@/lib/providers/anthropic";
import { setItemOrThrowFriendly } from "./storage-pressure";

const CACHE_KEY = "chatui:modelsdev-cache";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
/**
 * Cache payload version. Bump when the slim shape gains a field so older
 * caches (which lack it) are refetched instead of silently missing data.
 * v2 added reasoning/reasoning_options.
 */
const CACHE_VERSION = 2;
const OVERRIDE_KEY = "chatui:vision-overrides";

interface ModelsDevModel {
  id?: string;
  name?: string;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  /** List prices in USD per million tokens (models.dev convention). */
  cost?: { input?: number; output?: number; cache_read?: number };
  /** Whether the model can think/reason at all. */
  reasoning?: boolean;
  /** How thinking is controlled: a plain toggle and/or an effort scale. */
  reasoning_options?: unknown;
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
    if (
      parsed.v !== CACHE_VERSION ||
      typeof parsed.ts !== "number" ||
      !parsed.data ||
      typeof parsed.data !== "object"
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCached(data: ModelsDevCatalog) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ v: CACHE_VERSION, data, ts: Date.now() }));
  } catch {
    // localStorage full or unavailable — skip caching
  }
}

/**
 * The lookups only read id/name/modalities/limit/cost/reasoning, but a raw
 * api.json entry carries a dozen more fields (description, …) that bloat the
 * cached payload to ~4.6MB — most of a ~5MB localStorage store. Strip
 * everything unread so the cache stays near ~1MB and leaves room for chats.
 * Returns a slimmed copy; the input is never mutated.
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
        reasoning: m.reasoning,
        reasoning_options: m.reasoning_options,
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
            k !== "cost" &&
            k !== "reasoning" &&
            k !== "reasoning_options",
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
  const fresh = cached && Date.now() - cached.ts <= CACHE_TTL;
  const staleCatalog = cached
    ? isFatCatalog(cached.data)
      ? slimCatalog(cached.data)
      : cached.data
    : null;
  if (cached && staleCatalog && staleCatalog !== cached.data) saveCached(staleCatalog);
  if (cached && fresh) {
    return staleCatalog;
  }
  if (!catalogPromise) {
    catalogPromise = fetch("https://models.dev/api.json")
      .then((r) => {
        if (!r.ok) throw new Error(`models.dev returned ${r.status}`);
        return r.json() as Promise<ModelsDevCatalog>;
      })
      .then((data) => {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("models.dev returned an invalid catalog");
        }
        const slim = slimCatalog(data);
        saveCached(slim);
        return slim;
      })
      .catch(() => staleCatalog)
      .finally(() => {
        catalogPromise = null;
      });
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

/**
 * Provider catalogs often use a canonical model name while their public API
 * uses an alias (Gemini's `-latest`, or dated DeepSeek V4 releases). Keep
 * alias matching deliberately narrow so similarly named model families do
 * not inherit each other's controls.
 */
function canonicalModelName(value: string): string {
  let name = value.trim().toLowerCase().split("/").filter(Boolean).pop() ?? "";
  name = name.replace(/_/g, "-").replace(/-latest$/, "");
  if (name.startsWith("gemini-")) {
    name = name.replace(/^gemini-\d+(?:\.\d+)*-/, "gemini-");
  }
  if (/^deepseek-v4(?:\.\d+)?-/.test(name)) {
    name = name.replace(/-\d{4,8}$/, "");
  }
  return name;
}

function versionOfCatalogModel(key: string, entry: ModelsDevModel): number[] {
  const name = `${entry.id ?? ""} ${key}`.toLowerCase();
  const gemini = name.match(/gemini-(\d+(?:\.\d+)*)-/)?.[1];
  if (gemini) return gemini.split(".").map(Number);
  const deepseekDate = name.match(/^.*deepseek-v4(?:\.\d+)?-.*?-(\d{4,8})(?:\s|$)/)?.[1];
  return deepseekDate ? [Number(deepseekDate)] : [];
}

function compareVersionsDescending(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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
  const canonical = canonicalModelName(modelName);
  if (!canonical) return undefined;
  const matches = Object.entries(models).filter(([key, entry]) =>
    [key, entry.id, entry.name]
      .filter((value): value is string => typeof value === "string")
      .some((value) => canonicalModelName(value) === canonical),
  );
  if (matches.length === 0) return undefined;
  // `latest` aliases should resolve to the newest catalog version within the
  // same family (e.g. Gemini Flash-Lite), while exact IDs above stay exact.
  matches.sort(([keyA, a], [keyB, b]) => {
    const version = compareVersionsDescending(versionOfCatalogModel(keyA, a), versionOfCatalogModel(keyB, b));
    return version || keyA.localeCompare(keyB);
  });
  return matches[0][1];
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

// ─── Reasoning / thinking options ──────────────────────────────────────────

export interface ModelReasoningSupport {
  /** models.dev `reasoning` flag — false means the model can't think. */
  reasoning: boolean;
  /** Effort values the model accepts ("none", "low", "high", "xhigh", "max", …). */
  efforts: string[];
  /** A plain on/off toggle is supported (models.dev type "toggle"). */
  toggle: boolean;
  /** A budget_tokens control exists, even if the catalog omits safe bounds. */
  budgetTokens?: true;
  /** Inclusive token-budget bounds from models.dev type "budget_tokens". */
  thinkingBudget?: { min: number; max: number };
}

const ANTHROPIC_MODEL_CACHE_TTL = 24 * 60 * 60 * 1000;
const anthropicCatalogRequests = new Map<string, Promise<AnthropicModelInfo[] | null>>();

function anthropicCacheKey(providerId: string): string {
  return `chatui:anthropic-model-capabilities:${providerId}`;
}

function readAnthropicModelCache(providerId: string): { ts: number; models: AnthropicModelInfo[] } | null {
  try {
    const value = JSON.parse(localStorage.getItem(anthropicCacheKey(providerId)) ?? "null");
    if (typeof value?.ts !== "number" || !Array.isArray(value.models)) return null;
    return value as { ts: number; models: AnthropicModelInfo[] };
  } catch {
    return null;
  }
}

function findAnthropicModel(models: AnthropicModelInfo[], modelName: string): AnthropicModelInfo | undefined {
  const candidates = new Set(modelNameCandidates(modelName).map((candidate) => candidate.toLowerCase()));
  const exact = models.find((model) => candidates.has(model.id.toLowerCase()));
  if (exact) return exact;
  const normalized = (value: string) => value.toLowerCase().replace(/-\d{8}$/, "");
  const target = normalized(modelName.split("/").filter(Boolean).pop() ?? modelName);
  return models.find((model) => {
    const id = normalized(model.id);
    return id === target || id.startsWith(`${target}-`);
  });
}

function anthropicReasoningOf(model: AnthropicModelInfo | undefined): ModelReasoningSupport | null {
  const effortCapabilities = model?.capabilities?.effort;
  if (!effortCapabilities) return null;
  const efforts = ["low", "medium", "high", "xhigh", "max"].filter(
    (effort) => effortCapabilities[effort]?.supported === true,
  );
  return { reasoning: efforts.length > 0, efforts, toggle: false };
}

function cachedAnthropicReasoning(providerId: string, modelName: string): ModelReasoningSupport | null {
  const cached = readAnthropicModelCache(providerId);
  return cached ? anthropicReasoningOf(findAnthropicModel(cached.models, modelName)) : null;
}

async function loadAnthropicModels(provider: Provider): Promise<AnthropicModelInfo[] | null> {
  const cached = readAnthropicModelCache(provider.id);
  if (cached && Date.now() - cached.ts <= ANTHROPIC_MODEL_CACHE_TTL) return cached.models;
  const pending = anthropicCatalogRequests.get(provider.id);
  if (pending) return pending;

  const request = (async () => {
    try {
      const apiKey = await getProviderApiKey(provider.id);
      const models = await fetchAnthropicModels(apiKey, provider.baseUrl);
      try {
        localStorage.setItem(anthropicCacheKey(provider.id), JSON.stringify({ ts: Date.now(), models }));
      } catch {
        // Keep the in-memory result when local storage is full or unavailable.
      }
      return models;
    } catch {
      return cached?.models ?? null;
    } finally {
      anthropicCatalogRequests.delete(provider.id);
    }
  })();
  anthropicCatalogRequests.set(provider.id, request);
  return request;
}

async function getAnthropicReasoning(
  provider: Provider,
  modelName: string,
): Promise<ModelReasoningSupport | null> {
  const models = await loadAnthropicModels(provider);
  return models ? anthropicReasoningOf(findAnthropicModel(models, modelName)) : null;
}

/** API dialect used when a provider exposes a separate reasoning on/off toggle. */
export type ReasoningToggleProtocol = "deepseek" | "openrouter" | "google" | "openai-compatible";

export function reasoningToggleProtocolForBaseUrl(
  baseUrl: string,
  modelName = "",
): ReasoningToggleProtocol | null {
  const providerKey = providerKeyForBaseUrl(baseUrl);
  if (providerKey === "deepseek") return "deepseek";
  if (providerKey === "openrouter") return "openrouter";
  if (providerKey === "google") return "google";
  if (providerKey === "deepinfra" || providerKey === "fireworks-ai") {
    // Both hosts serve DeepSeek V4's OpenAI-compatible `thinking` toggle for
    // the same model family; their other models use reasoning_effort=none
    // when the host catalog advertises a toggle.
    return /deepseek-v4/i.test(modelName) ? "deepseek" : "openai-compatible";
  }
  return null;
}

/** Canonical ordering of models.dev effort values; unknown values sort last. */
const REASONING_RANK: Record<string, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
};

export function reasoningEffortRank(effort: string): number {
  return REASONING_RANK[effort] ?? 99;
}

function reasoningOf(entry: ModelsDevModel | undefined): ModelReasoningSupport | null {
  if (!entry) return null;
  const rawOptions = entry.reasoning_options;
  if (entry.reasoning === undefined && rawOptions === undefined) return null;
  const options = Array.isArray(rawOptions) ? rawOptions : [];
  const objectOptions =
    rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions)
      ? rawOptions as Record<string, unknown>
      : null;
  const effortValues = [
    ...options
      .filter((o): o is { type?: string; values?: unknown[] } => !!o && typeof o === "object")
      .filter((o) => o.type === "effort")
      .flatMap((o) => Array.isArray(o.values) ? o.values : []),
    ...(Array.isArray(objectOptions?.effort) ? objectOptions.effort : []),
    ...(objectOptions?.type === "effort" && Array.isArray(objectOptions.values)
      ? objectOptions.values
      : []),
  ];
  const efforts = [...new Set(
    effortValues.filter((v): v is string => typeof v === "string" && v.length > 0),
  )];
  const budgetOption = [
    ...options.filter((o) => !!o && typeof o === "object" && (o as { type?: unknown }).type === "budget_tokens"),
    ...(objectOptions?.type === "budget_tokens" ? [objectOptions] : []),
  ][0] as { min?: unknown; max?: unknown } | undefined;
  const budgetMin = typeof budgetOption?.min === "number" ? budgetOption.min : undefined;
  const budgetMax = typeof budgetOption?.max === "number" ? budgetOption.max : undefined;
  const thinkingBudget =
    budgetMin !== undefined && budgetMax !== undefined && budgetMax > budgetMin
      ? { min: budgetMin, max: budgetMax }
      : undefined;
  const hasBudgetTokens = budgetOption !== undefined;
  const toggle =
    options.some((o) => !!o && typeof o === "object" && (o as { type?: unknown }).type === "toggle") ||
    objectOptions?.toggle === true;
  return {
    reasoning: entry.reasoning === false
      ? false
      : entry.reasoning === true || efforts.length > 0 || toggle || hasBudgetTokens,
    efforts,
    toggle,
    ...(hasBudgetTokens ? { budgetTokens: true as const } : {}),
    thinkingBudget,
  };
}

function findReasoning(
  catalog: ModelsDevCatalog,
  providerKey: string | null,
  modelName: string,
): ModelReasoningSupport | null {
  let scopedWithoutControls: ModelReasoningSupport | null = null;
  if (providerKey) {
    const scopedEntry = findModelEntry(catalog[providerKey]?.models ?? {}, modelName);
    const scoped = reasoningOf(scopedEntry);
    if (scoped && (!scoped.reasoning || scoped.efforts.length > 0 || scoped.toggle || scoped.thinkingBudget)) {
      return scoped;
    }
    scopedWithoutControls = scoped;
    // A host entry can say a model reasons but omit its controls. In that case
    // keep searching for the same model's actual effort list; explicit
    // reasoning=false above remains authoritative.
  }
  let catalogWithoutControls: ModelReasoningSupport | null = null;
  for (const provider of Object.values(catalog)) {
    const anywhere = reasoningOf(findModelEntry(provider?.models ?? {}, modelName));
    if (!anywhere?.reasoning) continue;
    if (anywhere.efforts.length > 0 || anywhere.toggle || anywhere.thinkingBudget) {
      return anywhere;
    }
    catalogWithoutControls ??= anywhere;
  }
  return scopedWithoutControls ?? catalogWithoutControls;
}

/**
 * Small, documented fallbacks for the three providers' onboarding models.
 * models.dev remains the live source of truth; these keep the first-run
 * controls available if its catalog is offline or omits a provider alias.
 */
const DEFAULT_REASONING_FALLBACKS: Record<string, Array<{
  model: string;
  support: ModelReasoningSupport;
}>> = {
  "fireworks-ai": [{
    model: "accounts/fireworks/models/deepseek-v4-flash-0731",
    support: { reasoning: true, efforts: ["low", "high", "max"], toggle: true },
  }],
  deepinfra: [{
    model: "deepseek-ai/DeepSeek-V4-Flash",
    support: { reasoning: true, efforts: ["low", "high", "max"], toggle: true },
  }],
  google: [{
    model: "gemini-flash-lite-latest",
    support: { reasoning: true, efforts: ["minimal", "low", "medium", "high"], toggle: false },
  }],
};

function findReasoningFallback(
  providerKey: string | null,
  modelName: string,
): ModelReasoningSupport | null {
  if (!providerKey) return null;
  const candidates = new Set(modelNameCandidates(modelName).map((candidate) => candidate.toLowerCase()));
  const match = DEFAULT_REASONING_FALLBACKS[providerKey]?.find((fallback) =>
    [...modelNameCandidates(fallback.model)].some((candidate) => candidates.has(candidate.toLowerCase())),
  );
  return match?.support ?? null;
}

/** Thinking support from the selected provider's entry (custom endpoints use a catalog-wide match). */
export async function getModelReasoning(
  provider: Provider,
  modelName: string,
): Promise<ModelReasoningSupport | null> {
  if (isAnthropicProvider(provider.baseUrl)) {
    const native = await getAnthropicReasoning(provider, modelName);
    if (native) return native;
  }
  const catalog = await getModelsDevCatalog();
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  const discovered = catalog ? findReasoning(catalog, providerKey, modelName) : null;
  const fallback = findReasoningFallback(providerKey, modelName);
  if (
    discovered &&
    (!discovered.reasoning || discovered.efforts.length > 0 || discovered.toggle || discovered.thinkingBudget)
  ) {
    return discovered;
  }
  return fallback ?? discovered;
}

/** Synchronous best-effort reasoning support (cached catalog only). */
export function getModelReasoningSync(
  provider: Provider,
  modelName: string,
): ModelReasoningSupport | null {
  if (isAnthropicProvider(provider.baseUrl)) {
    const native = cachedAnthropicReasoning(provider.id, modelName);
    if (native) return native;
  }
  const cached = loadCached();
  const providerKey = providerKeyForBaseUrl(provider.baseUrl);
  const discovered = cached ? findReasoning(cached.data, providerKey, modelName) : null;
  const fallback = findReasoningFallback(providerKey, modelName);
  if (
    discovered &&
    (!discovered.reasoning || discovered.efforts.length > 0 || discovered.toggle || discovered.thinkingBudget)
  ) {
    return discovered;
  }
  return fallback ?? discovered;
}

/**
 * True when the catalog confirms the model accepts this value. Unknown support
 * stays unavailable instead of guessing at a provider's accepted values.
 */
export function isReasoningEffortSupported(
  support: ModelReasoningSupport | null,
  effort: string,
): boolean {
  if (effort === "default") return true;
  if (!support || !support.reasoning) return false;
  if (support.efforts.includes(effort)) return true;
  const budget = effort.match(/^budget:(\d+)$/);
  if (budget && support.thinkingBudget) {
    const tokens = Number(budget[1]);
    return tokens >= support.thinkingBudget.min && tokens <= support.thinkingBudget.max;
  }
  return effort === "none" && support.toggle;
}

/**
 * Clamp a requested effort to what the model actually accepts:
 * - "default"/unset → undefined (send nothing, provider default)
 * - unknown/unsupported model → undefined (use provider default)
 * - valid value → verbatim
 * - invalid value → nearest valid value by rank (ties prefer deeper thinking)
 * - no effort scale (toggle-only / always-on) → undefined for non-"none"
 */
export function sanitizeReasoningEffort(
  effort: string | undefined,
  support: ModelReasoningSupport | null,
): string | undefined {
  if (!effort || effort === "default") return undefined;
  if (!support || !support.reasoning) return undefined;
  const budget = effort.match(/^budget:(\d+)$/);
  if (budget && support.thinkingBudget) {
    const tokens = Number(budget[1]);
    const clamped = Math.max(
      support.thinkingBudget.min,
      Math.min(support.thinkingBudget.max, tokens),
    );
    return `budget:${clamped}`;
  }
  if (support.efforts.includes(effort)) return effort;
  if (effort === "none" && support.toggle) return "none";
  if (support.efforts.length === 0) return undefined;
  const target = reasoningEffortRank(effort);
  let best = support.efforts[0];
  for (const candidate of support.efforts) {
    const dist = Math.abs(reasoningEffortRank(candidate) - target);
    const bestDist = Math.abs(reasoningEffortRank(best) - target);
    if (dist < bestDist || (dist === bestDist && reasoningEffortRank(candidate) > reasoningEffortRank(best))) {
      best = candidate;
    }
  }
  return best;
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
