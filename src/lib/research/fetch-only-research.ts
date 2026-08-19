// The Deep Research engine — the only one. No search API key, no per-provider
// special-casing. Rounds are search-driven (recursion ported from
// dzhng/deep-research, MIT license, https://github.com/dzhng/deep-research):
// each round searches this round's queries via keyless DuckDuckGo search,
// fetches the top pages, extracts cited "learnings" plus follow-up "new
// directions", and the next round recurses with all accumulated learnings as
// context — bounded by the breadth/depth config in config.ts. Pasted URLs and
// uploaded files still seed round 0 (computeExpansionFrontier in seed.ts).
// If search/fetch yields nothing at all (CORS, offline), a round degrades to
// model-knowledge findings explicitly flagged unverified — never a dead end.
// Planner, extraction, and synthesis all run through the app's multi-provider
// completion layer, so this works on whatever model is currently selected —
// Claude, OpenAI, Gemini, a local Ollama model, anything.

import type { Provider } from "@/types";
import { streamChatCompletion, type ChatCompletionMessage } from "@/lib/llm";
import { extractJson } from "./json";
import { fetchUrlContent } from "./seed";
import { keylessWebSearch } from "./keyless-search";
import {
  FETCH_ONLY_FETCH_CONCURRENCY,
  FETCH_ONLY_MAX_CONTENT_CHARS,
  FETCH_ONLY_MAX_FETCHES_PER_ROUND,
  KEYLESS_SEARCH_MAX_RESULTS,
} from "./config";
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserMessageAdaptive,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserMessage,
  MODEL_KNOWLEDGE_SYSTEM_PROMPT,
  buildModelKnowledgeUserMessage,
  SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserMessage,
  type QuerySearchResults,
} from "./prompts";
import type {
  Finding,
  Gap,
  PlannerFn,
  PlannerResult,
  ResearchRoundFn,
  ResearchRoundResult,
  ResearchSession,
  Source,
  SynthesizeFn,
} from "./types";

async function withRetryOnce<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (signal.aborted) throw error;
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (signal.aborted) throw error;
    return await fn();
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function collectCompletion(
  provider: Provider,
  model: string,
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
): Promise<string> {
  const messages: ChatCompletionMessage[] = [{ role: "user", content: userMessage }];
  let text = "";
  for await (const chunk of streamChatCompletion(provider, model, messages, signal, undefined, systemPrompt, undefined)) {
    if (chunk.content) text += chunk.content;
  }
  return text;
}

function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchResolvedGaps(gaps: Gap[], claimed: string[]): string[] {
  const byNormalized = new Map(gaps.map((gap) => [normalizeQuestion(gap.question), gap.question]));
  const resolved = new Set<string>();
  for (const claim of claimed) {
    if (gaps.some((gap) => gap.question === claim)) {
      resolved.add(claim);
      continue;
    }
    const match = byNormalized.get(normalizeQuestion(claim));
    if (match) resolved.add(match);
  }
  return Array.from(resolved);
}

function parseGaps(raw: Array<{ question: string; section: string }> | undefined): Gap[] {
  return (raw ?? []).map((gap) => ({ question: gap.question, section: gap.section }));
}

function makeFetchOnlyPlannerFn(provider: Provider, model: string, seed: string | undefined): PlannerFn {
  return async (topic, ourOrgContext, signal) => {
    const userMessage = buildPlannerUserMessageAdaptive(topic || undefined, seed, ourOrgContext);
    const text = await withRetryOnce(
      () => collectCompletion(provider, model, PLANNER_SYSTEM_PROMPT, userMessage, signal),
      signal,
    );

    const parsed = extractJson<{
      plan: Array<{ question: string; section: string }>;
      initialQueries: string[];
    }>(text);

    const result: PlannerResult = {
      plan: parseGaps(parsed.plan),
      initialQueries: parsed.initialQueries ?? [],
    };
    return result;
  };
}

/** Label for the search bucket that seed-frontier URLs are reported under in the extraction prompt. */
const SEED_QUERY_LABEL = "links referenced in the uploaded material";

