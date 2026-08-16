// The Deep Research engine — the only one. No search tool, no search API key,
// no per-provider special-casing: expansion happens only by fetching URLs
// already present in an uploaded/pasted seed (computeExpansionFrontier in
// seed.ts), one hop out, via the app's existing web_fetch. Planner, extraction,
// and synthesis all run through the app's multi-provider completion layer, so
// this works on whatever model is currently selected — Claude, OpenAI, Gemini,
// a local Ollama model, anything.

import type { Provider } from "@/types";
import { streamChatCompletion, type ChatCompletionMessage } from "@/lib/llm";
import { extractJson } from "./json";
import { fetchUrlContent } from "./seed";
import { FETCH_ONLY_FETCH_CONCURRENCY, FETCH_ONLY_MAX_CONTENT_CHARS, FETCH_ONLY_MAX_FETCHES_PER_ROUND } from "./config";
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserMessageAdaptive,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserMessage,
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
      plan: (parsed.plan ?? []).map((gap) => ({ question: gap.question, section: gap.section })),
      initialQueries: parsed.initialQueries ?? [],
    };
    return result;
  };
}

function makeFetchOnlyResearchRoundFn(provider: Provider, model: string): ResearchRoundFn {
  // The expansion frontier (context.seedUrls) is consumed across rounds, a
  // capped batch at a time — never re-fetched, never expanded beyond (no hop 2).
  const fetchedUrls = new Set<string>();
  let frontierQueue: string[] | null = null;

  return async (topic, gaps, _queries, roundIndex, context, signal) => {
    if (context.mode !== "fetch-only") {
      throw new Error("makeFetchOnlyResearchRoundFn requires context.mode === 'fetch-only'");
    }

    if (frontierQueue === null) {
      frontierQueue = Array.from(new Set(context.seedUrls ?? []));
    }

    const batch: string[] = [];
    while (frontierQueue.length > 0 && batch.length < FETCH_ONLY_MAX_FETCHES_PER_ROUND) {
      const next = frontierQueue.shift()!;
      if (!fetchedUrls.has(next)) batch.push(next);
    }

    const emptyResult = (tokensUsed = 0): ResearchRoundResult => ({
      findings: [],
      newSources: [],
      resolvedGaps: [],
      newGaps: [],
      tokensUsed,
    });

    // Frontier exhausted — nothing left to fetch. Orchestrator's diminishing-
    // returns termination will end the loop after this.
    if (batch.length === 0) return emptyResult();

    // Bounded-concurrency fetch, checking cancellation between mini-batches —
    // executeWebFetch has no external AbortSignal (see DISCOVERY-2C.md), so an
    // in-flight fetch can't be aborted mid-request, only not-started.
    const fetchedPages: Array<{ url: string; content: string }> = [];
    for (let i = 0; i < batch.length; i += FETCH_ONLY_FETCH_CONCURRENCY) {
      if (signal.aborted) break;
      const slice = batch.slice(i, i + FETCH_ONLY_FETCH_CONCURRENCY);
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

    const newSources: Source[] = fetchedPages.map((page) => ({
      url: page.url,
      title: page.url,
      foundInRound: roundIndex,
    }));

    if (fetchedPages.length === 0) return emptyResult();

    const searchResults: QuerySearchResults[] = [
      {
        query: "links referenced in the uploaded material",
        results: fetchedPages.map((page) => ({ url: page.url, title: page.url, content: page.content })),
      },
    ];
    const userMessage = buildExtractionUserMessage(topic || "the organization described in the uploaded material", gaps, searchResults);

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

    const result: ResearchRoundResult = {
      findings,
      newSources,
      resolvedGaps: matchResolvedGaps(gaps, parsed.resolvedGaps ?? []),
      newGaps: (parsed.newGaps ?? []).map((gap) => ({ question: gap.question, section: gap.section })),
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
