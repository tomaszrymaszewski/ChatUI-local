// Live, end-to-end smoke test against the real Anthropic API — the Phase 2 gate
// ("a full run completes end-to-end in the terminal/logs, no UI yet").
//
// Excluded from `npm test` (see vitest.config.ts) — requires RUN_LIVE_TESTS=1
// as an explicit opt-in, not just an available key, so a plain `npm test`
// never spends money just because ANTHROPIC_API_KEY happens to be exported
// for some other tool. Run explicitly:
//
//   RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... npx vitest run src/lib/research/live-smoke.live.test.ts
//
// Optionally set RESEARCH_SMOKE_TOPIC to research a different org. Costs real
// tokens + web_search fees (a few cents to low dollars per run depending on
// maxRounds below). Never prints the key.

import { describe, expect, it } from "vitest";
import { runResearchSession } from "./orchestrator";
import { createResearchFunctions } from "./anthropic-research";
import type { ResearchCredentials } from "./api-key";
import type { ProgressEvent } from "./types";

const apiKey = process.env.ANTHROPIC_API_KEY;
const topic = process.env.RESEARCH_SMOKE_TOPIC ?? "charity: water";

describe.runIf(!!apiKey)("Deep Research live smoke test", () => {
  it(
    `runs an end-to-end research session for "${topic}" against the real API`,
    async () => {
      const credentials: ResearchCredentials = {
        apiKey: apiKey!,
        baseUrl: "https://api.anthropic.com/v1",
      };
      const { planner, researchRound, synthesize } = createResearchFunctions(credentials);

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

      // Carries the actual failure reason (errorMessage / notes) directly in the
      // assertion diff, so it can't get lost between the terminal and a copy-paste.
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
    },
    180_000,
  );
});

if (!apiKey) {
  console.log(
    "Skipping live Deep Research smoke test — set ANTHROPIC_API_KEY to run it (see this file's header comment).",
  );
}
