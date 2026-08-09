// Local-first embeddings via transformers.js.
// Lazy-loaded so it doesn't bloat the initial bundle. Falls back to a
// lightweight hash embedding if the model can't be loaded (e.g. offline).

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
let pipelinePromise: Promise<any> | null = null;
let useFallback = false;

/** Switch the embedding model at runtime (clears the pipeline cache). */
export function setEmbeddingModel(modelId: string) {
  if (currentModelId === modelId) return;
  currentModelId = modelId;
  pipelinePromise = null;
  useFallback = false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getExtractor(): Promise<any> {
  if (useFallback) throw new Error("fallback mode");
  const modelId = getModelId();
  if (!pipelinePromise) {
    pipelinePromise = import("@huggingface/transformers").then((mod) => {
      mod.env.allowLocalModels = false;
      return mod.pipeline("feature-extraction", modelId);
    }).catch((err) => {
      useFallback = true;
      throw err;
    });
  }
  return pipelinePromise;
}

/** Embed an array of texts. Returns one vector per text (normalized). */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    const extractor = await getExtractor();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (output.tolist() as number[][]);
  } catch {
    return texts.map((t) => hashEmbed(t));
  }
}

/** Embed a single query string. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec ?? hashEmbed(text);
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
