// Universal (any-model) research path — Phase 2-B. Planner, extraction, and
// synthesis all run through the app's EXISTING multi-provider completion layer
// (streamChatCompletion in src/lib/llm.ts) on whatever provider/model the
// caller supplies, instead of the Claude-only anthropic-research.ts path.
// Search itself comes from Tavily, injected into the extraction prompt as text
// — no per-provider tool-calling, so this works uniformly even on models with
// weak or no tool support.

import type { Provider } from "@/types";
import { streamChatCompletion, type ChatCompletionMessage } from "@/lib/llm";
import { extractJson } from "./json";
import { searchTavily, type TavilyCredentials, type TavilySearchResult } from "./tavily";
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserMessage,
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

/** streamChatCompletion doesn't surface token usage across providers — a rough
 * chars/4 estimate is enough to keep the orchestrator's token ceiling meaningful
 * rather than dead code for this path (injected search content is heavy). */
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

/** Same verbatim-with-fallback matching as the Claude path (anthropic-research.ts) — kept
 * as a local copy rather than a shared import so the two paths stay independently editable. */
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

function makeUniversalPlannerFn(provider: Provider, model: string): PlannerFn {
  return async (topic, ourOrgContext, signal) => {
    const text = await withRetryOnce(
      () =>
        collectCompletion(
          provider,
          model,
          PLANNER_SYSTEM_PROMPT,
          buildPlannerUserMessage(topic, ourOrgContext),
          signal,
        ),
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

function makeUniversalResearchRoundFn(
  provider: Provider,
  model: string,
  tavily: TavilyCredentials,
): ResearchRoundFn {
  // URL-dedup across rounds: once a page's content has been injected into an
  // extraction prompt, never inject it again even if a later round's search
  // resurfaces it — the model has already had a chance to extract from it.
  const injectedUrls = new Set<string>();

  return async (topic, gaps, queries, roundIndex, signal) => {
    const perQuery: QuerySearchResults[] = [];
    const newSources: Source[] = [];

    for (const query of queries) {
      let results: TavilySearchResult[];
      try {
        results = await withRetryOnce(() => searchTavily(query, tavily, signal), signal);
      } catch {
        results = []; // one failed query degrades to no results for that query, not a crash
      }

      const freshResults = results.filter((result) => !injectedUrls.has(result.url));
      freshResults.forEach((result) => injectedUrls.add(result.url));
      perQuery.push({ query, results: freshResults });
      newSources.push(
        ...freshResults.map((result) => ({ url: result.url, title: result.title, foundInRound: roundIndex })),
      );
    }

    const emptyResult = (tokensUsed: number): ResearchRoundResult => ({
      findings: [],
      newSources,
      resolvedGaps: [],
      newGaps: [],
      tokensUsed,
    });

    // Nothing new to extract from this round (every result was already injected earlier).
    if (newSources.length === 0) return emptyResult(0);

    const userMessage = buildExtractionUserMessage(topic, gaps, perQuery);
    let text: string;
    try {
      text = await withRetryOnce(
        () => collectCompletion(provider, model, EXTRACTION_SYSTEM_PROMPT, userMessage, signal),
        signal,
      );
    } catch {
      return emptyResult(estimateTokens(userMessage));
    }

    let parsed: {
      findings: Array<{ text: string; sourceUrls: string[] }>;
      resolvedGaps: string[];
      newGaps: Array<{ question: string; section: string }>;
    };
    try {
      parsed = extractJson(text);
    } catch {
      return emptyResult(estimateTokens(userMessage) + estimateTokens(text));
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

function makeUniversalSynthesizeFn(provider: Provider, model: string): SynthesizeFn {
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

export interface UniversalResearchFunctions {
  planner: PlannerFn;
  researchRound: ResearchRoundFn;
  synthesize: SynthesizeFn;
}

export function createUniversalResearchFunctions(
  provider: Provider,
  model: string,
  tavily: TavilyCredentials,
): UniversalResearchFunctions {
  return {
    planner: makeUniversalPlannerFn(provider, model),
    researchRound: makeUniversalResearchRoundFn(provider, model, tavily),
    synthesize: makeUniversalSynthesizeFn(provider, model),
  };
}
