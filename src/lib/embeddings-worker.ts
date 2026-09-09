// Embedding inference worker — keeps transformers.js ONNX compute off the
// main thread so knowledge-index sweeps can't freeze the UI. Implements the
// RPC protocol expected by src/lib/embeddings.ts:
//   in:  { kind: "embed", id, modelId, texts }
//   in:  { kind: "preload", id, modelId }
//   out: { kind: "embed", id, vectors } | { kind: "embed", id, error }
//   out: { kind: "progress", id, info } | { kind: "preload", id, error? }

import { env, pipeline } from "@huggingface/transformers";
import type { EmbeddingProgressInfo } from "./embeddings";

env.allowLocalModels = false;

// window.postMessage requires a targetOrigin; the worker scope's does not.
const post = (globalThis as unknown as { postMessage: (message: unknown) => void }).postMessage;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipelines = new Map<string, Promise<any>>();

/** One pipeline per model id; a failed load is dropped so a later call retries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPipeline(
  modelId: string,
  onProgress?: (info: EmbeddingProgressInfo) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  let p = pipelines.get(modelId);
  if (!p) {
    const options: Record<string, unknown> = onProgress
      ? { progress_callback: onProgress }
      : {};
    p = pipeline("feature-extraction", modelId, options);
    p.catch(() => pipelines.delete(modelId));
    pipelines.set(modelId, p);
  }
  return p;
}

type WorkerRequest =
  | { kind: "embed"; id: string; modelId: string; texts: string[] }
  | { kind: "preload"; id: string; modelId: string };

self.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as WorkerRequest | null;
  if (!data || typeof data.id !== "string") return;
  if (data.kind === "embed") {
    getPipeline(data.modelId)
      .then(async (extractor) => {
        const output = await extractor(data.texts, { pooling: "mean", normalize: true });
        post({ kind: "embed", id: data.id, vectors: output.tolist() as number[][] });
      })
      .catch((err: unknown) => {
        post({ kind: "embed", id: data.id, error: String(err instanceof Error ? err.message : err) });
      });
  } else if (data.kind === "preload") {
    const onProgress = (info: EmbeddingProgressInfo) => post({ kind: "progress", id: data.id, info });
    getPipeline(data.modelId, onProgress)
      .then(async (extractor) => {
        await extractor(["warm-up"], { pooling: "mean", normalize: true });
        post({ kind: "preload", id: data.id });
      })
      .catch((err: unknown) => {
        post({ kind: "preload", id: data.id, error: String(err instanceof Error ? err.message : err) });
      });
  }
});
