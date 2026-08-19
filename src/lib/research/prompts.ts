// Research prompts — general-purpose (no domain hardcoding). The planner's
// perspective-first decomposition is adapted from STORM (Stanford OVAL,
// "Assisting in Writing Wikipedia-like Articles From Multiple Perspectives"),
// which generates multi-perspective questions before drafting a report.

import type { Finding, Gap, ResearchSession, Source } from "./types";

function contextLine(ourOrgContext: string | undefined): string {
  return ourOrgContext
    ? `\n\nContext for this research (provided by the person asking — factor it in where relevant): ${ourOrgContext}`
    : "";
}

export const PLANNER_SYSTEM_PROMPT = `You are a research planner preparing a deep-research run on an open question.

Approach the question perspective-first: identify the distinct perspectives from which the question should be examined (e.g. technical, historical, economic, practical, critical), then derive the sub-questions each perspective would ask, and propose the report sections their answers would fill.

Output ONLY a single JSON object — no markdown code fences, no commentary before or after — matching exactly this schema:
{
  "perspectives": [ string, ... ],
  "plan": [ { "question": string, "section": string } ],
  "initialQueries": [ string, ... ]
}

Rules:
- Produce 8-14 "plan" sub-questions drawn from at least 3 distinct perspectives.
- Each "section" is a short proposed report section title (2-5 words) naming the section that sub-question's answer would contribute to. Use 3-6 distinct section names overall — together they should form a sensible outline for a report on this specific question.
- Produce 4-8 "initialQueries" — concrete web search query strings likely to surface the highest-value information first.
- Do not plan questions for "Summary", "Open Questions", or "Sources" — those are synthesized later from findings, not researched directly.`;

export function buildPlannerUserMessage(topic: string, ourOrgContext: string | undefined): string {
  return `Research question: ${topic}${contextLine(ourOrgContext)}`;
}

// --- Seed-adaptive planning (Phase 2-C, upload input mode) ---
// A run can be started from a typed question, an uploaded seed (doc/URL list),
// or both. Question-only delegates straight to buildPlannerUserMessage above —
// byte-for-byte the same as before this existed — so the existing typed-topic
// path is untouched.

export function buildPlannerUserMessageAdaptive(
  topic: string | undefined,
  seed: string | undefined,
  ourOrgContext: string | undefined,
): string {
  const trimmedTopic = topic?.trim();
  const trimmedSeed = seed?.trim();

  if (!trimmedTopic && !trimmedSeed) {
    throw new Error("buildPlannerUserMessageAdaptive requires a topic, a seed, or both");
  }

  if (trimmedSeed && !trimmedTopic) {
    return `You have been given seed material (below) instead of a typed question. Derive research questions that DEEPEN and VERIFY what's already stated in it — don't just restate it; dig into what's under-supported, ambiguous, or worth independently confirming.${contextLine(ourOrgContext)}

Seed material:
${trimmedSeed}`;
  }

  if (trimmedSeed && trimmedTopic) {
    return `Research question: ${trimmedTopic}${contextLine(ourOrgContext)}

You have also been given seed material (below) — use it as grounding context. Focus your research questions on "${trimmedTopic}" specifically, using the seed to inform what's already known versus what still needs independent verification.

Seed material:
${trimmedSeed}`;
  }

  return buildPlannerUserMessage(trimmedTopic!, ourOrgContext);
}

// --- Extraction (search-driven rounds) ---
// The model has no tool to call: fetched page content is injected directly
// into the message as text, since not every provider/model supports (or
// reliably supports) tool-calling.

export const EXTRACTION_SYSTEM_PROMPT = `You are a research analyst extracting information from web search results. You will be given raw search results (title, URL, and page content) gathered for a set of open research questions — read them carefully and extract concrete, sourced findings.

Respond with ONLY a single JSON object as your entire message — no markdown code fences, no other text before or after it — matching exactly this schema:
{
  "findings": [ { "text": string, "sourceUrls": [string, ...] } ],
  "resolvedGaps": [string, ...],
  "newGaps": [ { "question": string, "section": string } ]
}

Rules:
- Every finding must be concrete and attributable — no vague filler. If the search results don't answer a question, leave it unresolved; never invent an answer.
- "sourceUrls" must only contain URLs that actually appear in the search results provided below.
- "resolvedGaps" must contain the exact question text — copied verbatim, character-for-character — of every open question you found solid evidence for in the results. Do not resolve a question without real, specific evidence in the provided content.
- "newGaps" are new, more specific follow-up questions the results surfaced — the directions worth pursuing in the next research round given what has already been learned. For each, give a "section": either an existing section name or a short new one if it opens a genuinely new angle. Only include genuinely useful ones; an empty array is fine.`;

export interface QuerySearchResults {
  query: string;
  results: Array<{ url: string; title: string; content: string }>;
}

function learningsBlock(accumulatedLearnings: string[]): string {
  if (accumulatedLearnings.length === 0) return "";
  return `Learnings gathered in earlier rounds (build on these — don't re-derive them):\n${accumulatedLearnings
    .map((learning, i) => `${i + 1}. ${learning}`)
    .join("\n")}\n\n`;
}

