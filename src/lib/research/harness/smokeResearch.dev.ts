/**
 * DEV-ONLY manual smoke test for the RESEARCH loop against a real model.
 *
 * NOT run by `npm run test` (filename doesn't match vitest's `src/**\/*.test.ts` include
 * pattern) and imported by no production file — zero CI/app footprint by construction.
 *
 * This module has no DOM/React dependency itself, but the app's provider layer
 * (src/lib/llm.ts) reads configured providers/API keys from `localStorage`, which only exists
 * inside the running app's browser/webview context. So this can't be run as a standalone
 * script — invoke it from the running app's devtools console instead:
 *
 *   1. Configure at least one provider (with a real API key) in the app's own Settings UI.
 *   2. Start the FULL desktop app: `npm run tauri dev` (NOT the faster `npm run dev` web-only
 *      preview — the real ToolPort's open_url/read_pdf call `invoke()`, which only works inside
 *      an actual Tauri webview, not a plain browser tab).
 *   3. Open the window's devtools console and run:
 *        const mod = await import('/src/lib/research/harness/smokeResearch.dev.ts');
 *        const result = await mod.runSmokeResearch({ modelName: '<your model name>' });
 *
 * The trace prints once the run fully settles — runResearchLoop has no progress callback,
 * only a final ProgressEvent[], so this can't stream live without changing the loop (out of
 * scope for this stage).
 */

import { fetchProviders } from "../../llm";
import { toSubQuestionId } from "../loop/actions";
import {
  createInitialSession,
  runResearchLoop,
  DEFAULT_LOOP_CONFIG,
  STEP_BUDGET,
  TOOL_TIMEOUT_MS,
  type SubQuestion,
  type LoopConfig,
  type ProgressEvent,
  type ResearchSession,
  type TerminationDecision,
} from "../loop/researchLoop";
import { createFsToolPort } from "../tools/fsToolPort";
import { createAppModelPort, DEFAULT_MODEL_TIMEOUT_MS } from "../model/appModelPort";
import { printTrace } from "./trace";

// buildTurnContext (researchLoop.ts) never renders state.candidateUrls into the model's
// prompt — only already-fetched state.sources. createFsToolPort()'s default webSearch always
// throws. So the ONLY way the model can discover a URL this stage is if it's spelled out in
// the goal text itself — seed URLs live here, not in any candidate-URL mechanism.
const SMOKE_GOAL = [
  "Research question: What did Tauri v2's stable release change about the inter-process " +
    "communication (invoke/IPC) model compared to Tauri v1, and what are the practical " +
    "implications for calling Rust commands from the frontend?",
  "",
  "Note: web_search is not available in this environment. Do not call it. Instead, open the " +
    "seed URLs below directly with open_url, then use search_in_page / read_pdf / save_note / " +
    "compare_sources as needed.",
  "",
  "Seed URLs:",
  "- https://v2.tauri.app/concept/inter-process-communication/",
  "- https://v2.tauri.app/develop/calling-rust/",
].join("\n");

const SMOKE_SUBQUESTIONS: readonly SubQuestion[] = [
  { id: toSubQuestionId("SQ1"), text: "What is the current invoke()/IPC model in Tauri v2?", status: "open" },
  { id: toSubQuestionId("SQ2"), text: "How does a frontend call a Rust command, concretely?", status: "open" },
  { id: toSubQuestionId("SQ3"), text: "What changed vs. Tauri v1's IPC model, if anything is documented?", status: "open" },
];

const DEFAULT_MAX_WALL_CLOCK_MS = 180_000;

export interface SmokeResearchOptions {
  /** ProviderModel.name — the same key ChatView.tsx's own findProviderForModel matches on. */
  readonly modelName: string;
  /** Disambiguator if two configured providers happen to expose a model with the same name. */
  readonly providerName?: string;
  readonly stepBudget?: number;
  readonly modelTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
  /** Overall watchdog on top of the per-call timeouts above. Defaults to 180s. */
  readonly maxWallClockMs?: number;
}

export interface SmokeResearchResult {
  readonly termination: TerminationDecision;
  readonly finalState: ResearchSession;
  readonly events: readonly ProgressEvent[];
}

export async function runSmokeResearch(options: SmokeResearchOptions): Promise<SmokeResearchResult> {
  const providers = await fetchProviders();
  const provider = findProviderForSmoke(providers, options.modelName, options.providerName);
  if (!provider) {
    throw new Error(
      `No configured provider exposes model "${options.modelName}". Add it in the app's Settings UI first.`,
    );
  }

  const toolTimeoutMs = options.toolTimeoutMs ?? TOOL_TIMEOUT_MS;
  const config: LoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    stepBudget: options.stepBudget ?? STEP_BUDGET.quick,
    toolTimeoutMs,
  };

  const model = createAppModelPort(provider, options.modelName, {
    timeoutMs: options.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS,
  });
  const tool = createFsToolPort({ timeoutMs: toolTimeoutMs });

  const watchdog = new AbortController();
  const timer = setTimeout(() => watchdog.abort(), options.maxWallClockMs ?? DEFAULT_MAX_WALL_CLOCK_MS);

  const initialSession = createInitialSession(SMOKE_GOAL, SMOKE_SUBQUESTIONS);

  try {
    const loopResult = await runResearchLoop(initialSession, {
      model,
      tool,
      clock: Date.now,
      signal: watchdog.signal,
      config,
    });

    const result: SmokeResearchResult = {
      termination: loopResult.termination,
      finalState: loopResult.finalState,
      events: loopResult.events,
    };
    printTrace(`smokeResearch model=${options.modelName}`, result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

interface ProviderLike {
  readonly name: string;
  readonly models: readonly { readonly id: string; readonly name: string }[];
}

function findProviderForSmoke<T extends ProviderLike>(providers: readonly T[], modelName: string, providerName?: string): T | null {
  const candidates = providers.filter((p) => p.models.some((m) => m.name === modelName || m.id === modelName));
  if (providerName) return candidates.find((p) => p.name === providerName) ?? null;
  return candidates[0] ?? null;
}

