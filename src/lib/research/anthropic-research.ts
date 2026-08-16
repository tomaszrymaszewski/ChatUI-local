// Real Anthropic + web_search implementations of PlannerFn / ResearchRoundFn /
// SynthesizeFn (see types.ts). Plain fetch(), matching src/lib/providers/anthropic.ts's
// existing pattern — no SDK, key supplied by the caller via ResearchCredentials.

import type { ResearchCredentials } from "./api-key";
import {
  MAX_ROUND_CONTINUATIONS,
  PLANNER_MAX_TOKENS,
  RESEARCH_ANTHROPIC_VERSION,
  RESEARCH_MODEL,
  RESEARCH_ROUND_MAX_TOKENS,
  SYNTHESIS_MAX_TOKENS,
  WEB_SEARCH_MAX_USES_PER_ROUND,
  WEB_SEARCH_TOOL_TYPE,
} from "./config";
import { extractJson } from "./json";
import {
  PLANNER_SYSTEM_PROMPT,
  RESEARCH_ROUND_SYSTEM_PROMPT,
  SYNTHESIS_SYSTEM_PROMPT,
  buildPlannerUserMessage,
  buildResearchRoundUserMessage,
  buildSynthesisUserMessage,
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

interface AnthropicMessageResponse {
  content: Array<Record<string, unknown>>;
  stop_reason: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

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

async function postAnthropicMessages(params: {
  credentials: ResearchCredentials;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  tools?: unknown[];
  maxTokens: number;
  signal: AbortSignal;
}): Promise<AnthropicMessageResponse> {
  const response = await fetch(`${params.credentials.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.credentials.apiKey,
      "anthropic-version": RESEARCH_ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
      stream: false,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText || response.statusText}`);
  }
  return (await response.json()) as AnthropicMessageResponse;
}

function extractTextBlocks(content: Array<Record<string, unknown>>): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => (block.text as string) ?? "")
    .join("");
}

function extractWebSearchSources(content: Array<Record<string, unknown>>, roundIndex: number): Source[] {
  const sources: Source[] = [];
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    const resultContent = block.content;
    if (!Array.isArray(resultContent)) continue; // error case: content is a single error object, not results
    for (const item of resultContent as Array<Record<string, unknown>>) {
      if (item?.type === "web_search_result" && typeof item.url === "string") {
        sources.push({
          url: item.url,
          title: typeof item.title === "string" ? item.title : item.url,
          foundInRound: roundIndex,
        });
      }
    }
  }
  return sources;
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const result: Source[] = [];
  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    result.push(source);
  }
  return result;
}

function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The model is told to copy gap.question back verbatim in resolvedGaps, but
 * LLMs occasionally paraphrase slightly — fall back to a normalized match
 * rather than silently losing a real resolution to a whitespace/case diff.
 */
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

function makePlannerFn(credentials: ResearchCredentials): PlannerFn {
  return async (topic, ourOrgContext, signal) => {
    const response = await withRetryOnce(
      () =>
        postAnthropicMessages({
          credentials,
          system: PLANNER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildPlannerUserMessage(topic, ourOrgContext) }],
          maxTokens: PLANNER_MAX_TOKENS,
          signal,
        }),
      signal,
    );

    const parsed = extractJson<{
      plan: Array<{ question: string; section: string }>;
      initialQueries: string[];
    }>(extractTextBlocks(response.content));

    const result: PlannerResult = {
      plan: (parsed.plan ?? []).map((gap) => ({ question: gap.question, section: gap.section })),
      initialQueries: parsed.initialQueries ?? [],
    };
    return result;
  };
}

function makeResearchRoundFn(credentials: ResearchCredentials): ResearchRoundFn {
  return async (topic, gaps, queries, roundIndex, signal) => {
    const tools = [
      { type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: WEB_SEARCH_MAX_USES_PER_ROUND },
    ];

    let messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
      { role: "user", content: buildResearchRoundUserMessage(topic, gaps, queries, roundIndex) },
    ];

    let finalResponse: AnthropicMessageResponse | null = null;
    const allSources: Source[] = [];
    let totalTokens = 0;

    for (let i = 0; i < MAX_ROUND_CONTINUATIONS; i++) {
      const response = await withRetryOnce(
        () =>
          postAnthropicMessages({
            credentials,
            system: RESEARCH_ROUND_SYSTEM_PROMPT,
            messages,
            tools,
            maxTokens: RESEARCH_ROUND_MAX_TOKENS,
            signal,
          }),
        signal,
      );
      totalTokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
      allSources.push(...extractWebSearchSources(response.content, roundIndex));

      if (response.stop_reason === "pause_turn") {
        messages = [...messages, { role: "assistant", content: response.content }];
        continue;
      }
      finalResponse = response;
      break;
    }

    const emptyResult = (): ResearchRoundResult => ({
      findings: [],
      newSources: dedupeSources(allSources),
      resolvedGaps: [],
      newGaps: [],
      tokensUsed: totalTokens,
    });

    // Ran out of continuations without a final answer, or the model didn't
    // return valid JSON despite instructions — degrade gracefully: keep
    // whatever sources were actually found, report no findings/resolutions.
    if (!finalResponse) return emptyResult();

    let parsed: {
      findings: Array<{ text: string; sourceUrls: string[] }>;
      resolvedGaps: string[];
      newGaps: Array<{ question: string; section: string }>;
    };
    try {
      parsed = extractJson(extractTextBlocks(finalResponse.content));
    } catch {
      return emptyResult();
    }

    const actualSourceUrls = new Set(allSources.map((source) => source.url));
    const findings: Finding[] = (parsed.findings ?? []).map((finding) => ({
      text: finding.text,
      sourceUrls: (finding.sourceUrls ?? []).filter((url) => actualSourceUrls.has(url)),
      foundInRound: roundIndex,
    }));

    const result: ResearchRoundResult = {
      findings,
      newSources: dedupeSources(allSources),
      resolvedGaps: matchResolvedGaps(gaps, parsed.resolvedGaps ?? []),
      newGaps: (parsed.newGaps ?? []).map((gap) => ({ question: gap.question, section: gap.section })),
      tokensUsed: totalTokens,
    };
    return result;
  };
}

function makeSynthesizeFn(credentials: ResearchCredentials): SynthesizeFn {
  return async function* (session: ResearchSession, signal: AbortSignal) {
    const response = await fetch(`${credentials.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": credentials.apiKey,
        "anthropic-version": RESEARCH_ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: RESEARCH_MODEL,
        max_tokens: SYNTHESIS_MAX_TOKENS,
        system: SYNTHESIS_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildSynthesisUserMessage(session) }],
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText || response.statusText}`);
    }
    if (!response.body) throw new Error("No response body from Anthropic");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          const lines = raw.split("\n");
          let eventType = "";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr = line.slice(6);
          }
          if (!dataStr) continue;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }
          if (eventType === "content_block_delta") {
            const delta = data.delta as Record<string, unknown>;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              yield delta.text;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  };
}

export interface ResearchFunctions {
  planner: PlannerFn;
  researchRound: ResearchRoundFn;
  synthesize: SynthesizeFn;
}

export function createResearchFunctions(credentials: ResearchCredentials): ResearchFunctions {
  return {
    planner: makePlannerFn(credentials),
    researchRound: makeResearchRoundFn(credentials),
    synthesize: makeSynthesizeFn(credentials),
  };
}
