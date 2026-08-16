import type { Finding, Gap, ResearchSession, Source } from "./types";
import { REPORT_SECTIONS } from "./config";

function orgContextLine(ourOrgContext: string | undefined): string {
  return ourOrgContext
    ? `\n\nContext: this research is being done on behalf of "${ourOrgContext}", a peer/competitor organization. Where relevant, note angles useful for competitive comparison.`
    : "";
}

export const PLANNER_SYSTEM_PROMPT = `You are a research planner preparing a competitive-intelligence research run on an NGO or nonprofit organization.

Output ONLY a single JSON object — no markdown code fences, no commentary before or after — matching exactly this schema:
{
  "plan": [ { "question": string, "section": string } ],
  "initialQueries": [ string, ... ]
}

Rules:
- "section" must be one of exactly these values: ${REPORT_SECTIONS.map((s) => `"${s}"`).join(", ")}.
- Produce 8-14 "plan" sub-questions, covering as many of those sections as possible for the given organization.
- Produce 4-8 "initialQueries" — concrete web search query strings likely to surface the highest-value information first (official site, recent news, funders, leadership, annual reports).
- Do not plan questions for "Strengths & Weaknesses", "Strategic Implications", or "Sources" — those are synthesized later from findings, not researched directly.`;

export function buildPlannerUserMessage(topic: string, ourOrgContext: string | undefined): string {
  return `Organization to research: ${topic}${orgContextLine(ourOrgContext)}`;
}

// --- Seed-adaptive planning (Phase 2-C, upload input mode) ---
// A run can be started from a typed topic, an uploaded seed (doc/URL list),
// or both. Topic-only delegates straight to buildPlannerUserMessage above —
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
    return `You have been given seed material about an organization (below) instead of a typed topic. Derive research questions that DEEPEN and VERIFY what's already stated in it — don't just restate it; dig into what's under-supported, ambiguous, or worth independently confirming.${orgContextLine(ourOrgContext)}

Seed material:
${trimmedSeed}`;
  }

  if (trimmedSeed && trimmedTopic) {
    return `Organization to research: ${trimmedTopic}${orgContextLine(ourOrgContext)}

You have also been given seed material (below) — use it as grounding context. Focus your research questions on "${trimmedTopic}" specifically, using the seed to inform what's already known versus what still needs independent verification.

Seed material:
${trimmedSeed}`;
  }

  return buildPlannerUserMessage(trimmedTopic!, ourOrgContext);
}

// --- Extraction (the only research-round path) ---
// The model has no tool to call: fetched page content is injected directly
// into the message as text, since not every provider/model supports (or
// reliably supports) tool-calling, and there's no search tool to call anyway.

export const EXTRACTION_SYSTEM_PROMPT = `You are a research analyst extracting information from web search results about an NGO or nonprofit organization. You will be given raw search results (title, URL, and page content) gathered for a set of open research questions — read them carefully and extract concrete, sourced findings.

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
- "newGaps" are new, more specific follow-up questions the search results surfaced. Only include genuinely useful ones; an empty array is fine.`;

export interface QuerySearchResults {
  query: string;
  results: Array<{ url: string; title: string; content: string }>;
}

export function buildExtractionUserMessage(
  topic: string,
  gaps: Gap[],
  searchResults: QuerySearchResults[],
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

  return `Organization: ${topic}

Open questions:
${openQuestions}

Search results gathered this round:
${resultsBlock}`;
}

export const SYNTHESIS_SYSTEM_PROMPT = `You are a competitive-intelligence analyst producing a research brief on an NGO for a peer/competitor organization. Use ONLY the provided findings and their sources; never invent facts. Where evidence is thin or missing, say so explicitly rather than filling gaps. Attribute every non-obvious claim to a source. Be concrete and comparative, not promotional. Output clean markdown with these sections:

1. **Snapshot** — mission, founding year, HQ, size (staff/volunteers), one-line positioning.
2. **Programs & Activities** — what they actually do, flagship initiatives.
3. **Geographic Reach & Beneficiaries** — where they operate, who they serve, scale.
4. **Funding Model** — revenue sources, major funders/grants, budget if disclosed.
5. **Leadership & Governance** — key people, board, notable affiliations.
6. **Partnerships & Coalitions** — who they work with.
7. **Communications & Digital Presence** — brand, channels, campaigns, reach.
8. **Impact Claims vs Evidence** — what they claim; how well-substantiated it is.
9. **Strengths & Weaknesses** — honest, evidence-based.
10. **Strategic Implications** — gaps/opportunities relative to a competing org.
11. **Sources** — numbered list of URLs used.

If information for a section can't be found, write "Not found in available sources." Cite sources inline using bracketed numbers like [1] that match the numbered Sources list at the end.`;

export function buildSynthesisUserMessage(session: ResearchSession): string {
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

  return `Organization researched: ${session.topic}${orgContextLine(session.ourOrgContext)}

Findings gathered (${session.findings.length} total, across ${session.rounds.length} research rounds):
${findingsList || "(none found)"}

All sources found, for your numbered Sources section:
${sourcesList || "(none found)"}

Questions we could not find solid evidence for — write "Not found in available sources" for these where relevant:
${openGapsList || "(none — all planned questions were resolved)"}${notesBlock}

Write the full competitive-intelligence report now, following the section template and rules in your system prompt exactly.`;
}
