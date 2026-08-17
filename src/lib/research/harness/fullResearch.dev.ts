/**
 * DEV-ONLY manual smoke test for the FULL Deep Research pipeline (PLAN -> RESEARCH loop ->
 * SYNTHESIZE) against a real model and a typed topic.
 *
 * NOT run by `npm run test` (filename doesn't match vitest's `src/**\/*.test.ts` include
 * pattern) and imported by no production file — zero CI/app footprint by construction.
 *
 * Same invocation constraints as smokeResearch.dev.ts (see that file's header for the full
 * explanation): the app's provider layer is localStorage-backed, and the real ToolPort needs the
 * Tauri IPC bridge, so this only runs from the running app's own devtools console:
 *
 *   1. Configure at least one provider (with a real API key) in the app's own Settings UI, and
 *      confirm normal chat gets a real reply first (proves the key + CORS are good).
 *   2. Start the FULL desktop app: `npm run tauri dev` (not the web-only `npm run dev` preview).
 *   3. Open the window's devtools console and run:
 *        const mod = await import('/src/lib/research/harness/fullResearch.dev.ts');
 *        const result = await mod.runFullResearch({
 *          modelName: '<your model name>',
 *          topic: '<a real research topic>',
 *          providedUrls: ['<a real URL>'],
 *        });
 *
 * capabilities.webSearch is hardcoded to false here, matching reality: createFsToolPort()'s
 * webSearch always throws this stage (no keyless search implementation exists yet).
 */

import { fetchProviders } from "../../llm";
import {
  DEFAULT_LOOP_CONFIG,
  STEP_BUDGET,
  TOOL_TIMEOUT_MS,
  type LoopConfig,
} from "../loop/researchLoop";
import { createFsToolPort } from "../tools/fsToolPort";
import { createAppModelPort, DEFAULT_MODEL_TIMEOUT_MS } from "../model/appModelPort";
import { runDeepResearch, type RunDeepResearchResult } from "../orchestrator";
import { printTrace } from "./trace";

const DEFAULT_MAX_WALL_CLOCK_MS = 180_000;

export interface RunFullResearchOptions {
  /** ProviderModel.name — the same key ChatView.tsx's own findProviderForModel matches on. */
  readonly modelName: string;
  /** Disambiguator if two configured providers happen to expose a model with the same name. */
  readonly providerName?: string;
  readonly topic: string;
  readonly providedUrls?: readonly string[];
  readonly stepBudget?: number;
  readonly modelTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
  /** Overall watchdog on top of the per-call timeouts above. Defaults to 180s. */
  readonly maxWallClockMs?: number;
}

export async function runFullResearch(options: RunFullResearchOptions): Promise<RunDeepResearchResult> {
  const providers = await fetchProviders();
  const provider = findProviderForFullResearch(providers, options.modelName, options.providerName);
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

  try {
    const result = await runDeepResearch({
      topic: options.topic,
      providedUrls: options.providedUrls ?? [],
      capabilities: { webSearch: false },
      model,
      tool,
      config,
      signal: watchdog.signal,
    });

    console.group(`[fullResearch] model=${options.modelName} topic="${options.topic}"`);
    console.log("--- plan ---");
    console.log(`goal:\n${result.finalState.goal}`);
    console.log(`sub-questions (${result.subQuestions.length}):`);
    for (const sq of result.subQuestions) console.log(`  ${sq.id}: ${sq.text}`);
    console.groupEnd();

    printTrace(`fullResearch model=${options.modelName}`, result);

    console.group(`[fullResearch] report`);
    console.log(result.report);
    console.groupEnd();

    return result;
  } finally {
    clearTimeout(timer);
  }
}

interface ProviderLike {
  readonly name: string;
  readonly models: readonly { readonly id: string; readonly name: string }[];
}

function findProviderForFullResearch<T extends ProviderLike>(providers: readonly T[], modelName: string, providerName?: string): T | null {
  const candidates = providers.filter((p) => p.models.some((m) => m.name === modelName || m.id === modelName));
  if (providerName) return candidates.find((p) => p.name === providerName) ?? null;
  return candidates[0] ?? null;
}
