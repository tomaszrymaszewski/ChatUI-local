// Deep Research state machine: PLAN -> (RESEARCH round -> ASSESS gaps) x N -> SYNTHESIZE -> DONE
//
// The LLM/search calls (planner, researchRound, synthesize) are injected so this
// loop is pure, testable logic. Phase 2 wires real Anthropic + web_search calls
// into these same function shapes.

import { QueryDedup } from "./dedup";
import {
  DEFAULT_RESEARCH_CONFIG,
  DEFAULT_RESEARCH_CONTEXT,
  type PlannerFn,
  type ProgressEvent,
  type ResearchConfig,
  type ResearchContext,
  type ResearchRoundFn,
  type ResearchSession,
  type SynthesizeFn,
} from "./types";

export class CancelledError extends Error {
  constructor() {
    super("Research session was cancelled");
    this.name = "CancelledError";
  }
}

export class TimeoutError extends Error {
  constructor() {
    super("Deadline exceeded");
    this.name = "TimeoutError";
  }
}

/**
 * Races `run` against the caller's abort signal AND a real timer for
 * `remainingMs`, whichever fires first. `run` receives its own AbortSignal
 * (aborted on either timeout or external cancellation) so well-behaved
 * implementations (e.g. fetch-based Phase 2 calls) can cancel their network
 * request promptly instead of being silently abandoned.
 *
 * This is a hard bound on the orchestrator's wait, independent of whether
 * `run` itself ever notices the abort — a misbehaving/never-resolving `run`
 * still can't block the loop past `remainingMs`.
 */
async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  externalSignal: AbortSignal,
  remainingMs: number,
): Promise<T> {
  if (externalSignal.aborted) throw new CancelledError();
  if (remainingMs <= 0) throw new TimeoutError();

  const internalController = new AbortController();
  const runPromise = run(internalController.signal);
  runPromise.catch(() => {}); // may be abandoned below; don't let it become an unhandled rejection

  let timer: ReturnType<typeof setTimeout>;
  let onExternalAbort: () => void;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      internalController.abort();
      reject(new TimeoutError());
    }, remainingMs);
  });

  const cancelPromise = new Promise<never>((_, reject) => {
    onExternalAbort = () => {
      internalController.abort();
      reject(new CancelledError());
    };
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  });

  try {
    return await Promise.race([runPromise, timeoutPromise, cancelPromise]);
  } finally {
    clearTimeout(timer!);
    externalSignal.removeEventListener("abort", onExternalAbort!);
  }
}

export interface RunResearchSessionArgs {
  topic: string;
  ourOrgContext?: string;
  config?: Partial<ResearchConfig>;
  /** Defaults to { mode: "search" } — omit entirely for the existing search-based paths. */
  context?: ResearchContext;
  planner: PlannerFn;
  researchRound: ResearchRoundFn;
  synthesize: SynthesizeFn;
  onProgress?: (event: ProgressEvent) => void;
  signal: AbortSignal;
}

export interface RunResearchSessionResult {
  session: ResearchSession;
  /** Final markdown report. Null only if nothing was ever produced (cancelled/errored before any synthesis output). */
  report: string | null;
}

