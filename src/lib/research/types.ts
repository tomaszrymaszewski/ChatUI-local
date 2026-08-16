// Deep Research orchestrator — data model and tunable config.
// See DISCOVERY.md and PLAN.md at the repo root for background.

export const DEFAULT_MAX_ROUNDS = 5;
export const DEFAULT_MAX_QUERIES_PER_ROUND = 4;
export const DEFAULT_GLOBAL_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 200_000;

export interface ResearchConfig {
  maxRounds: number;
  maxQueriesPerRound: number;
  globalTimeoutMs: number;
  maxOutputTokens: number;
}

export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  maxRounds: DEFAULT_MAX_ROUNDS,
  maxQueriesPerRound: DEFAULT_MAX_QUERIES_PER_ROUND,
  globalTimeoutMs: DEFAULT_GLOBAL_TIMEOUT_MS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
};

export type ResearchPhase =
  | "planning"
  | "researching"
  | "synthesizing"
  | "done"
  | "cancelled"
  | "error";

export interface Source {
  url: string;
  title: string;
  foundInRound: number;
}

export interface Finding {
  text: string;
  sourceUrls: string[];
  foundInRound: number;
}

/** A sub-question the report still needs an answer for, mapped to a report section. */
export interface Gap {
  question: string;
  section: string;
}

export interface ResearchRound {
  index: number;
  queries: string[];
  findings: Finding[];
  newSources: Source[];
  gapsAddressed: string[];
  tokensUsed: number;
}

export interface ResearchSession {
  topic: string;
  ourOrgContext?: string;
  plan: Gap[];
  rounds: ResearchRound[];
  findings: Finding[];
  sources: Source[];
  gaps: Gap[];
  phase: ResearchPhase;
  /** Human-readable degradation notes (e.g. "Round 3 timed out and was skipped"), surfaced to synthesis. */
  notes: string[];
}

export type ProgressEvent =
  | { type: "planning" }
  | { type: "round_start"; round: number; maxRounds: number; label: string }
  | { type: "round_end"; round: number; newSourceCount: number; remainingGaps: number }
  | { type: "synthesizing" }
  | { type: "synthesis_chunk"; chunk: string; accumulated: string }
  | { type: "done"; session: ResearchSession }
  | { type: "cancelled"; session: ResearchSession }
  | { type: "error"; message: string; session: ResearchSession };

export interface PlannerResult {
  plan: Gap[];
  initialQueries: string[];
}

export interface ResearchRoundResult {
  findings: Finding[];
  newSources: Source[];
  /** Gap questions (matching Gap.question) that this round resolved. */
  resolvedGaps: string[];
  newGaps: Gap[];
  tokensUsed: number;
}

export type PlannerFn = (
  topic: string,
  ourOrgContext: string | undefined,
  signal: AbortSignal,
) => Promise<PlannerResult>;

/**
 * How a round should gather material. "search" (the default) is the existing,
 * unchanged behavior — Claude web_search or Tavily-injected search, depending
 * on engine. "fetch-only" (Phase 2-C) expands only by fetching links already
 * present in an uploaded seed, no search tool involved at all.
 */
export interface ResearchContext {
  mode: "search" | "fetch-only";
  /** fetch-only mode's expansion frontier — candidate URLs to fetch, sourced from the seed. Ignored in search mode. */
  seedUrls?: string[];
}

export const DEFAULT_RESEARCH_CONTEXT: ResearchContext = { mode: "search" };

export type ResearchRoundFn = (
  topic: string,
  gaps: Gap[],
  queries: string[],
  roundIndex: number,
  context: ResearchContext,
  signal: AbortSignal,
) => Promise<ResearchRoundResult>;

/**
 * Streams markdown chunks as they're generated (mirrors streamChatCompletion /
 * streamAnthropicCompletion's async-generator shape so Phase 3 can reuse the
 * same setStreamingContent loop). The orchestrator accumulates the yielded
 * chunks into the final report string.
 */
export type SynthesizeFn = (
  session: ResearchSession,
  signal: AbortSignal,
) => AsyncGenerator<string, void, unknown>;
