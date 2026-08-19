// Deep Research engine config. One engine, no external search keys — see
// DISCOVERY-2C.md. Research runs on whatever model is currently selected in
// the chat UI, via the app's existing multi-provider completion layer.

// --- Recursion bounds (ported from dzhng/deep-research's breadth/depth) ---

/** Breadth: max distinct queries searched per research round. */
export const DEFAULT_RESEARCH_BREADTH = 4;

/** Depth: max recursive research rounds (each round informed by all prior learnings). */
export const DEFAULT_RESEARCH_DEPTH = 3;

// --- Search-driven rounds ---

/** Per-query cap on keyless (DuckDuckGo HTML) search results considered. */
export const KEYLESS_SEARCH_MAX_RESULTS = 5;

/** Cap on how many pages get fetched per round. */
export const FETCH_ONLY_MAX_FETCHES_PER_ROUND = 5;

/** Fetches within a round happen in mini-batches of this size, checking cancellation between batches (executeWebFetch has no external AbortSignal to cancel an in-flight fetch — see DISCOVERY-2C.md). */
export const FETCH_ONLY_FETCH_CONCURRENCY = 2;

/** Per-page content cap before injecting into the extraction prompt. */
export const FETCH_ONLY_MAX_CONTENT_CHARS = 4000;
