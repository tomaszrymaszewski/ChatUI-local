// Deep Research engine config. Deliberately decoupled from the chat model
// selector (a user could have a non-Claude or local model selected there,
// which can't run web_search) — see DISCOVERY.md gate resolution #3.

/** Anthropic model ID used for every Deep Research call (planner, round, synthesis). */
export const RESEARCH_MODEL = "claude-sonnet-5";

/** Web search server tool version — see Anthropic docs for newer versions. */
export const WEB_SEARCH_TOOL_TYPE = "web_search_20250305";

/** Per-round cap on how many searches Claude may run — raised for thoroughness. */
export const WEB_SEARCH_MAX_USES_PER_ROUND = 10;

export const RESEARCH_ANTHROPIC_VERSION = "2023-06-01";

/** Max tokens for the planner's JSON response. */
export const PLANNER_MAX_TOKENS = 2048;

/** Max tokens for a research round's JSON response (findings can be long). */
export const RESEARCH_ROUND_MAX_TOKENS = 8192;

/** Max tokens for the final synthesized markdown report. */
export const SYNTHESIS_MAX_TOKENS = 8192;

/** Cap on pause_turn continuations for a single research round (very long search sessions). */
export const MAX_ROUND_CONTINUATIONS = 3;

// --- Tavily (universal search path — Phase 2-B) ---

export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

/** basic | advanced | fast | ultra-fast — see Tavily docs. Basic is cheapest (1 credit/request). */
export const TAVILY_SEARCH_DEPTH = "basic";

export const TAVILY_MAX_RESULTS_PER_QUERY = 5;

/** Truncate each result's content before it's injected into a prompt, to bound tokens. */
export const TAVILY_MAX_CONTENT_CHARS = 2000;

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