function makeFetchOnlyResearchRoundFn(provider: Provider, model: string): ResearchRoundFn {
  // Cross-round state: URLs already consumed (never re-fetched), the remaining
  // seed frontier (pasted URLs/files seed round 0), and every learning
  // extracted so far (injected into later rounds so the recursion builds on
  // itself instead of re-deriving the same facts).
  const fetchedUrls = new Set<string>();
  let frontierQueue: string[] | null = null;
  const accumulatedLearnings: string[] = [];

  return async (topic, gaps, queries, roundIndex, context, signal) => {
    if (context.mode !== "fetch-only") {
      throw new Error("makeFetchOnlyResearchRoundFn requires context.mode === 'fetch-only'");
    }

    if (frontierQueue === null) {
      frontierQueue = Array.from(new Set(context.seedUrls ?? []));
    }

    const emptyResult = (tokensUsed = 0): ResearchRoundResult => ({
      findings: [],
      newSources: [],
      resolvedGaps: [],
      newGaps: [],
      tokensUsed,
    });

    // 1) Candidate pages: seed frontier first, then this round's queries,
    //    each searched keylessly (no API key).
    const candidates: string[] = [];
    const candidateOrigin = new Map<string, string>();
    const pushCandidate = (url: string, origin: string) => {
      if (fetchedUrls.has(url) || candidateOrigin.has(url)) return;
      candidates.push(url);
      candidateOrigin.set(url, origin);
    };

    while (frontierQueue.length > 0 && candidates.length < FETCH_ONLY_MAX_FETCHES_PER_ROUND) {
      pushCandidate(frontierQueue.shift()!, SEED_QUERY_LABEL);
    }
    for (const query of queries) {
      if (candidates.length >= FETCH_ONLY_MAX_FETCHES_PER_ROUND || signal.aborted) break;
      const found = await keylessWebSearch(query, KEYLESS_SEARCH_MAX_RESULTS, signal);
      for (const url of found) {
        pushCandidate(url, query);
        if (candidates.length >= FETCH_ONLY_MAX_FETCHES_PER_ROUND) break;
      }
    }

    // 2) Bounded-concurrency fetch, checking cancellation between mini-batches —
    //    executeWebFetch has no external AbortSignal (see DISCOVERY-2C.md), so an
    //    in-flight fetch can't be aborted mid-request, only not-started.
    const fetchedPages: Array<{ url: string; content: string }> = [];
    for (let i = 0; i < candidates.length; i += FETCH_ONLY_FETCH_CONCURRENCY) {
      if (signal.aborted) break;
      const slice = candidates.slice(i, i + FETCH_ONLY_FETCH_CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (url) => {
          fetchedUrls.add(url);
          const content = await fetchUrlContent(url);
          return { url, content };
        }),
      );
      for (const r of results) {
        if (r.content) fetchedPages.push({ url: r.url, content: r.content.slice(0, FETCH_ONLY_MAX_CONTENT_CHARS) });
      }
    }

    // 3) Nothing fetchable this round (search blocked/offline, or every fetch
    //    failed) — degrade to model-knowledge findings, explicitly flagged
    //    unverified, rather than dead-end the run.
    if (fetchedPages.length === 0) {
      if (gaps.length === 0) return emptyResult();

      const userMessage = buildModelKnowledgeUserMessage(topic, gaps, accumulatedLearnings);
      let text: string;
      try {
        text = await withRetryOnce(
          () => collectCompletion(provider, model, MODEL_KNOWLEDGE_SYSTEM_PROMPT, userMessage, signal),
          signal,
        );
      } catch {
        return emptyResult(estimateTokens(userMessage));
      }

      let parsed: {
        findings: Array<{ text: string }>;
        resolvedGaps: string[];
        newGaps: Array<{ question: string; section: string }>;
      };
      try {
        parsed = extractJson(text);
      } catch {
        return emptyResult(estimateTokens(userMessage) + estimateTokens(text));
      }

      const findings: Finding[] = (parsed.findings ?? []).map((finding) => ({
        text: finding.text,
        sourceUrls: [],
        foundInRound: roundIndex,
      }));
      findings.forEach((finding) => accumulatedLearnings.push(finding.text));

      return {
        findings,
        newSources: [],
        resolvedGaps: matchResolvedGaps(gaps, parsed.resolvedGaps ?? []),
        newGaps: parseGaps(parsed.newGaps),
        tokensUsed: estimateTokens(userMessage) + estimateTokens(text),
      };
    }

    // 4) Extract cited learnings + new directions from the fetched pages.
    const newSources: Source[] = fetchedPages.map((page) => ({
      url: page.url,
      title: page.url,
      foundInRound: roundIndex,
    }));

    const byOrigin = new Map<string, Array<{ url: string; title: string; content: string }>>();
    for (const page of fetchedPages) {
      const origin = candidateOrigin.get(page.url) ?? SEED_QUERY_LABEL;
      const bucket = byOrigin.get(origin) ?? [];
      bucket.push({ url: page.url, title: page.url, content: page.content });
      byOrigin.set(origin, bucket);
    }
    const searchResults: QuerySearchResults[] = Array.from(byOrigin.entries()).map(([query, results]) => ({
      query,
      results,
    }));

    const userMessage = buildExtractionUserMessage(
      topic || "the topic described in the uploaded material",
      gaps,
      searchResults,
      accumulatedLearnings,
    );

    let text: string;
    try {
      text = await withRetryOnce(
        () => collectCompletion(provider, model, EXTRACTION_SYSTEM_PROMPT, userMessage, signal),
        signal,
      );
    } catch {
      return { ...emptyResult(estimateTokens(userMessage)), newSources };
    }

    let parsed: {
      findings: Array<{ text: string; sourceUrls: string[] }>;
      resolvedGaps: string[];
      newGaps: Array<{ question: string; section: string }>;
    };
    try {
      parsed = extractJson(text);
    } catch {
      return { ...emptyResult(estimateTokens(userMessage) + estimateTokens(text)), newSources };
    }

    const actualUrls = new Set(newSources.map((source) => source.url));
    const findings: Finding[] = (parsed.findings ?? []).map((finding) => ({
      text: finding.text,
      sourceUrls: (finding.sourceUrls ?? []).filter((url) => actualUrls.has(url)),
      foundInRound: roundIndex,
    }));
    findings.forEach((finding) => accumulatedLearnings.push(finding.text));

    const result: ResearchRoundResult = {
      findings,
      newSources,
      resolvedGaps: matchResolvedGaps(gaps, parsed.resolvedGaps ?? []),
      newGaps: parseGaps(parsed.newGaps),
      tokensUsed: estimateTokens(userMessage) + estimateTokens(text),
    };
    return result;
  };
}

function makeFetchOnlySynthesizeFn(provider: Provider, model: string): SynthesizeFn {
  return async function* (session: ResearchSession, signal: AbortSignal) {
    const messages: ChatCompletionMessage[] = [{ role: "user", content: buildSynthesisUserMessage(session) }];
    for await (const chunk of streamChatCompletion(
      provider,
      model,
      messages,
      signal,
      undefined,
      SYNTHESIS_SYSTEM_PROMPT,
      undefined,
    )) {
      if (chunk.content) yield chunk.content;
    }
  };
}

export interface FetchOnlyResearchFunctions {
  planner: PlannerFn;
  researchRound: ResearchRoundFn;
  synthesize: SynthesizeFn;
}

export function createFetchOnlyResearchFunctions(
  provider: Provider,
  model: string,
  seed: string | undefined,
): FetchOnlyResearchFunctions {
  return {
    planner: makeFetchOnlyPlannerFn(provider, model, seed),
    researchRound: makeFetchOnlyResearchRoundFn(provider, model),
    synthesize: makeFetchOnlySynthesizeFn(provider, model),
  };
}
