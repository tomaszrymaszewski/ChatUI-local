import { extractFirstJsonObject, toSubQuestionId, type Result } from "../loop/actions";
import {
  createInitialSession,
  type ModelPort,
  type ModelTurnRequest,
  type ResearchSession,
  type SubQuestion,
} from "../loop/researchLoop";

export interface PlanCapabilities {
  readonly webSearch: boolean;
}

export interface PlanInput {
  readonly topic: string;
  readonly providedUrls: readonly string[];
  readonly capabilities: PlanCapabilities;
  /** Prose already extracted from uploaded files/URLs (e.g. via buildResearchSeed) -- folded into
   *  the goal as grounding material. Does not reach buildPlanRequest's sub-question decomposition
   *  call, only the loop's ongoing context. */
  readonly seedText?: string;
  /** Framing context (e.g. "we are Acme Corp") -- folded into the goal, up front. */
  readonly orgContext?: string;
}

interface PlanResponse {
  readonly subQuestions: readonly string[];
  readonly strategy: string;
}

type PlanParseError =
  | { readonly kind: "invalid_json"; readonly message: string }
  | { readonly kind: "schema_invalid"; readonly message: string };

const SYSTEM_PROMPT =
  "You are the PLAN phase of a Deep Research assistant. Given a topic, decompose it into 3-8 " +
  "concrete, non-overlapping sub-questions that together would thoroughly answer it, plus a short " +
  "strategy for how to research them. Respond with exactly one JSON object: " +
  '{"subQuestions": ["...", "..."], "strategy": "..."}. No prose outside the JSON.';

function buildPlanRequest(input: PlanInput): ModelTurnRequest {
  const urlsLine =
    input.providedUrls.length > 0
      ? `Provided URLs:\n${input.providedUrls.map((u) => `- ${u}`).join("\n")}`
      : "No URLs were provided.";
  const searchLine = input.capabilities.webSearch
    ? "Web search is available during research."
    : "Web search is NOT available during research -- any strategy should rely on the provided URLs " +
      "(if any) and general knowledge, not assume live search.";

  const userPrompt = [
    `TOPIC: ${input.topic}`,
    urlsLine,
    searchLine,
    "Respond with exactly one JSON object as specified.",
  ].join("\n\n");

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parsePlanResponse(raw: string): Result<PlanResponse, PlanParseError> {
  const extracted = extractFirstJsonObject(raw);
  if (!extracted.ok) {
    const message = extracted.error.kind === "invalid_json" ? extracted.error.message : extracted.error.kind;
    return { ok: false, error: { kind: "invalid_json", message } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.value);
  } catch (error) {
    return { ok: false, error: { kind: "invalid_json", message: error instanceof Error ? error.message : "JSON.parse failed" } };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: { kind: "schema_invalid", message: "top-level value must be a JSON object" } };
  }

  const record = parsed as Record<string, unknown>;
  const subQuestions = record.subQuestions;
  if (!Array.isArray(subQuestions) || subQuestions.length === 0 || !subQuestions.every(isNonEmptyString)) {
    return { ok: false, error: { kind: "schema_invalid", message: "'subQuestions' must be a non-empty array of non-empty strings" } };
  }

  const strategy = isNonEmptyString(record.strategy) ? record.strategy : "";
  return { ok: true, value: { subQuestions, strategy } };
}

function fallbackPlan(topic: string): PlanResponse {
  return { subQuestions: [topic], strategy: "" };
}

function buildGoal(input: PlanInput, strategy: string): string {
  const lines = [`Research question: ${input.topic}`];

  if (input.orgContext?.trim()) {
    lines.push("", "Organization context:", input.orgContext.trim());
  }

  if (strategy.trim()) {
    lines.push("", `Strategy: ${strategy.trim()}`);
  }

  // buildTurnContext (researchLoop.ts) never renders state.candidateUrls into the model's prompt --
  // only already-fetched state.sources. So embedding provided URLs directly in the goal text is the
  // ONLY channel through which the model can discover them. Do not remove this in favor of some
  // "cleaner" candidateUrls-based mechanism -- it doesn't exist yet.
  if (input.providedUrls.length > 0) {
    lines.push("", "Seed URLs:", ...input.providedUrls.map((u) => `- ${u}`));
  }

  if (input.seedText?.trim()) {
    lines.push(
      "",
      "Seed material (already extracted from uploaded files/URLs -- ground the plan in this, no need to re-fetch it):",
      input.seedText.trim(),
    );
  }

  if (!input.capabilities.webSearch) {
    lines.push(
      "",
      "Note: web_search is not available in this environment. Do not call it." +
        (input.providedUrls.length > 0
          ? " Instead, open the seed URLs above directly with open_url, then use search_in_page / read_pdf / save_note / compare_sources as needed."
          : " Rely on general knowledge and reasoning; no external sources are available."),
    );
  }

  return lines.join("\n");
}

export async function plan(input: PlanInput, model: ModelPort, signal: AbortSignal): Promise<ResearchSession> {
  const request = buildPlanRequest(input);

  let response: PlanResponse;
  try {
    const raw = await model.complete(request, signal);
    const parsed = parsePlanResponse(raw);
    response = parsed.ok ? parsed.value : fallbackPlan(input.topic);
  } catch {
    response = fallbackPlan(input.topic);
  }

  const subQuestions: SubQuestion[] = response.subQuestions.map((text, index) => ({
    id: toSubQuestionId(`SQ${index + 1}`),
    text,
    status: "open",
  }));

  const goal = buildGoal(input, response.strategy);
  return createInitialSession(goal, subQuestions);
}
