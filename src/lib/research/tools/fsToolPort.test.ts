import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { createFsToolPort } from "./fsToolPort";
import { runIteration, createInitialSession, DEFAULT_LOOP_CONFIG, type IterationDeps, type ModelPort, type ModelTurnRequest } from "../loop/researchLoop";

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

function scriptedModel(responses: readonly string[]): ModelPort & { calls: ModelTurnRequest[] } {
  const calls: ModelTurnRequest[] = [];
  let index = 0;
  return {
    calls,
    async complete(request) {
      calls.push(request);
      const response = responses[Math.min(index, responses.length - 1)];
      index++;
      return response;
    },
  };
}

function jsonAction(overrides: {
  action: string;
  args: Record<string, unknown>;
  targets_subq?: string | null;
  confidence?: number;
}): string {
  return JSON.stringify({
    thought: "thinking",
    action: overrides.action,
    args: overrides.args,
    targets_subq: overrides.targets_subq ?? null,
    confidence: overrides.confidence ?? 0.4,
  });
}

describe("fsToolPort: end-to-end through the real, unmodified loop", () => {
  it("open_url -> search_in_page finds the body under the SAME SourceId the loop independently assigns", async () => {
    mockedInvoke.mockResolvedValue({
      title: "Q3 report",
      body: "the quarterly revenue report shows strong revenue growth this year",
      date: null,
    });

    const tool = createFsToolPort({ timeoutMs: 1000 });
    const model = scriptedModel([
      jsonAction({ action: "open_url", args: { url: "https://example.com/report" } }),
    ]);
    const deps: IterationDeps = {
      model,
      tool,
      clock: () => 0,
      signal: new AbortController().signal,
      config: DEFAULT_LOOP_CONFIG,
    };

    const first = await runIteration(createInitialSession("goal", []), deps);

    expect(first.state.sources.length).toBe(1);
    const assignedId = first.state.sources[0].id;
    expect(assignedId).toBe("S1"); // the loop's own dispatchTool assignment

    // Second turn: search_in_page against the id the loop just assigned. If the port's internal
    // counter-mirroring assumption ever drifted from dispatchTool's real assignment, this would
    // throw "unknown source id" here instead of returning matches.
    const model2 = scriptedModel([
      jsonAction({ action: "search_in_page", args: { source_id: assignedId, query: "revenue growth" } }),
    ]);
    const second = await runIteration(first.state, { ...deps, model: model2 });

    expect(second.state.lastObservation?.kind).toBe("page_search_results");
    if (second.state.lastObservation?.kind === "page_search_results") {
      expect(second.state.lastObservation.matches.length).toBeGreaterThan(0);
    }
  });

  it("shares one ordinal across open_url and read_pdf through two consecutive real iterations", async () => {
    mockedInvoke.mockResolvedValueOnce({ title: "page", body: "html body content", date: null });
    mockedInvoke.mockResolvedValueOnce({ title: "doc.pdf", body: "pdf body content", date: null });

    const tool = createFsToolPort({ timeoutMs: 1000 });
    const deps: IterationDeps = {
      model: scriptedModel([jsonAction({ action: "open_url", args: { url: "https://example.com/a" } })]),
      tool,
      clock: () => 0,
      signal: new AbortController().signal,
      config: DEFAULT_LOOP_CONFIG,
    };

    const first = await runIteration(createInitialSession("goal", []), deps);
    expect(first.state.sources[0].id).toBe("S1");

    const second = await runIteration(first.state, {
      ...deps,
      model: scriptedModel([jsonAction({ action: "read_pdf", args: { url: "https://example.com/b.pdf" } })]),
    });
    expect(second.state.sources[1].id).toBe("S2");

    // Both bodies must be independently searchable through the SAME shared tool port state.
    const searchS1 = await tool.searchInPage(second.state.sources[0].id, "html", new AbortController().signal);
    const searchS2 = await tool.searchInPage(second.state.sources[1].id, "pdf", new AbortController().signal);
    expect(searchS1.length).toBeGreaterThan(0);
    expect(searchS2.length).toBeGreaterThan(0);
  });
});
