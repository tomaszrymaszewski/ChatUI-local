import { describe, expect, it, vi } from "vitest";
import { runResearchSession } from "./orchestrator";
import type { PlannerFn, PlannerResult, ResearchRoundFn, ResearchRoundResult, SynthesizeFn } from "./types";

const noopSynthesize: SynthesizeFn = async function* () {
  yield "REPORT";
};

describe("runResearchSession", () => {
  it("stops at maxRounds when gaps never close and rounds keep finding sources", async () => {
    const planner: PlannerFn = async () => ({
      plan: [{ question: "initial gap", section: "general" }],
      initialQueries: ["q0"],
    });
    const researchRound: ResearchRoundFn = vi.fn(async (_topic, _gaps, _queries, roundIndex) => ({
      findings: [],
      newSources: [{ url: `https://x.com/${roundIndex}`, title: "x", foundInRound: roundIndex }],
      resolvedGaps: [],
      newGaps: [{ question: `follow-up-${roundIndex}`, section: "general" }],
      tokensUsed: 10,
    }));

    const { session, report } = await runResearchSession({
      topic: "Acme NGO",
      config: { maxRounds: 3, maxQueriesPerRound: 4, globalTimeoutMs: 60_000, maxOutputTokens: 1_000_000 },
      planner,
      researchRound,
      synthesize: noopSynthesize,
      signal: new AbortController().signal,
    });

    expect(session.rounds).toHaveLength(3);
    expect(session.phase).toBe("done");
    expect(report).toBe("REPORT");
    expect(researchRound).toHaveBeenCalledTimes(3);
  });

  it("terminates early once all gaps are resolved", async () => {
    const planner: PlannerFn = async () => ({
      plan: [{ question: "g1", section: "s" }],
      initialQueries: ["q1"],
    });
    const researchRound: ResearchRoundFn = vi.fn(async () => ({
      findings: [],
      newSources: [{ url: "https://a.com", title: "a", foundInRound: 0 }],
      resolvedGaps: ["g1"],
      newGaps: [],
      tokensUsed: 5,
    }));

    const { session } = await runResearchSession({
      topic: "Acme NGO",
      planner,
      researchRound,
      synthesize: noopSynthesize,
      signal: new AbortController().signal,
    });

    expect(researchRound).toHaveBeenCalledTimes(1);
    expect(session.rounds).toHaveLength(1);
    expect(session.gaps).toHaveLength(0);
    expect(session.phase).toBe("done");
  });

  it("terminates on diminishing returns (a round adds no new sources or resolved gaps)", async () => {
    const planner: PlannerFn = async () => ({
      plan: [{ question: "g1", section: "s" }],
      initialQueries: ["q1"],
    });
    const researchRound: ResearchRoundFn = vi.fn(async () => ({
      findings: [],
      newSources: [],
      resolvedGaps: [],
      newGaps: [],
      tokensUsed: 1,
    }));

    const { session } = await runResearchSession({
      topic: "Acme NGO",
      planner,
      researchRound,
      synthesize: noopSynthesize,
      signal: new AbortController().signal,
    });

    expect(researchRound).toHaveBeenCalledTimes(1);
    expect(session.rounds).toHaveLength(1);
    expect(session.gaps).toHaveLength(1); // g1 never resolved, just stopped searching
    expect(session.phase).toBe("done");
  });

  it("never re-sends a query that only differs by case/punctuation", async () => {
    const planner: PlannerFn = async () => ({
      plan: [{ question: "g1", section: "s" }],
      initialQueries: ["Funding Sources?"],
    });

    const calls: string[][] = [];
    const researchRound: ResearchRoundFn = vi.fn(async (_topic, _gaps, queries, roundIndex) => {
      calls.push(queries);
      if (roundIndex === 0) {
        return {
          findings: [],
          newSources: [{ url: "u0", title: "t", foundInRound: 0 }],
          resolvedGaps: [],
          // Duplicate of the first query, different case/punctuation — should be filtered next round.
          newGaps: [{ question: "funding sources", section: "s" }],
          tokensUsed: 1,
        };
      }
      return {
        findings: [],
        newSources: [],
        resolvedGaps: ["g1"],
        newGaps: [],
        tokensUsed: 1,
      };
    });

    const { session } = await runResearchSession({
      topic: "Acme NGO",
      planner,
      researchRound,
      synthesize: noopSynthesize,
      signal: new AbortController().signal,
    });

    expect(researchRound).toHaveBeenCalledTimes(2);
    expect(calls[0]).toEqual(["Funding Sources?"]);
    expect(calls[1]).toEqual(["g1"]); // fell back to the open gap, not the duplicate query
    expect(calls.flat()).not.toContain("funding sources");
    expect(session.phase).toBe("done");
  });

  it("stops mid-round when the signal is aborted and never calls synthesize", async () => {
    const controller = new AbortController();
    const planner: PlannerFn = async () => ({
      plan: [{ question: "g1", section: "s" }],
      initialQueries: ["q1"],
    });
    const researchRound: ResearchRoundFn = vi.fn(async () => {
      controller.abort(); // simulate the user hitting Cancel while this round is in flight
      return {
        findings: [],
        newSources: [{ url: "u0", title: "t", foundInRound: 0 }],
        resolvedGaps: [],
        newGaps: [],
        tokensUsed: 1,
      };
    });
    const synthesize = vi.fn(noopSynthesize);

    const { session, report } = await runResearchSession({
      topic: "Acme NGO",
      planner,
      researchRound,
      synthesize,
      signal: controller.signal,
    });

    expect(session.phase).toBe("cancelled");
    expect(report).toBeNull();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("never starts if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const planner = vi.fn(async () => ({ plan: [], initialQueries: [] }));

    const { session, report } = await runResearchSession({
      topic: "Acme NGO",
      planner,
      researchRound: vi.fn(),
      synthesize: noopSynthesize,
      signal: controller.signal,
    });

    expect(planner).not.toHaveBeenCalled();
    expect(session.phase).toBe("cancelled");
    expect(report).toBeNull();
  });

  it("actually bounds a round that never resolves on its own, and still synthesizes a partial report", async () => {
    const planner: PlannerFn = async () => ({
      plan: [{ question: "g1", section: "s" }],
      initialQueries: ["q1"],
    });
    // This never resolves and never rejects by itself — the orchestrator must
    // move on anyway once the deadline elapses, not hang forever.
    const researchRound: ResearchRoundFn = vi.fn(() => new Promise<ResearchRoundResult>(() => {}));

    const started = Date.now();
    const { session, report } = await runResearchSession({
      topic: "Acme NGO",
      config: { maxRounds: 5, maxQueriesPerRound: 4, globalTimeoutMs: 30, maxOutputTokens: 1_000_000 },
      planner,
      researchRound,
      synthesize: noopSynthesize,
      signal: new AbortController().signal,
    });
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(2_000); // bounded by the 30ms deadline, not left hanging
    expect(session.rounds).toHaveLength(0); // the hung round never produced a result
    expect(session.notes[0]).toMatch(/timed out/i);
    expect(session.phase).toBe("done"); // still degrades gracefully into synthesis
    expect(report).toBe("REPORT");
  });

  it("also bounds the planner call itself and reports a timeout error, not a hang", async () => {
    const planner: PlannerFn = vi.fn(() => new Promise<PlannerResult>(() => {})); // never resolves

    const started = Date.now();
    const { session, report } = await runResearchSession({
      topic: "Acme NGO",
      config: { maxRounds: 5, maxQueriesPerRound: 4, globalTimeoutMs: 30, maxOutputTokens: 1_000_000 },
      planner,
      researchRound: vi.fn(),
      synthesize: noopSynthesize,
      signal: new AbortController().signal,
    });
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(2_000);
    expect(session.phase).toBe("error");
    expect(report).toBeNull();
  });

  it("streams synthesis chunks incrementally and accumulates them into the final report", async () => {
    const planner: PlannerFn = async () => ({ plan: [], initialQueries: [] });
    const synthesize: SynthesizeFn = async function* () {
      yield "# Report\n";
      yield "more text";
    };
    const events: { chunk: string; accumulated: string }[] = [];

    const { report } = await runResearchSession({
      topic: "Acme NGO",
      planner,
      researchRound: vi.fn(),
      synthesize,
      onProgress: (event) => {
        if (event.type === "synthesis_chunk") events.push({ chunk: event.chunk, accumulated: event.accumulated });
      },
      signal: new AbortController().signal,
    });

    expect(events).toEqual([
      { chunk: "# Report\n", accumulated: "# Report\n" },
      { chunk: "more text", accumulated: "# Report\nmore text" },
    ]);
    expect(report).toBe("# Report\nmore text");
  });

  it("keeps the partial report when cancelled mid-synthesis, instead of discarding it", async () => {
    const controller = new AbortController();
    const planner: PlannerFn = async () => ({ plan: [], initialQueries: [] });
    const synthesize: SynthesizeFn = async function* () {
      yield "partial text";
      controller.abort(); // user hits Cancel while the report is still streaming
      yield "never reaches the UI";
    };

    const { session, report } = await runResearchSession({
      topic: "Acme NGO",
      planner,
      researchRound: vi.fn(),
      synthesize,
      signal: controller.signal,
    });

    // Note: the second yield still runs because the generator itself doesn't
    // check the signal — real Phase 2 generators built on fetch() will stop
    // producing chunks once their own request is aborted. Here we're only
    // asserting the orchestrator's post-loop cancellation check fires and
    // that whatever was accumulated up to that point isn't thrown away.
    expect(session.phase).toBe("cancelled");
    expect(report).not.toBeNull();
    expect(report).toContain("partial text");
  });
});
