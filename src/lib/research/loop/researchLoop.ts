import {
  assertNever,
  describeActionError,
  parseAndValidateAction,
  toSourceId,
  type ModelAction,
  type ActionName,
  type SourceId,
  type SubQuestionId,
  type ValidationContext,
  type Result,
} from "./actions";
import { evaluateExpression, type CalcError } from "./calculate";

// ---------------------------------------------------------------------------
// State types (minimal — this stage owns them; a future Phase-1 orchestrator
// stage should extend this interface, not duplicate it, when it adds
// PLAN/RESEARCH/SYNTHESIZE/DONE-level fields).
// ---------------------------------------------------------------------------

export type SubQuestionStatus = "open" | "partial" | "done";

export interface SubQuestion {
  readonly id: SubQuestionId;
  readonly text: string;
  readonly status: SubQuestionStatus;
}

export interface Source {
  readonly id: SourceId;
  readonly url: string;
  readonly title: string;
  readonly date: string | null;
  readonly body: string;
  readonly fetchedAt: number;
}

export type FindingId = string & { readonly __brand: "FindingId" };
export function toFindingId(raw: string): FindingId {
  return raw as FindingId;
}

export interface Finding {
  readonly id: FindingId;
  readonly text: string;
  readonly sourceIds: readonly SourceId[];
  readonly tags: readonly string[];
  readonly targetsSubQ: SubQuestionId | null;
  readonly createdAtStep: number;
  readonly createdAt: number;
}

export type ComparisonId = string & { readonly __brand: "ComparisonId" };
export function toComparisonId(raw: string): ComparisonId {
  return raw as ComparisonId;
}

export interface Comparison {
  readonly id: ComparisonId;
  readonly subject: string;
  readonly sourceIds: readonly SourceId[];
  readonly summary: string;
  readonly conflict: boolean;
  readonly createdAtStep: number;
  readonly createdAt: number;
}

export type CalculationId = string & { readonly __brand: "CalculationId" };
export function toCalculationId(raw: string): CalculationId {
  return raw as CalculationId;
}

export interface Calculation {
  readonly id: CalculationId;
  readonly expression: string;
  readonly value: number;
  readonly createdAtStep: number;
  readonly createdAt: number;
}

