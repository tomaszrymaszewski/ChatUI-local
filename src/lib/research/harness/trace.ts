import type { ProgressEvent, ResearchSession, TerminationDecision } from "../loop/researchLoop";

// Structural, not the smoke/full harness's specific result type -- both SmokeResearchResult and
// RunDeepResearchResult carry these three fields (plus their own extras), so either satisfies this
// without an explicit cast.
export interface TraceableResult {
  readonly termination: TerminationDecision;
  readonly finalState: ResearchSession;
  readonly events: readonly ProgressEvent[];
}

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function printTrace(label: string, result: TraceableResult): void {
  const { finalState, events, termination } = result;
  console.group(`[research trace] ${label}`);

  let openUrlCursor = 0;
  let reflectActionCount = 0;
  let stepStartCount = 0;

  for (const event of events) {
    if (event.type === "step_start") {
      stepStartCount++;
      if (event.action === "reflect") reflectActionCount++;

      const extra = event.query ? ` query="${event.query}"` : event.url ? ` url="${event.url}"` : event.expression ? ` expr="${event.expression}"` : "";
      console.log(`step ${event.step}: ${event.action}${extra}`);

      if (event.action === "save_note") {
        const finding = finalState.findings.find((f) => f.createdAtStep === event.step);
        if (finding) console.log(`  -> note: ${truncate(finding.text)}`);
      } else if (event.action === "compare_sources") {
        const comparison = finalState.comparisons.find((c) => c.createdAtStep === event.step);
        if (comparison) console.log(`  -> comparison (conflict=${comparison.conflict}): ${truncate(comparison.summary)}`);
      } else if (event.action === "calculate") {
        const calculation = finalState.calculations.find((c) => c.createdAtStep === event.step);
        if (calculation) console.log(`  -> ${calculation.expression} = ${calculation.value}`);
      } else if (event.action === "open_url" || event.action === "read_pdf") {
        // Source has no createdAtStep tag (unlike Finding/Comparison/Calculation), so this is a
        // best-effort positional match, not exact — imprecise across cache hits.
        const source = finalState.sources[openUrlCursor];
        openUrlCursor++;
        console.log(source ? `  -> source (best-effort match): ${source.id} "${source.title}"` : "  -> no matching source (likely a cache hit or fetch error)");
      }
    } else if (event.type === "note_saved") {
      console.log(`  [note saved for step ${event.step}, targets ${event.subQuestionId ?? "(none)"}]`);
    } else if (event.type === "round_boundary") {
      console.log(`-- round ${event.round}/${event.maxRounds}: ${truncate(event.focus, 120)} --`);
    } else if (event.type === "termination") {
      console.log(`[termination] ${event.reason} (partial=${event.partial})`);
    }
  }

  console.log("--- summary ---");
  console.log(`termination: ${termination.reason} (partial=${termination.partial})`);
  console.log(`finalAnswerDraft: ${finalState.finalAnswerDraft ? truncate(finalState.finalAnswerDraft, 500) : "(none)"}`);
  console.log(`sources=${finalState.sources.length} findings=${finalState.findings.length} comparisons=${finalState.comparisons.length} calculations=${finalState.calculations.length}`);
  for (const sq of finalState.subQuestions) {
    console.log(`  sub-question ${sq.id}: ${sq.status} — ${sq.text}`);
  }
  console.log(
    `reflect-action rate (proxy, NOT a true retry-attempt count — requestAction's internal ` +
      `retries are private to researchLoop.ts and not observable from outside it): ` +
      `${reflectActionCount}/${stepStartCount}`,
  );

  console.groupEnd();
}
