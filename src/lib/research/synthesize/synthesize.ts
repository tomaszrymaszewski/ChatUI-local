import type { ModelPort, ModelTurnRequest, ResearchSession } from "../loop/researchLoop";

export interface ReportSection {
  readonly heading: string;
  readonly instruction: string;
}

// Kept as data, not inline prose, so a future preset (e.g. an NGO-competitor report structure) is a
// config swap -- pass a different template array into buildSynthesizeRequest -- not a rewrite.
export const DEFAULT_REPORT_TEMPLATE: readonly ReportSection[] = [
  { heading: "In brief", instruction: "A 2-4 sentence plain-language summary of the answer." },
  { heading: "Key findings", instruction: "The most important findings, each as a bullet, each citing its source(s)." },
  { heading: "Analysis", instruction: "A few paragraphs synthesizing the findings into a coherent answer to the research question." },
  { heading: "Contradictions & uncertainty", instruction: "Note any conflicting sources or open sub-questions. If none, say so explicitly -- do not omit this section." },
  { heading: "Sources", instruction: "A numbered list of every source cited above, with its title and URL." },
];

export interface SynthesizeOptions {
  readonly model: ModelPort;
  readonly signal: AbortSignal;
  readonly partial: boolean;
  readonly template?: readonly ReportSection[];
}

const SYSTEM_PROMPT_PREFIX =
  "You are the SYNTHESIZE phase of a Deep Research assistant. Write a markdown report from the " +
  "research state below. Every factual claim must carry a citation tag like [S1] referencing a " +
  "source id from the SOURCES list; drop any claim you cannot support with a cited source. Follow " +
  "this section structure, in order, using the given heading text as markdown ## headings:";

function buildSystemPrompt(template: readonly ReportSection[], partial: boolean): string {
  const sections = template.map((s) => `## ${s.heading}\n${s.instruction}`).join("\n\n");
  const partialNote = partial
    ? "\n\nThis research run ended early and is INCOMPLETE. State plainly, near the top of the " +
      "report, what was not covered or left unanswered -- do not present it as a complete answer."
    : "";
  return `${SYSTEM_PROMPT_PREFIX}\n\n${sections}${partialNote}`;
}

function buildUserPrompt(state: ResearchSession): string {
  const subQuestionLines =
    state.subQuestions.map((sq) => `- [${sq.status}] ${sq.id}: ${sq.text}`).join("\n") || "(none)";
  const sourceLines =
    state.sources.map((s) => `${s.id}: ${s.title}${s.date ? ` (${s.date})` : ""} -- ${s.url}`).join("\n") || "(none)";
  const findingLines =
    state.findings.map((f) => `- (${f.sourceIds.join(", ") || "no source"}) ${f.text}`).join("\n") || "(none)";
  const comparisonLines =
    state.comparisons.map((c) => `- ${c.subject} (${c.conflict ? "CONFLICT" : "no conflict"}, sources ${c.sourceIds.join(", ")}): ${c.summary}`).join("\n") || "(none)";
  const calculationLines =
    state.calculations.map((c) => `- ${c.expression} = ${c.value}`).join("\n") || "(none)";

  return [
    `GOAL:\n${state.goal}`,
    `SUB-QUESTIONS:\n${subQuestionLines}`,
    `SOURCES:\n${sourceLines}`,
    `FINDINGS:\n${findingLines}`,
    `COMPARISONS:\n${comparisonLines}`,
    `CALCULATIONS:\n${calculationLines}`,
    "Write the report now.",
  ].join("\n\n");
}

function buildSynthesizeRequest(state: ResearchSession, partial: boolean, template: readonly ReportSection[]): ModelTurnRequest {
  return { systemPrompt: buildSystemPrompt(template, partial), userPrompt: buildUserPrompt(state) };
}

// A deterministic, non-model-authored report assembled straight from the session's data -- used
// only if the model call itself fails, so the pipeline always ends with something readable even in
// a worst-case total model failure. Not meant to be polished prose.
function buildFallbackReport(state: ResearchSession, partial: boolean): string {
  const lines = ["# Research Report (fallback -- model unavailable)", ""];
  lines.push(`**Goal:** ${state.goal}`);
  lines.push(`**Status:** ${partial ? "partial -- this run did not complete" : "complete"}`);
  lines.push("");

  lines.push("## Sub-questions");
  for (const sq of state.subQuestions) {
    lines.push(`- [${sq.status}] ${sq.text}`);
  }
  lines.push("");

  lines.push("## Findings");
  if (state.findings.length === 0) {
    lines.push("(none)");
  } else {
    for (const f of state.findings) {
      lines.push(`- [${f.sourceIds.join(", ") || "no source"}] ${f.text}`);
    }
  }
  lines.push("");

  lines.push("## Sources");
  if (state.sources.length === 0) {
    lines.push("(none)");
  } else {
    for (const s of state.sources) {
      lines.push(`- ${s.id}: ${s.title} -- ${s.url}`);
    }
  }

  return lines.join("\n");
}

export async function synthesize(finalState: ResearchSession, options: SynthesizeOptions): Promise<string> {
  const template = options.template ?? DEFAULT_REPORT_TEMPLATE;
  const request = buildSynthesizeRequest(finalState, options.partial, template);

  try {
    return await options.model.complete(request, options.signal);
  } catch {
    return buildFallbackReport(finalState, options.partial);
  }
}
