// Live, end-to-end smoke test for the UNIVERSAL (any-model) research path —
// Stage B's gate ("live run, non-Claude model, real NGO").
//
// llm.ts's getProviderApiKey() reads the provider's key out of the browser's
// localStorage, which doesn't exist in Node — this file polyfills a minimal
// in-memory version and seeds it with one provider entry built from env vars,
// so streamChatCompletion works unmodified, exactly as it does in the app.
//
// Excluded from `npm test` (see vitest.config.ts) — requires RUN_LIVE_TESTS=1
// as an explicit opt-in. Run explicitly, e.g. against OpenAI:
//
//   RUN_LIVE_TESTS=1 \
//   TAVILY_API_KEY=tvly-... \
//   RESEARCH_SMOKE_PROVIDER_BASE_URL=https://api.openai.com/v1 \
//   RESEARCH_SMOKE_PROVIDER_API_KEY=sk-... \
//   RESEARCH_SMOKE_MODEL=gpt-4o-mini \
//   npx vitest run src/lib/research/live-smoke-universal.live.test.ts
//
// Any OpenAI-compatible provider works the same way (Gemini, DeepInfra,
// Fireworks, a local Ollama server with no key needed, etc.) — just point
// RESEARCH_SMOKE_PROVIDER_BASE_URL/MODEL at it. Costs real tokens + Tavily
// search credits. Never prints either key.

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

// Node 22+ ships an experimental `localStorage` global that warns/no-ops unless
// launched with --localstorage-file, so a `typeof === "undefined"` check isn't
// reliable here — always install our own for this Node-only test file.
Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

import { describe, expect, it } from "vitest";
import { runResearchSession } from "./orchestrator";
import { createUniversalResearchFunctions } from "./universal-research";
import type { ProgressEvent } from "./types";
import type { Provider } from "@/types";

const tavilyKey = process.env.TAVILY_API_KEY;
const providerBaseUrl = process.env.RESEARCH_SMOKE_PROVIDER_BASE_URL;
const providerApiKey = process.env.RESEARCH_SMOKE_PROVIDER_API_KEY;
const model = process.env.RESEARCH_SMOKE_MODEL;
const topic = process.env.RESEARCH_SMOKE_TOPIC ?? "charity: water";

const hasAllCredentials = !!(tavilyKey && providerBaseUrl && providerApiKey && model);

describe.runIf(hasAllCredentials)("Deep Research universal-path live smoke test", () => {
  it(
    `runs an end-to-end research session for "${topic}" on a non-Claude provider`,
    async () => {
      const providerId = "live-smoke-universal-provider";
      const provider: Provider = {
        id: providerId,
        name: "Live smoke test provider",
        baseUrl: providerBaseUrl!,
        models: [],
        hasKey: true,
      };
      localStorage.setItem(
        "chatui:providers",
        JSON.stringify([
          { id: providerId, name: provider.name, baseUrl: provider.baseUrl, apiKey: providerApiKey, models: [] },
        ]),
      );

      const { planner, researchRound, synthesize } = createUniversalResearchFunctions(provider, model!, {
        apiKey: tavilyKey!,
      });

      let errorMessage: string | null = null;

      const onProgress = (event: ProgressEvent) => {
        switch (event.type) {
          case "planning":
            console.log("[planning]");
            break;
          case "round_start":
            console.log(`[round ${event.round}/${event.maxRounds}] ${event.label}`);
            break;
          case "round_end":
            console.log(
              `[round ${event.round} done] +${event.newSourceCount} sources, ${event.remainingGaps} gaps remain`,
            );
            break;
          case "synthesizing":
            console.log("[synthesizing]");
            break;
          case "synthesis_chunk":
            process.stdout.write(event.chunk);
            break;
          case "done":
            console.log("\n[done]");
            break;
          case "cancelled":
            console.log("[cancelled]");
            break;
          case "error":
            errorMessage = event.message;
            console.error(`[error] ${event.message}`);
            break;
        }
      };

      const { session, report } = await runResearchSession({
        topic,
        config: { maxRounds: 2, maxQueriesPerRound: 3 },
        planner,
        researchRound,
        synthesize,
        onProgress,
        signal: new AbortController().signal,
      });

      console.log("\n--- session summary ---");
      console.log(`phase: ${session.phase}`);
      console.log(`rounds: ${session.rounds.length}`);
      console.log(`findings: ${session.findings.length}`);
      console.log(`sources: ${session.sources.length}`);
      console.log(`notes: ${JSON.stringify(session.notes)}`);

      expect(
        session.phase,
        `session ended in phase "${session.phase}"` +
          (errorMessage ? ` — error: ${errorMessage}` : "") +
          (session.notes.length > 0 ? ` — notes: ${JSON.stringify(session.notes)}` : ""),
      ).toBe("done");
      expect(report, "report was null").not.toBeNull();
      expect(report!.length).toBeGreaterThan(200);
      expect(report).toMatch(/snapshot/i);
      expect(report).toMatch(/sources/i);
      expect(session.sources.length).toBeGreaterThan(0); // proves Tavily actually returned results
    },
    180_000,
  );
});

if (!hasAllCredentials) {
  console.log(
    "Skipping universal-path live smoke test — set RUN_LIVE_TESTS=1, TAVILY_API_KEY, RESEARCH_SMOKE_PROVIDER_BASE_URL, RESEARCH_SMOKE_PROVIDER_API_KEY, and RESEARCH_SMOKE_MODEL to run it (see this file's header comment).",
  );
}
