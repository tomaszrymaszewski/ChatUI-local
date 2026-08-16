// Deep Research engine config. One engine, no external search keys — see
// DISCOVERY-2C.md. Research runs on whatever model is currently selected in
// the chat UI, via the app's existing multi-provider completion layer.

// --- Fetch-only expansion ---

/** Cap on how many frontier URLs get fetched per round. */
export const FETCH_ONLY_MAX_FETCHES_PER_ROUND = 5;

/** Fetches within a round happen in mini-batches of this size, checking cancellation between batches (executeWebFetch has no external AbortSignal to cancel an in-flight fetch — see DISCOVERY-2C.md). */
export const FETCH_ONLY_FETCH_CONCURRENCY = 2;

/** Per-page content cap before injecting into the extraction prompt. */
export const FETCH_ONLY_MAX_CONTENT_CHARS = 4000;

/** Bare-topic runs (no doc/URLs attached) bootstrap starting URLs via keylessWebSearch — this many. */
export const KEYLESS_SEARCH_MAX_RESULTS = 5;

export const REPORT_SECTIONS = [
  "Snapshot",
  "Programs & Activities",
  "Geographic Reach & Beneficiaries",
  "Funding Model",
  "Leadership & Governance",
  "Partnerships & Coalitions",
  "Communications & Digital Presence",
  "Impact Claims vs Evidence",
] as const;
