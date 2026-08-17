import { plan, type PlanCapabilities } from "./plan/planner";
import { synthesize } from "./synthesize/synthesize";
import {
  runResearchLoop,
  type Clock,
  type LoopConfig,
  type ModelPort,
  type ProgressEvent,
  type ResearchSession,
  type SubQuestion,
  type TerminationDecision,
  type ToolPort,
} from "./loop/researchLoop";

export interface RunDeepResearchInput {
  readonly topic: string;
  readonly providedUrls: readonly string[];
  readonly capabilities: PlanCapabilities;
  readonly model: ModelPort;
  readonly tool: ToolPort;
  readonly config: LoopConfig;
  readonly signal: AbortSignal;
  readonly clock?: Clock;
}

export interface RunDeepResearchResult {
  readonly subQuestions: readonly SubQuestion[];
  readonly finalState: ResearchSession;
  readonly termination: TerminationDecision;
  readonly report: string;
  readonly events: readonly ProgressEvent[];
}

// A plain sequential chain, no try/catch needed here: plan() never throws (falls back to a
// topic-mirroring sub-question), runResearchLoop() never throws (Stage-1 design -- it always
// terminates with a TerminationDecision, including on cancellation), and synthesize() never throws
// (falls back to a deterministic report). Cancellation isn't special-cased either -- it cascades
// naturally through all three, so even a cancelled run ends with an honest partial report instead
// of nothing.
export async function runDeepResearch(input: RunDeepResearchInput): Promise<RunDeepResearchResult> {
  const session = await plan(
    { topic: input.topic, providedUrls: input.providedUrls, capabilities: input.capabilities },
    input.model,
    input.signal,
  );

  const loopResult = await runResearchLoop(session, {
    model: input.model,
    tool: input.tool,
    clock: input.clock ?? Date.now,
    signal: input.signal,
    config: input.config,
  });

  const report = await synthesize(loopResult.finalState, {
    model: input.model,
    signal: input.signal,
    partial: loopResult.termination.partial,
  });

  return {
    subQuestions: loopResult.finalState.subQuestions,
    finalState: loopResult.finalState,
    termination: loopResult.termination,
    report,
    events: loopResult.events,
  };
}
