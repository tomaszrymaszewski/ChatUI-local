import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { Provider } from "@/types";
import { runDeepResearch, type DeepResearchPhase } from "@/lib/research/orchestrator";
import { createAppModelPort } from "@/lib/research/model/appModelPort";
import { createFsToolPort } from "@/lib/research/tools/fsToolPort";
import { DEFAULT_LOOP_CONFIG } from "@/lib/research/loop/researchLoop";

export interface UseDeepResearchOptions {
  /** Persists the finished report as an assistant message. Awaited before streaming state clears,
   *  mirroring handleSend's own ordering. */
  readonly onReport: (report: string, modelUsed: string) => Promise<void>;
}

export interface UseDeepResearchResult {
  readonly isRunning: boolean;
  readonly statusLabel: string | null;
  /** Only ever set once, at the very end (no live token-by-token streaming this stage) -- kept as
   *  its own field rather than folded into onReport's timing so the report can render inline before
   *  the (possibly slower) persistence call resolves. */
  readonly streamingReport: string;
  readonly start: (
    topic: string,
    provider: Provider,
    model: string,
    seedText: string | undefined,
    seedUrls: string[],
    orgContext?: string,
  ) => Promise<void>;
  readonly cancel: () => void;
}

const PHASE_LABELS: Record<DeepResearchPhase, string> = {
  plan: "Mapping perspectives & planning sub-questions…",
  research: "Researching…",
  synthesize: "Writing report…",
};

export function useDeepResearch({ onReport }: UseDeepResearchOptions): UseDeepResearchResult {
  const [isRunning, setIsRunning] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [streamingReport, setStreamingReport] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const start = useCallback(
    async (
      topic: string,
      provider: Provider,
      model: string,
      seedText: string | undefined,
      seedUrls: string[],
      orgContext?: string,
    ) => {
      setIsRunning(true);
      setStatusLabel(PHASE_LABELS.plan);
      setStreamingReport("");

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const modelPort = createAppModelPort(provider, model);
        const toolPort = createFsToolPort();

        const result = await runDeepResearch({
          topic,
          providedUrls: seedUrls,
          capabilities: { webSearch: false },
          model: modelPort,
          tool: toolPort,
          config: DEFAULT_LOOP_CONFIG,
          signal: controller.signal,
          seedText,
          orgContext,
          onPhase: (phase) => setStatusLabel(PHASE_LABELS[phase]),
        });

        setStreamingReport(result.report);
        // runDeepResearch never throws -- cancellation, budget exhaustion, and outright
        // plan/loop/synthesis failures all cascade into an honest, non-empty fallback report
        // (see orchestrator.ts). Always persist it rather than discarding real (if partial) work;
        // a soft warning toast is the adapted equivalent of a hard "failed" state.
        if (result.termination.partial) {
          toast.warning("Deep Research ended early — the report below may be incomplete.");
        }
        await onReport(result.report, model);
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : "Deep Research failed");
        }
      } finally {
        setIsRunning(false);
        setStatusLabel(null);
        setStreamingReport("");
        controllerRef.current = null;
      }
    },
    [onReport],
  );

  return { isRunning, statusLabel, streamingReport, start, cancel };
}
