import type { SourceId } from "../loop/actions";

export interface SourceRecord {
  /** normalizeUrl(url) — kept for cache-key consistency with the loop's own urlCache; the port
   *  itself never dedups (dispatchTool already skips calling the port on a cache hit). */
  readonly url: string;
  /** The FULL, untruncated extracted text. dispatchTool truncates Source.body to maxPageTokens
   *  when it builds the loop's own Source record — but search_in_page exists specifically to
   *  search *beyond* that truncation, so this map must hold the untruncated text. */
  readonly body: string;
}

export interface FsToolPortState {
  readonly bodies: Map<SourceId, SourceRecord>;
  /** Starts at 1; mirrors dispatchTool's `S${state.sources.length + 1}` id assignment
   *  (researchLoop.ts) so a body stored here lands under the exact SourceId the loop will
   *  independently compute for the same successful fetch a moment later. Shared by openUrl AND
   *  readPdf — the loop's sources[] array is one array across both tools. */
  nextOrdinal: number;
}

export function createFsToolPortState(): FsToolPortState {
  return { bodies: new Map(), nextOrdinal: 1 };
}

/**
 * Races an already-started async call against an AbortSignal so the returned promise settles
 * promptly on cancellation. Tauri has no native bridge to actually abort an in-flight
 * spawn_blocking + blocking-reqwest command once it has started — this only makes the
 * JS-visible promise resolve/reject promptly for the loop's own timeout/retry logic to observe;
 * the underlying Rust request may keep running briefly in the background, bounded by its own
 * timeout_ms. A deliberate, disclosed limitation, not an oversight.
 */
export function raceAgainstSignal<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("cancelled"));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    start().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
