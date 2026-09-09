// Local-first embeddings via transformers.js. Inference runs in a dedicated
// Web Worker (embeddings-worker.ts) so knowledge-index sweeps never block
// the main thread. Falls back to a lightweight hash embedding when the
// worker or the model can't be loaded (e.g. offline, or non-worker runtimes).

export interface EmbeddingModelOption {
  id: string;
  label: string;
  dims: number;
  size: string;
}

export const EMBEDDING_MODELS: EmbeddingModelOption[] = [
  { id: "Xenova/all-MiniLM-L6-v2", label: "MiniLM-L6 (fast, 22 MB)", dims: 384, size: "22 MB" },
  { id: "Xenova/all-MiniLM-L12-v2", label: "MiniLM-L12 (balanced, 44 MB)", dims: 384, size: "44 MB" },
  { id: "Xenova/bge-small-en-v1.5", label: "BGE Small (quality, 33 MB)", dims: 384, size: "33 MB" },
  { id: "Xenova/bge-base-en-v1.5", label: "BGE Base (high quality, 110 MB)", dims: 768, size: "110 MB" },
  { id: "Xenova/gte-small", label: "GTE Small (general, 33 MB)", dims: 384, size: "33 MB" },
];

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
/** Preselected as "Recommended" during onboarding (see onboarding wizard). */
export const RECOMMENDED_EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
const MODEL_DIMS: Record<string, number> = Object.fromEntries(
  EMBEDDING_MODELS.map((m) => [m.id, m.dims]),
);

let currentModelId: string | null = null;
const SETTINGS_KEY = "chatui:settings";

function getModelId(): string {
  if (currentModelId) return currentModelId;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { embeddingModel?: string };
      if (data.embeddingModel && MODEL_DIMS[data.embeddingModel]) {
        currentModelId = data.embeddingModel;
        return currentModelId;
      }
    }
  } catch {
    // ignore
  }
  currentModelId = DEFAULT_MODEL;
  return currentModelId;
}

function getDims(): number {
  return MODEL_DIMS[getModelId()] ?? 384;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcPending = {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  onProgress?: (info: EmbeddingProgressInfo) => void;
};

const pendingRpc = new Map<string, RpcPending>();
let rpcSeq = 0;
let worker: Worker | null = null;
let workerBroken = false;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./embeddings-worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as
      | { kind: "embed" | "preload"; id: string; vectors?: number[][]; error?: string }
      | { kind: "progress"; id: string; info: EmbeddingProgressInfo };
    const pending = pendingRpc.get(data?.id);
    if (!pending) return;
    if (data.kind === "progress") {
      pending.onProgress?.(data.info);
      return;
    }
    pendingRpc.delete(data.id);
    if (data.error !== undefined) pending.reject(new Error(data.error));
    else pending.resolve(data.vectors ?? null);
  });
  worker.addEventListener("error", () => {
    workerBroken = true;
    for (const [, pending] of pendingRpc) pending.reject(new Error("embeddings worker failed"));
    pendingRpc.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

function embedRpc(modelId: string, texts: string[]): Promise<number[][] | null> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("embeddings worker unavailable"));
  return new Promise((resolve, reject) => {
    const id = `rpc-${++rpcSeq}`;
    pendingRpc.set(id, { resolve, reject });
    w.postMessage({ kind: "embed", id, modelId, texts });
  });
}

function preloadRpc(
  modelId: string,
  onProgress?: (info: EmbeddingProgressInfo) => void,
): Promise<void> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("embeddings worker unavailable"));
  return new Promise((resolve, reject) => {
    const id = `rpc-${++rpcSeq}`;
    pendingRpc.set(id, { resolve, reject, onProgress });
    w.postMessage({ kind: "preload", id, modelId });
  });
}

/** Switch the embedding model at runtime (the worker caches per model id). */
export function setEmbeddingModel(modelId: string) {
  if (currentModelId === modelId) return;
  currentModelId = modelId;
}

