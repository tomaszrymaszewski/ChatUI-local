// Picks which research engine runs Deep Research, based on whichever
// provider/model is currently selected in the chat UI — this is what makes
// Deep Research actually work with any model, not just Claude.
//
// Claude model selected -> Claude + Anthropic web_search (needs a Claude key).
// Anything else selected -> the universal engine, routed through the app's own
// multi-provider completion layer with Tavily search injected as text (needs
// a Tavily key). Each path requires its own key and fails with a specific,
// clear error if it's missing — never a silent fallback that hides which key
// is actually needed.

import type { Provider } from "@/types";
import { isAnthropicProvider } from "@/lib/providers/anthropic";
import { getResearchCredentials, getTavilyApiKey } from "./api-key";
import { createResearchFunctions } from "./anthropic-research";
import { createUniversalResearchFunctions } from "./universal-research";
import { RESEARCH_MODEL } from "./config";
import type { PlannerFn, ResearchRoundFn, SynthesizeFn } from "./types";

export type ResearchEngine = "claude" | "universal";

export interface ResearchFunctions {
  planner: PlannerFn;
  researchRound: ResearchRoundFn;
  synthesize: SynthesizeFn;
}

export interface SelectedResearchPath {
  engine: ResearchEngine;
  /** The model that will actually generate the report — for tagging the persisted message. */
  model: string;
  functions: ResearchFunctions;
}

export async function selectResearchFunctions(
  provider: Provider,
  model: string,
): Promise<SelectedResearchPath> {
  if (isAnthropicProvider(provider.baseUrl)) {
    const credentials = await getResearchCredentials();
    return { engine: "claude", model: RESEARCH_MODEL, functions: createResearchFunctions(credentials) };
  }

  const tavilyKey = getTavilyApiKey();
  return {
    engine: "universal",
    model,
    functions: createUniversalResearchFunctions(provider, model, { apiKey: tavilyKey }),
  };
}