export async function runResearchSession(
  args: RunResearchSessionArgs,
): Promise<RunResearchSessionResult> {
  const { topic, ourOrgContext, planner, researchRound, synthesize, onProgress, signal } = args;
  const config: ResearchConfig = { ...DEFAULT_RESEARCH_CONFIG, ...args.config };
  const context: ResearchContext = args.context ?? DEFAULT_RESEARCH_CONTEXT;
  const emit = (event: ProgressEvent) => onProgress?.(event);

  const session: ResearchSession = {
    topic,
    ourOrgContext,
    plan: [],
    rounds: [],
    findings: [],
    sources: [],
    gaps: [],
    phase: "planning",
    notes: [],
  };

  // Bounds the planning + research-round phases only. Synthesis is deliberately
  // exempt: by the time it starts, most of the budget is already spent, it's a
  // single streamed call (not fan-out), and cutting it off would discard the one
  // thing the whole run exists to produce. The user's Cancel signal still applies
  // to synthesis (see the for-await loop below) — just not this timer.
  const deadline = Date.now() + config.globalTimeoutMs;
  const dedup = new QueryDedup();
  const seenSourceUrls = new Set<string>();
  let totalTokensUsed = 0;

  emit({ type: "planning" });
  let plannerResult;
  try {
    plannerResult = await withDeadline(
      (boundedSignal) => planner(topic, ourOrgContext, boundedSignal),
      signal,
      deadline - Date.now(),
    );
  } catch (error) {
    if (error instanceof CancelledError) {
      session.phase = "cancelled";
      emit({ type: "cancelled", session });
      return { session, report: null };
    }
    session.phase = "error";
    const message =
      error instanceof TimeoutError
        ? `Timed out while planning (budget: ${config.globalTimeoutMs}ms)`
        : error instanceof Error
          ? error.message
          : String(error);
    emit({ type: "error", message, session });
    return { session, report: null };
  }

  session.plan = plannerResult.plan;
  session.gaps = [...plannerResult.plan];
  session.phase = "researching";

  let pendingQueries = dedup
    .filterNew(plannerResult.initialQueries)
    .slice(0, config.maxQueriesPerRound);

  for (let roundIndex = 0; roundIndex < config.maxRounds; roundIndex++) {
    if (signal.aborted) {
      session.phase = "cancelled";
      emit({ type: "cancelled", session });
      return { session, report: null };
    }

    // Termination: no open gaps left.
    if (session.gaps.length === 0) break;
    // Termination: global timeout / token ceiling reached — go synthesize with what we have.
    const remaining = deadline - Date.now();
    if (remaining <= 0 || totalTokensUsed >= config.maxOutputTokens) break;

    if (pendingQueries.length === 0) {
      pendingQueries = dedup
        .filterNew(session.gaps.map((gap) => gap.question))
        .slice(0, config.maxQueriesPerRound);
      // Termination: nothing new left to search for.
      if (pendingQueries.length === 0) break;
    }
    dedup.markSeen(pendingQueries);

    const label = session.gaps[0]?.section ?? "general";
    emit({ type: "round_start", round: roundIndex + 1, maxRounds: config.maxRounds, label });

    let result;
    try {
      result = await withDeadline(
        (boundedSignal) =>
          researchRound(topic, session.gaps, pendingQueries, roundIndex, context, boundedSignal),
        signal,
        deadline - Date.now(),
      );
    } catch (error) {
      if (error instanceof CancelledError) {
        session.phase = "cancelled";
        emit({ type: "cancelled", session });
        return { session, report: null };
      }
      // A round timing out or throwing degrades gracefully: keep whatever prior
      // rounds found, note the failure for the synthesizer, and stop researching.
      const message =
        error instanceof TimeoutError
          ? `Round ${roundIndex + 1} timed out and was skipped.`
          : `Round ${roundIndex + 1} failed and was skipped: ${error instanceof Error ? error.message : String(error)}`;
      session.notes.push(message);
      emit({ type: "round_end", round: roundIndex + 1, newSourceCount: 0, remainingGaps: session.gaps.length });
      break;
    }

    const newSources = result.newSources.filter((source) => !seenSourceUrls.has(source.url));
    newSources.forEach((source) => seenSourceUrls.add(source.url));
    totalTokensUsed += result.tokensUsed;

    session.rounds.push({
      index: roundIndex,
      queries: pendingQueries,
      findings: result.findings,
      newSources,
      gapsAddressed: result.resolvedGaps,
      tokensUsed: result.tokensUsed,
    });
    session.findings.push(...result.findings);
    session.sources.push(...newSources);
    session.gaps = session.gaps
      .filter((gap) => !result.resolvedGaps.includes(gap.question))
      .concat(result.newGaps);

    emit({
      type: "round_end",
      round: roundIndex + 1,
      newSourceCount: newSources.length,
      remainingGaps: session.gaps.length,
    });

    // Termination: diminishing returns — this round found nothing new.
    if (newSources.length === 0 && result.resolvedGaps.length === 0) break;

    pendingQueries = dedup
      .filterNew(result.newGaps.map((gap) => gap.question))
      .slice(0, config.maxQueriesPerRound);
  }

  if (signal.aborted) {
    session.phase = "cancelled";
    emit({ type: "cancelled", session });
    return { session, report: null };
  }

  session.phase = "synthesizing";
  emit({ type: "synthesizing" });

  let report = "";
  let cancelledDuringSynthesis = false;
  try {
    for await (const chunk of synthesize(session, signal)) {
      report += chunk;
      emit({ type: "synthesis_chunk", chunk, accumulated: report });
      // Stop asking for more chunks as soon as cancellation is noticed, even if
      // the generator itself never throws — don't rely solely on the callee to
      // honor the signal. (A chunk already in hand when abort() fires may still
      // land here; the generator's own next `yield` after that point does not.)
      if (signal.aborted) {
        cancelledDuringSynthesis = true;
        break;
      }
    }
  } catch (error) {
    if (signal.aborted) {
      // Cancelled mid-stream: keep whatever was already rendered, same as the
      // existing chat's abort behavior (partial content is still persisted).
      session.phase = "cancelled";
      emit({ type: "cancelled", session });
      return { session, report: report.length > 0 ? report : null };
    }
    session.phase = "error";
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "error", message, session });
    return { session, report: report.length > 0 ? report : null };
  }

  if (cancelledDuringSynthesis) {
    session.phase = "cancelled";
    emit({ type: "cancelled", session });
    return { session, report: report.length > 0 ? report : null };
  }

  session.phase = "done";
  emit({ type: "done", session });
  return { session, report };
}