export function buildExtractionUserMessage(
  topic: string,
  gaps: Gap[],
  searchResults: QuerySearchResults[],
  accumulatedLearnings: string[] = [],
): string {
  const openQuestions = gaps.map((gap, i) => `${i + 1}. [${gap.section}] ${gap.question}`).join("\n");

  const resultsBlock = searchResults
    .map(({ query, results }) => {
      const items =
        results.map((r, i) => `  [${i + 1}] ${r.title} — ${r.url}\n  ${r.content}`).join("\n\n") ||
        "  (no new results)";
      return `Search: "${query}"\n${items}`;
    })
    .join("\n\n---\n\n");

  return `Research topic: ${topic}

${learningsBlock(accumulatedLearnings)}Open questions:
${openQuestions}

Search results gathered this round:
${resultsBlock}`;
}

// --- Model-knowledge fallback (search/fetch unavailable) ---
// If a round can't surface a single fetchable page (search blocked by CORS,
// offline, every fetch failed), the round degrades to the model's own
// knowledge instead of dead-ending — with every finding explicitly flagged
// unverified so synthesis can present it honestly.

export const MODEL_KNOWLEDGE_SYSTEM_PROMPT = `You are a research analyst. Web search and page fetching are unavailable in this environment right now, so answer the open research questions from your own knowledge. Be honest about that limit: everything you produce is unverified model knowledge, not a sourced fact.

Respond with ONLY a single JSON object as your entire message — no markdown code fences, no other text before or after it — matching exactly this schema:
{
  "findings": [ { "text": string } ],
  "resolvedGaps": [string, ...],
  "newGaps": [ { "question": string, "section": string } ]
}

Rules:
- Start every finding's text with "[Unverified — model knowledge]" so the final report can flag it clearly.
- Only mark a question resolved (exact verbatim question text in "resolvedGaps") when your knowledge answers it concretely.
- Findings have no sources — never invent URLs.
- "newGaps" may list follow-ups worth checking once sources become available; an empty array is fine.`;

export function buildModelKnowledgeUserMessage(
  topic: string,
  gaps: Gap[],
  accumulatedLearnings: string[] = [],
): string {
  const openQuestions = gaps.map((gap, i) => `${i + 1}. [${gap.section}] ${gap.question}`).join("\n");

  return `Research topic: ${topic}

${learningsBlock(accumulatedLearnings)}Open questions:
${openQuestions}`;
}

export const SYNTHESIS_SYSTEM_PROMPT = `You are a research analyst writing the final deep-research report. Use ONLY the provided findings and their sources; never invent facts. Where evidence is thin or missing, say so explicitly rather than filling gaps. Findings marked "[Unverified — model knowledge]" must be presented as unverified claims, clearly flagged as such. Attribute every sourced, non-obvious claim to a source. Output clean markdown with exactly these parts, in this order:

1. **Summary** — a short executive summary answering the research question (3-6 sentences).
2. **Report sections** — one section per proposed section title listed in the input, in the order given, each titled with that section name.
3. **Open Questions** — the questions that could not be resolved with solid evidence.
4. **Sources** — numbered list of the sources provided, in the order given.

Cite sources inline using bracketed numbers like [1] that match the numbered Sources list at the end. If a section has no supporting findings, write "Not found in available sources."`;

export function buildSynthesisUserMessage(session: ResearchSession): string {
  const plannedSections = Array.from(new Set(session.plan.map((gap) => gap.section)));

  const findingsList = session.findings
    .map((finding: Finding, i: number) => {
      const sources = finding.sourceUrls.length > 0 ? ` [Source: ${finding.sourceUrls.join(", ")}]` : "";
      return `${i + 1}. ${finding.text}${sources}`;
    })
    .join("\n");

  const sourcesList = session.sources
    .map((source: Source, i: number) => `[${i + 1}] ${source.title} — ${source.url}`)
    .join("\n");

  const openGapsList = session.gaps.map((gap) => `- [${gap.section}] ${gap.question}`).join("\n");

  const notesBlock =
    session.notes.length > 0
      ? `\n\nNotes on this research run (mention if relevant, e.g. in a caveat): ${session.notes.join("; ")}`
      : "";

  return `Research question: ${session.topic}${contextLine(session.ourOrgContext)}

Proposed report sections (use these, in this order, for the body of the report):
${plannedSections.length > 0 ? plannedSections.map((section, i) => `${i + 1}. ${section}`).join("\n") : "(derive sensible sections from the findings)"}

Findings gathered (${session.findings.length} total, across ${session.rounds.length} research rounds):
${findingsList || "(none found)"}

All sources found, for your numbered Sources section:
${sourcesList || "(none found)"}

Questions we could not find solid evidence for — list these under Open Questions:
${openGapsList || "(none — all planned questions were resolved)"}${notesBlock}

Write the full report now, following the structure and rules in your system prompt exactly.`;
}
