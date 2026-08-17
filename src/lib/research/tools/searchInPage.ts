import type { ToolPort } from "../loop/researchLoop";
import type { FsToolPortState } from "./shared";

export const CHUNK_SIZE_CHARS = 800;
export const CHUNK_OVERLAP_CHARS = 150;
export const DEFAULT_TOP_N = 5;

export interface Chunk {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export function chunkText(body: string, chunkSize = CHUNK_SIZE_CHARS, overlap = CHUNK_OVERLAP_CHARS): readonly Chunk[] {
  if (body.length === 0) return [];

  const chunks: Chunk[] = [];
  const step = chunkSize - overlap;
  for (let start = 0; start < body.length; start += step) {
    const end = Math.min(start + chunkSize, body.length);
    chunks.push({ text: body.slice(start, end), start, end });
    if (end === body.length) break;
  }
  return chunks;
}

export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// "BM25-lite": term-frequency match count, length-normalized (log-dampened, borrowed from
// BM25's length-norm term) — no IDF, since this scores chunks of a single document, not a
// corpus. No dependency; deliberately simple.
export function scoreChunk(chunk: Chunk, queryTokens: readonly string[]): number {
  const chunkTokens = tokenize(chunk.text);
  const freq = new Map<string, number>();
  for (const t of chunkTokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  let matches = 0;
  for (const qt of queryTokens) matches += freq.get(qt) ?? 0;

  return matches / Math.log2(chunkTokens.length + 2);
}

export interface RankedSnippet {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly score: number;
}

export function rankChunks(body: string, query: string, topN = DEFAULT_TOP_N): readonly RankedSnippet[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  return chunkText(body)
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// topN × ~950 chars stays well under the loop's MAX_OBSERVATION_CHARS (2000) truncation in
// buildTurnContext, so no extra capping is needed here.
export function rankSnippets(body: string, query: string, topN = DEFAULT_TOP_N): readonly string[] {
  return rankChunks(body, query, topN).map((c) => `[chars ${c.start}-${c.end}] ${c.text.trim()}`);
}

export function createSearchInPage(state: FsToolPortState): ToolPort["searchInPage"] {
  return async (sourceId, query, signal) => {
    if (signal.aborted) throw new Error("cancelled");

    const entry = state.bodies.get(sourceId);
    if (!entry) {
      throw new Error(`search_in_page: unknown source id "${sourceId}" (no fetched body on file for it)`);
    }

    return rankSnippets(entry.body, query);
  };
}
