// Live, end-to-end smoke test for the FETCH-ONLY (upload-grounded, zero
// search dependency) research path — Stage 2's gate: "run upload-grounded,
// non-Claude model, NO Tavily key. Confirm real sources, termination,
// working Cancel."
//
// The seed here is a fabricated short "competitor report" that cites a couple
// of real URLs in plain text — deliberately, not a fetched homepage: web_fetch
// strips HTML tags before returning content, so a real page's hyperlinks
// (anchor text like "Learn More") essentially never survive as visible URL
// text. A document that CITES URLs in its own prose (exactly what a real
// uploaded report with citations/footnotes would do) is what actually
// exercises the frontier — see DISCOVERY-2C.md / Stage 2 notes.
//
// Excluded from `npm test` (see vitest.config.ts) — requires RUN_LIVE_TESTS=1
// as an explicit opt-in. No Tavily key involved anywhere in this file. Run:
//
//   RUN_LIVE_TESTS=1 \
//   RESEARCH_SMOKE_PROVIDER_BASE_URL=https://api.openai.com/v1 \
//   RESEARCH_SMOKE_PROVIDER_API_KEY=sk-... \
//   RESEARCH_SMOKE_MODEL=gpt-4o-mini \
//   npx vitest run src/lib/research/live-smoke-fetch-only.live.test.ts

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

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

import { describe, expect, it } from "vitest";
import { runResearchSession } from "./orchestrator";
import { createFetchOnlyResearchFunctions } from "./fetch-only-research";
import { buildResearchSeed, computeExpansionFrontier } from "./seed";
import type { ProgressEvent } from "./types";
import type { Provider } from "@/types";

const providerBaseUrl = process.env.RESEARCH_SMOKE_PROVIDER_BASE_URL;
const providerApiKey = process.env.RESEARCH_SMOKE_PROVIDER_API_KEY;
const model = process.env.RESEARCH_SMOKE_MODEL;

const hasAllCredentials = !!(providerBaseUrl && providerApiKey && model);

const SEED_DOCUMENT = `Competitor Brief: charity: water (excerpt)

charity: water is a nonprofit organization that funds clean water projects in developing countries. Founded in 2006, it is headquartered in New York City. For more background, see the organization's official site at https://www.charitywater.org and its published financials at https://www.charitywater.org/about/financials.`;

function setupProvider(): Provider {
  const providerId = "live-smoke-fetch-only-provider";
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
  return provider;
}

describe.runIf(hasAllCredentials)("Deep Research fetch-only live smoke test", () => {
  it(
    "runs an end-to-end upload-grounded session with zero search dependency",
    async () => {
      const provider = setupProvider();

      const seedFile = { name: "competitor-brief.txt", file: new File([SEED_DOCUMENT], "competitor-brief.txt", { type: "text/plain" }) };
      const seed = await buildResearchSeed([seedFile]);
      const seedUrls = computeExpansionFrontier(seed);
      console.log(`[seed] ${seed.sourceCount} source(s), frontier: ${JSON.stringify(seedUrls)}`);
      expect(seedUrls.length).toBeGreaterThan(0); // sanity: the fabricated seed actually has citations to expand into

      const { planner, researchRound, synthesize } = createFetchOnlyResearchFunctions(provider, model!, seed.text);

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
            console.log(`[round ${event.round} done] +${event.newSourceCount} sources, ${event.remainingGaps} gaps remain`);
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
        topic: "", // upload-only mode: no typed topic, seed drives everything
        config: { maxRounds: 2, maxQueriesPerRound: 3 },
        context: { mode: "fetch-only", seedUrls },
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
      console.log(`sources: ${session.sources.length} -> ${JSON.stringify(session.sources.map((s) => s.url))}`);
      console.log(`notes: ${JSON.stringify(session.notes)}`);

      expect(
        session.phase,
        `session ended in phase "${session.phase}"` +
          (errorMessage ? ` — error: ${errorMessage}` : "") +
          (session.notes.length > 0 ? ` — notes: ${JSON.stringify(session.notes)}` : ""),
      ).toBe("done");
      expect(report, "report was null").not.toBeNull();
      expect(session.sources.length).toBeGreaterThan(0); // proves real fetches happened, no search tool involved
      expect(session.sources.every((s) => s.url.startsWith("https://www.charitywater.org"))).toBe(true); // every source traces to a fetched URL from the seed
    },
    180_000,
  );

  it(
    "actually stops when cancelled mid-run, not left hanging",
    async () => {
      const provider = setupProvider();
      const seedFile = { name: "competitor-brief.txt", file: new File([SEED_DOCUMENT], "competitor-brief.txt", { type: "text/plain" }) };
      const seed = await buildResearchSeed([seedFile]);
      const seedUrls = computeExpansionFrontier(seed);

      const { planner, researchRound, synthesize } = createFetchOnlyResearchFunctions(provider, model!, seed.text);
      const controller = new AbortController();

      const started = Date.now();
      const { session, report } = await runResearchSession({
        topic: "",
        config: { maxRounds: 5, maxQueriesPerRound: 3 },
        context: { mode: "fetch-only", seedUrls },
        planner,
        researchRound,
        synthesize,
        onProgress: (event) => {
          if (event.type === "round_start") controller.abort(); // cancel as soon as research actually starts
        },
        signal: controller.signal,
      });
      const elapsedMs = Date.now() - started;

      console.log(`[cancel test] phase: ${session.phase}, elapsed: ${elapsedMs}ms`);
      expect(session.phase).toBe("cancelled");
      expect(report).toBeNull();
      expect(elapsedMs).toBeLessThan(60_000); // bounded — not hanging on an uncancellable fetch
    },
    90_000,
  );
});

if (!hasAllCredentials) {
  console.log(
    "Skipping fetch-only live smoke test — set RUN_LIVE_TESTS=1, RESEARCH_SMOKE_PROVIDER_BASE_URL, RESEARCH_SMOKE_PROVIDER_API_KEY, and RESEARCH_SMOKE_MODEL to run it (see this file's header comment). No Tavily key needed.",
  );
}