export interface WebSearchHit {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

export interface CandidateUrl {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly query: string;
}

interface CachedSearch {
  readonly hits: readonly WebSearchHit[];
  readonly firstSeenStep: number;
}

export type Observation =
  | { readonly kind: "web_search_results"; readonly query: string; readonly hits: readonly WebSearchHit[]; readonly alreadySearched: boolean }
  | { readonly kind: "source_fetched"; readonly source: Source; readonly alreadyCached: boolean }
  | { readonly kind: "page_search_results"; readonly sourceId: SourceId; readonly matches: readonly string[] }
  | { readonly kind: "note_saved"; readonly findingId: FindingId }
  | { readonly kind: "comparison_saved"; readonly comparisonId: ComparisonId; readonly conflict: boolean }
  | { readonly kind: "calculation_result"; readonly expression: string; readonly value: number }
  | { readonly kind: "calculation_error"; readonly expression: string; readonly error: CalcError }
  | { readonly kind: "reflection_ack" }
  | { readonly kind: "answer_drafted" }
  | { readonly kind: "tool_error"; readonly action: ActionName; readonly error: string; readonly suggestion: string }
  | { readonly kind: "cancelled" };

export type ToolOutput = Observation;

export interface ResearchSession {
  readonly goal: string;
  readonly subQuestions: readonly SubQuestion[];
  readonly sources: readonly Source[];
  readonly findings: readonly Finding[];
  readonly comparisons: readonly Comparison[];
  readonly contradictions: readonly Comparison[];
  readonly calculations: readonly Calculation[];
  readonly candidateUrls: readonly CandidateUrl[];
  readonly step: number;
  readonly round: number;
  readonly searchCache: Readonly<Record<string, CachedSearch>>;
  readonly urlCache: Readonly<Record<string, SourceId>>;
  readonly noProgressStreak: number;
  readonly diminishingReturnsReflectionUsed: boolean;
  readonly finalAnswerDraft: string | null;
  readonly lastObservation: Observation | null;
}

export function createInitialSession(goal: string, subQuestions: readonly SubQuestion[]): ResearchSession {
  return {
    goal,
    subQuestions,
    sources: [],
    findings: [],
    comparisons: [],
    contradictions: [],
    calculations: [],
    candidateUrls: [],
    step: 0,
    round: 0,
    searchCache: {},
    urlCache: {},
    noProgressStreak: 0,
    diminishingReturnsReflectionUsed: false,
    finalAnswerDraft: null,
    lastObservation: null,
  };
}

// ---------------------------------------------------------------------------
// Ports (dependency injection — no real implementation lives in this stage)
// ---------------------------------------------------------------------------

export interface ModelTurnRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface ModelPort {
  complete(request: ModelTurnRequest, signal: AbortSignal): Promise<string>;
}

export interface FetchedPage {
  readonly title: string;
  readonly date: string | null;
  readonly body: string;
}

export interface ToolPort {
  webSearch(query: string, signal: AbortSignal): Promise<readonly WebSearchHit[]>;
  openUrl(url: string, signal: AbortSignal): Promise<FetchedPage>;
  readPdf(url: string, signal: AbortSignal): Promise<FetchedPage>;
  searchInPage(sourceId: SourceId, query: string, signal: AbortSignal): Promise<readonly string[]>;
}

export type Clock = () => number;

// ---------------------------------------------------------------------------
// Constants (§9 — all named, all consumed via LoopConfig, never inlined)
// ---------------------------------------------------------------------------

export const STEP_BUDGET = { quick: 6, standard: 15, deep: 40 } as const;
export const REFLECT_EVERY = 4;
export const MAX_ROUNDS = 5;
export const K_DIMINISHING = 3;
export const CONF_DONE = 0.8;
export const MAX_OPEN_ON_FINISH = 1;
export const TOOL_TIMEOUT_MS = 15_000;
export const MAX_FETCHES = 20;
export const MAX_PAGE_TOKENS = 8_000;
export const MAX_PARSE_RETRIES = 2;
export const NOTE_DIGEST_COUNT = 5;
export const MAX_OBSERVATION_CHARS = 2_000;

export interface LoopConfig {
  readonly stepBudget: number;
  readonly reflectEvery: number;
  readonly maxRounds: number;
  readonly kDiminishing: number;
  readonly confDone: number;
  readonly maxOpenOnFinish: number;
  readonly toolTimeoutMs: number;
  readonly maxFetches: number;
  readonly maxPageTokens: number;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  stepBudget: STEP_BUDGET.standard,
  reflectEvery: REFLECT_EVERY,
  maxRounds: MAX_ROUNDS,
  kDiminishing: K_DIMINISHING,
  confDone: CONF_DONE,
  maxOpenOnFinish: MAX_OPEN_ON_FINISH,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  maxFetches: MAX_FETCHES,
  maxPageTokens: MAX_PAGE_TOKENS,
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<SubQuestionStatus, number> = { open: 0, partial: 1, done: 2 };

export function advanceStatus(current: SubQuestionStatus, proposed: SubQuestionStatus): SubQuestionStatus {
  return STATUS_RANK[proposed] > STATUS_RANK[current] ? proposed : current;
}

function openSubQCount(state: ResearchSession): number {
  return state.subQuestions.filter((sq) => sq.status !== "done").length;
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, "").toLowerCase();
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

const SYSTEM_PROMPT =
  "You are the RESEARCH-phase agent of a Deep Research assistant. Each turn, review the " +
  "current state and reply with exactly one JSON action object matching the action protocol. " +
  "No prose outside the JSON.";

export function buildTurnContext(state: ResearchSession, config: LoopConfig): ModelTurnRequest {
  const planLines = state.subQuestions.map((sq) => `- [${sq.status}] ${sq.id}: ${sq.text}`).join("\n") || "(none)";
  const sourceLines = state.sources.map((s) => `${s.id}: ${s.title}${s.date ? ` (${s.date})` : ""}`).join("\n") || "(none)";
  const noteDigest =
    state.findings
      .slice(-NOTE_DIGEST_COUNT)
      .map((f) => `- ${f.text}`)
      .join("\n") || "(none)";
  const openGaps = state.subQuestions.filter((sq) => sq.status !== "done").map((sq) => sq.id).join(", ") || "none";
  const lastObservationText = state.lastObservation
    ? truncate(JSON.stringify(state.lastObservation), MAX_OBSERVATION_CHARS)
    : "(none yet)";

  const userPrompt = [
    `GOAL: ${state.goal}`,
    `PLAN:\n${planLines}`,
    `SOURCES (${state.sources.length} total):\n${sourceLines}`,
    `RECENT NOTES (${state.findings.length} total, showing last ${NOTE_DIGEST_COUNT}):\n${noteDigest}`,
    `OPEN GAPS: ${openGaps}`,
    `BUDGET: step ${state.step} of ${config.stepBudget}`,
    `LAST OBSERVATION: ${lastObservationText}`,
    "Respond with exactly one JSON action object as specified.",
  ].join("\n\n");

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}

function applyAction(state: ResearchSession, action: ModelAction, toolOutput: ToolOutput, clock: Clock): ResearchSession {
  switch (action.action) {
    case "web_search": {
      if (toolOutput.kind !== "web_search_results") return state;
      const cacheKey = normalizeQuery(action.args.query);
      const existingUrls = new Set(state.candidateUrls.map((c) => c.url));
      const newCandidates: CandidateUrl[] = toolOutput.hits
        .filter((hit) => !existingUrls.has(hit.url))
        .map((hit) => ({ url: hit.url, title: hit.title, snippet: hit.snippet, query: action.args.query }));
      return {
        ...state,
        candidateUrls: [...state.candidateUrls, ...newCandidates],
        searchCache: toolOutput.alreadySearched
          ? state.searchCache
          : { ...state.searchCache, [cacheKey]: { hits: toolOutput.hits, firstSeenStep: state.step } },
      };
    }
    case "open_url":
    case "read_pdf": {
      if (toolOutput.kind !== "source_fetched") return state;
      if (toolOutput.alreadyCached) return state;
      const normalizedUrl = normalizeUrl(action.args.url);
      return {
        ...state,
        sources: [...state.sources, toolOutput.source],
        urlCache: { ...state.urlCache, [normalizedUrl]: toolOutput.source.id },
      };
    }
    case "search_in_page":
      return state;
    case "save_note": {
      if (toolOutput.kind !== "note_saved") return state;
      const finding: Finding = {
        id: toolOutput.findingId,
        text: action.args.text,
        sourceIds: action.args.sourceIds,
        tags: action.args.tags,
        targetsSubQ: action.targetsSubQ,
        createdAtStep: state.step,
        createdAt: clock(),
      };
      const subQuestions = action.targetsSubQ
        ? state.subQuestions.map((sq) =>
            sq.id === action.targetsSubQ ? { ...sq, status: advanceStatus(sq.status, action.args.subqStatus ?? "partial") } : sq,
          )
        : state.subQuestions;
      return { ...state, findings: [...state.findings, finding], subQuestions };
    }
    case "compare_sources": {
      if (toolOutput.kind !== "comparison_saved") return state;
      const comparison: Comparison = {
        id: toolOutput.comparisonId,
        subject: action.args.subject,
        sourceIds: action.args.sourceIds,
        summary: action.args.summary,
        conflict: action.args.conflict,
        createdAtStep: state.step,
        createdAt: clock(),
      };
      return {
        ...state,
        comparisons: [...state.comparisons, comparison],
        contradictions: action.args.conflict ? [...state.contradictions, comparison] : state.contradictions,
      };
    }
    case "calculate": {
      if (toolOutput.kind !== "calculation_result") return state;
      const calculation: Calculation = {
        id: toCalculationId(`C${state.calculations.length + 1}`),
        expression: toolOutput.expression,
        value: toolOutput.value,
        createdAtStep: state.step,
        createdAt: clock(),
      };
      return { ...state, calculations: [...state.calculations, calculation] };
    }
    case "reflect":
      return state;
    case "write_answer":
      return { ...state, finalAnswerDraft: action.args.summary };
    default:
      return assertNever(action, "applyAction");
  }
}

export function foldState(state: ResearchSession, action: ModelAction, toolOutput: ToolOutput, clock: Clock): ResearchSession {
  const stepped = { ...state, step: state.step + 1 };
  const folded = applyAction(stepped, action, toolOutput, clock);
  const madeProgress = folded.sources.length > state.sources.length || folded.findings.length > state.findings.length;

  return {
    ...folded,
    lastObservation: toolOutput,
    noProgressStreak: madeProgress ? 0 : stepped.noProgressStreak + 1,
    diminishingReturnsReflectionUsed: madeProgress ? false : folded.diminishingReturnsReflectionUsed,
  };
}

export type TerminationReason =
  | "write_answer_confirmed"
  | "all_subquestions_done"
  | "step_budget_reached"
  | "diminishing_returns"
  | "max_rounds_exceeded"
  | "cancelled";

export interface TerminationDecision {
  readonly reason: TerminationReason;
  readonly partial: boolean;
}

export function checkTermination(
  state: ResearchSession,
  action: ModelAction,
  config: LoopConfig,
  cancelled: boolean,
): TerminationDecision | null {
  if (cancelled) return { reason: "cancelled", partial: true };

  if (action.action === "write_answer" && action.confidence >= config.confDone && openSubQCount(state) <= config.maxOpenOnFinish) {
    return { reason: "write_answer_confirmed", partial: false };
  }

  if (state.subQuestions.length > 0 && openSubQCount(state) === 0) {
    return { reason: "all_subquestions_done", partial: false };
  }

  if (state.step >= config.stepBudget) {
    return { reason: "step_budget_reached", partial: true };
  }

  if (state.round > config.maxRounds) {
    return { reason: "max_rounds_exceeded", partial: true };
  }

  if (state.diminishingReturnsReflectionUsed && state.noProgressStreak >= config.kDiminishing) {
    return { reason: "diminishing_returns", partial: true };
  }

  return null;
}

export interface ReflectionTrigger {
  readonly forced: boolean;
  readonly reason: "round_boundary" | "model_requested" | "diminishing_returns" | "premature_finalize_guard";
}

export function checkReflectionTrigger(state: ResearchSession, action: ModelAction, config: LoopConfig): ReflectionTrigger | null {
  if (action.action === "write_answer" && action.confidence >= config.confDone && openSubQCount(state) > config.maxOpenOnFinish) {
    return { forced: true, reason: "premature_finalize_guard" };
  }

  if (state.noProgressStreak >= config.kDiminishing && !state.diminishingReturnsReflectionUsed) {
    return { forced: true, reason: "diminishing_returns" };
  }

  if (action.action === "reflect") {
    return { forced: false, reason: "model_requested" };
  }

  if (state.step > 0 && state.step % config.reflectEvery === 0) {
    return { forced: false, reason: "round_boundary" };
  }

  return null;
}

export type ProgressEvent =
  | { readonly type: "step_start"; readonly step: number; readonly action: ActionName; readonly query?: string; readonly url?: string; readonly expression?: string }
  | { readonly type: "note_saved"; readonly step: number; readonly subQuestionId: SubQuestionId | null }
  | { readonly type: "round_boundary"; readonly round: number; readonly maxRounds: number; readonly focus: string }
  | { readonly type: "termination"; readonly reason: TerminationReason; readonly partial: boolean };

function extractActionExtras(action: ModelAction): { query?: string; url?: string; expression?: string } {
  switch (action.action) {
    case "web_search":
      return { query: action.args.query };
    case "search_in_page":
      return { query: action.args.query };
    case "open_url":
    case "read_pdf":
      return { url: action.args.url };
    case "calculate":
      return { expression: action.args.expression };
    case "save_note":
    case "compare_sources":
    case "reflect":
    case "write_answer":
      return {};
    default:
      return assertNever(action, "extractActionExtras");
  }
}

export function buildProgressEvents(
  action: ModelAction,
  toolOutput: ToolOutput,
  state: ResearchSession,
  reflection: ReflectionTrigger | null,
  config: LoopConfig,
): ProgressEvent[] {
  const events: ProgressEvent[] = [{ type: "step_start", step: state.step, action: action.action, ...extractActionExtras(action) }];

  if (toolOutput.kind === "note_saved") {
    events.push({ type: "note_saved", step: state.step, subQuestionId: action.targetsSubQ });
  }

  if (reflection?.reason === "round_boundary") {
    events.push({ type: "round_boundary", round: state.round, maxRounds: config.maxRounds, focus: action.thought });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Impure shell — the only code in this file that touches I/O
// ---------------------------------------------------------------------------

const CANCELLED = "cancelled" as const;

async function callWithTimeoutAndRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  outerSignal: AbortSignal,
  timeoutMs: number,
): Promise<Result<T, string>> {
  const attempt = async (): Promise<Result<T, string>> => {
    if (outerSignal.aborted) return { ok: false, error: CANCELLED };

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const onOuterAbort = () => timeoutController.abort();
    outerSignal.addEventListener("abort", onOuterAbort);

    try {
      const value = await fn(timeoutController.signal);
      return { ok: true, value };
    } catch (error) {
      if (outerSignal.aborted) return { ok: false, error: CANCELLED };
      return { ok: false, error: error instanceof Error ? error.message : "tool call failed" };
    } finally {
      clearTimeout(timer);
      outerSignal.removeEventListener("abort", onOuterAbort);
    }
  };

  const first = await attempt();
  if (first.ok || first.error === CANCELLED) return first;
  return attempt();
}

export interface IterationDeps {
  readonly model: ModelPort;
  readonly tool: ToolPort;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly config: LoopConfig;
}

async function requestAction(state: ResearchSession, deps: IterationDeps, baseRequest: ModelTurnRequest): Promise<ModelAction> {
  const validationContext: ValidationContext = {
    existingSourceIds: new Set(state.sources.map((s) => s.id)),
    existingSubQuestionIds: new Set(state.subQuestions.map((sq) => sq.id)),
  };

  let currentRequest = baseRequest;
  const maxAttempts = 1 + MAX_PARSE_RETRIES;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let raw: string | null = null;
    try {
      raw = await deps.model.complete(currentRequest, deps.signal);
    } catch {
      // A cancellation-triggered rejection should stop the ladder immediately, not spend
      // remaining attempts re-issuing a request against a signal that's already aborted --
      // runIteration's own cancellation check right after this call still catches it either
      // way, but bailing out here avoids wasted retries and gets cancellation to take effect
      // sooner.
      if (deps.signal.aborted) break;
      continue;
    }

    const result = parseAndValidateAction(raw, validationContext);
    if (result.ok) return result.value;

    currentRequest = { ...baseRequest, userPrompt: `${baseRequest.userPrompt}\n\n${describeActionError(result.error)}` };
  }

  return { thought: "Repeated invalid output from the model; reflecting instead.", action: "reflect", args: {}, targetsSubQ: null, confidence: 0 };
}

async function dispatchTool(action: ModelAction, state: ResearchSession, deps: IterationDeps): Promise<ToolOutput> {
  switch (action.action) {
    case "web_search": {
      const cacheKey = normalizeQuery(action.args.query);
      const cached = state.searchCache[cacheKey];
      if (cached) {
        return { kind: "web_search_results", query: action.args.query, hits: cached.hits, alreadySearched: true };
      }
      const outcome = await callWithTimeoutAndRetry((signal) => deps.tool.webSearch(action.args.query, signal), deps.signal, deps.config.toolTimeoutMs);
      if (!outcome.ok) {
        if (outcome.error === CANCELLED) return { kind: "cancelled" };
        return { kind: "tool_error", action: "web_search", error: outcome.error, suggestion: "reformulate the query or try a different angle" };
      }
      return { kind: "web_search_results", query: action.args.query, hits: outcome.value, alreadySearched: false };
    }
    case "open_url":
    case "read_pdf": {
      const url = action.args.url;
      const normalizedUrl = normalizeUrl(url);
      const cachedId = state.urlCache[normalizedUrl];
      if (cachedId) {
        const cachedSource = state.sources.find((s) => s.id === cachedId);
        if (cachedSource) return { kind: "source_fetched", source: cachedSource, alreadyCached: true };
      }
      if (state.sources.length >= deps.config.maxFetches) {
        return { kind: "tool_error", action: action.action, error: "fetch limit reached", suggestion: "reformulate / try another source" };
      }
      const fetchFn = action.action === "open_url" ? deps.tool.openUrl.bind(deps.tool) : deps.tool.readPdf.bind(deps.tool);
      const outcome = await callWithTimeoutAndRetry((signal) => fetchFn(url, signal), deps.signal, deps.config.toolTimeoutMs);
      if (!outcome.ok) {
        if (outcome.error === CANCELLED) return { kind: "cancelled" };
        return { kind: "tool_error", action: action.action, error: outcome.error, suggestion: "reformulate / try another source" };
      }
      const fetched = outcome.value;
      const newSource: Source = {
        id: toSourceId(`S${state.sources.length + 1}`),
        url,
        title: fetched.title,
        date: fetched.date,
        body: fetched.body.slice(0, deps.config.maxPageTokens),
        fetchedAt: deps.clock(),
      };
      return { kind: "source_fetched", source: newSource, alreadyCached: false };
    }
    case "search_in_page": {
      const outcome = await callWithTimeoutAndRetry(
        (signal) => deps.tool.searchInPage(action.args.sourceId, action.args.query, signal),
        deps.signal,
        deps.config.toolTimeoutMs,
      );
      if (!outcome.ok) {
        if (outcome.error === CANCELLED) return { kind: "cancelled" };
        return { kind: "tool_error", action: "search_in_page", error: outcome.error, suggestion: "reformulate / try another source" };
      }
      return { kind: "page_search_results", sourceId: action.args.sourceId, matches: outcome.value };
    }
    case "save_note":
      return { kind: "note_saved", findingId: toFindingId(`F${state.findings.length + 1}`) };
    case "compare_sources":
      return { kind: "comparison_saved", comparisonId: toComparisonId(`C${state.comparisons.length + 1}`), conflict: action.args.conflict };
    case "calculate": {
      const evalResult = evaluateExpression(action.args.expression);
      if (!evalResult.ok) return { kind: "calculation_error", expression: action.args.expression, error: evalResult.error };
      return { kind: "calculation_result", expression: action.args.expression, value: evalResult.value };
    }
    case "reflect":
      return { kind: "reflection_ack" };
    case "write_answer":
      return { kind: "answer_drafted" };
    default:
      return assertNever(action, "dispatchTool");
  }
}

export interface IterationResult {
  readonly state: ResearchSession;
  readonly events: readonly ProgressEvent[];
  readonly termination: TerminationDecision | null;
}

function cancelledResult(state: ResearchSession): IterationResult {
  const termination: TerminationDecision = { reason: "cancelled", partial: true };
  return { state, events: [{ type: "termination", reason: termination.reason, partial: termination.partial }], termination };
}

export async function runIteration(state: ResearchSession, deps: IterationDeps): Promise<IterationResult> {
  if (deps.signal.aborted) return cancelledResult(state);

  const request = buildTurnContext(state, deps.config);
  const action = await requestAction(state, deps, request);

  if (deps.signal.aborted) return cancelledResult(state);

  const toolOutput = await dispatchTool(action, state, deps);
  if (toolOutput.kind === "cancelled") return cancelledResult(state);

  const nextState = foldState(state, action, toolOutput, deps.clock);

  const reflection = checkReflectionTrigger(nextState, action, deps.config);
  const termination = checkTermination(nextState, action, deps.config, deps.signal.aborted);

  let adjustedState = nextState;
  if (reflection?.reason === "round_boundary") {
    adjustedState = { ...adjustedState, round: adjustedState.round + 1 };
  }
  if (reflection?.reason === "diminishing_returns") {
    adjustedState = { ...adjustedState, diminishingReturnsReflectionUsed: true };
  }

  const events = buildProgressEvents(action, toolOutput, adjustedState, reflection, deps.config);
  if (termination) {
    events.push({ type: "termination", reason: termination.reason, partial: termination.partial });
  }

  return { state: adjustedState, events, termination };
}

export interface LoopResult {
  readonly finalState: ResearchSession;
  readonly events: readonly ProgressEvent[];
  readonly termination: TerminationDecision;
}

export async function runResearchLoop(initialState: ResearchSession, deps: IterationDeps): Promise<LoopResult> {
  let state = initialState;
  const events: ProgressEvent[] = [];
  const safetyCap = deps.config.stepBudget + deps.config.reflectEvery * (deps.config.maxRounds + 2);

  for (let iterations = 0; iterations < safetyCap; iterations++) {
    const result = await runIteration(state, deps);
    state = result.state;
    events.push(...result.events);
    if (result.termination) {
      return { finalState: state, events, termination: result.termination };
    }
  }

  const forced: TerminationDecision = { reason: "step_budget_reached", partial: true };
  events.push({ type: "termination", reason: forced.reason, partial: forced.partial });
  return { finalState: state, events, termination: forced };
}