/** Embed an array of texts. Returns one vector per text (normalized). */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    const vectors = await embedRpc(getModelId(), texts);
    if (vectors && vectors.length === texts.length) return vectors;
    throw new Error("embeddings worker returned a malformed response");
  } catch {
    return texts.map((t) => hashEmbed(t));
  }
}

/** Embed a single query string. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec ?? hashEmbed(text);
}

export interface EmbeddingProgressInfo {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

/**
 * Eagerly download + warm up an embedding model in the worker (used right
 * after the onboarding step so the first file attachment doesn't pay the
 * download cost). Reports per-file download progress; throws on failure (the
 * caller can fall back to the lazy first-use download).
 */
export async function preloadEmbeddingModel(
  modelId: string,
  onProgress?: (info: EmbeddingProgressInfo) => void,
): Promise<void> {
  await preloadRpc(modelId, onProgress);
  currentModelId = modelId;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Lightweight fallback embedding: hashed bag-of-words (always works offline). */
function hashEmbed(text: string): number[] {
  const dims = getDims();
  const vec = new Array(dims).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter((t) => t.length > 1);
  for (const tok of tokens) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0;
    vec[Math.abs(h) % dims] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// ─── Knowledge-index embedder (hybrid) ─────────────────────────────────────

export interface ApiEmbeddingConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/**
 * The embedder used for the knowledge index — one identity for both indexing
 * and queries. Mixing identities would silently corrupt nearest-neighbor
 * ranking (different vector spaces and dimensions). Configured endpoint wins;
 * otherwise the local transformers.js model above.
 */
export type IndexEmbedder =
  | { kind: "api"; id: string; baseUrl: string; model: string; apiKey?: string }
  | { kind: "local"; id: string; modelId: string; dims: number };

export function getIndexEmbedder(): IndexEmbedder {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { embeddingEndpoint?: ApiEmbeddingConfig | null };
      const ep = data.embeddingEndpoint;
      if (ep && ep.baseUrl && ep.model) {
        return {
          kind: "api",
          id: `api:${ep.baseUrl}#${ep.model}`,
          baseUrl: ep.baseUrl.replace(/\/+$/, ""),
          model: ep.model,
          apiKey: ep.apiKey,
        };
      }
    }
  } catch {
    // ignore
  }
  const modelId = getModelId();
  return { kind: "local", id: `local:${modelId}`, modelId, dims: MODEL_DIMS[modelId] ?? 384 };
}

/**
 * Same header hygiene as corsSafeFetch in src/lib/agent/models.ts (X-Stainless-*
 * and User-Agent break CORS preflights in WKWebView) — duplicated locally so
 * the embedding path doesn't pull the langchain stack into its bundle.
 */
async function embeddingsEndpointFetch(
  baseUrl: string,
  apiKey: string | undefined,
  body: string,
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  return fetch(`${baseUrl}/embeddings`, { method: "POST", headers, body });
}

/**
 * Embed texts with the index embedder. Throws on endpoint failure — the index
 * layer decides to skip (query time) or abort the sweep (index time). It never
 * silently falls back to a different model, which would corrupt the index
 * (mixed vector spaces can't be ranked against each other).
 */
export async function embedForIndex(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embedder = getIndexEmbedder();
  if (embedder.kind === "local") return embed(texts);
  const out: number[][] = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const resp = await embeddingsEndpointFetch(
      embedder.baseUrl,
      embedder.apiKey,
      JSON.stringify({ model: embedder.model, input: batch }),
    );
    if (!resp.ok) throw new Error(`embeddings endpoint returned ${resp.status}`);
    const json = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
    const data = json.data ?? [];
    if (data.length !== batch.length) {
      throw new Error("embeddings endpoint returned a malformed response");
    }
    for (const d of data) {
      const vec = d.embedding;
      if (!Array.isArray(vec) || vec.length === 0) {
        throw new Error("embeddings endpoint returned a malformed response");
      }
      out.push(vec);
    }
  }
  return out;
}

/** Embed one query with the index embedder (throws on failure). */
export async function embedQueryForIndex(text: string): Promise<number[]> {
  const [vec] = await embedForIndex([text]);
  if (!vec) throw new Error("index embedder returned no vector");
  return vec;
}
