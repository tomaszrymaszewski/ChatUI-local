// Local-first embeddings via transformers.js (all-MiniLM-L6-v2, 384 dims).
// Lazy-loaded so it doesn't bloat the initial bundle. Falls back to a
// lightweight hash embedding if the model can't be loaded (e.g. offline).

const DIMS = 384;
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelinePromise: Promise<any> | null = null;
let useFallback = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getExtractor(): Promise<any> {
  if (useFallback) throw new Error("fallback mode");
  if (!pipelinePromise) {
    pipelinePromise = import("@huggingface/transformers").then((mod) => {
      // Configure to allow remote model download from HF CDN
      mod.env.allowLocalModels = false;
      return mod.pipeline("feature-extraction", MODEL_ID);
    }).catch((err) => {
      useFallback = true;
      throw err;
    });
  }
  return pipelinePromise;
}

/** Embed an array of texts. Returns one vector per text (384 dims, normalized). */
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
  const vec = new Array(DIMS).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter((t) => t.length > 1);
  for (const tok of tokens) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0;
    vec[Math.abs(h) % DIMS] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
