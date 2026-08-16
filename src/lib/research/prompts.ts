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

export const RESEARCH_ROUND_SYSTEM_PROMPT = `You are a research analyst with a web_search tool. Use it thoroughly — search multiple times, from multiple angles — to find concrete, sourced information about the assigned questions. Prefer primary sources (the organization's own site, filings, annual reports) and reputable secondary sources (established news outlets, nonprofit watchdog/rating sites like Charity Navigator or ProPublica Nonprofit Explorer where relevant).

Once you've finished searching, respond with ONLY a single JSON object as your entire final message — no markdown code fences, no other text before or after it — matching exactly this schema:
{
  "findings": [ { "text": string, "sourceUrls": [string, ...] } ],
  "resolvedGaps": [string, ...],
  "newGaps": [ { "question": string, "section": string } ]
}

Rules:
- Every finding must be concrete and attributable — no vague filler. If you found nothing solid for a question, leave it unresolved; never invent an answer.
- "sourceUrls" must only contain URLs that actually appeared in your search results this round.
- "resolvedGaps" must contain the exact question text — copied verbatim, character-for-character — of every open question below that you found solid evidence for. Do not resolve a question without real, specific evidence.
- "newGaps" are new, more specific follow-up questions this round's research surfaced. Only include genuinely useful ones; an empty array is fine.`;

export function buildResearchRoundUserMessage(
  topic: string,
  gaps: Gap[],
  queries: string[],
  roundIndex: number,
): string {
  const openQuestions = gaps.map((gap, i) => `${i + 1}. [${gap.section}] ${gap.question}`).join("\n");
  return `Organization: ${topic}

Research round ${roundIndex + 1}. Suggested starting search queries: ${queries.join("; ")}

Open questions (answer as many as you credibly can — you are not limited to only these):
${openQuestions}`;
}

// --- Extraction (universal/Tavily path — Phase 2-B) ---
// Same job as RESEARCH_ROUND_SYSTEM_PROMPT above, but the model has no tool to
// call: search results are injected directly into the message as text, since
// not every provider/model supports (or reliably supports) tool-calling.

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
