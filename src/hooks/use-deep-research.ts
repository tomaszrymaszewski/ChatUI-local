import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { Provider } from "@/types";
import { runResearchSession } from "@/lib/research/orchestrator";
import { createFetchOnlyResearchFunctions } from "@/lib/research/fetch-only-research";
import type { ProgressEvent } from "@/lib/research/types";

export interface UseDeepResearchOptions {
  /** Persists the finished report as an assistant message. Awaited before streaming state clears, so the chat never flashes empty between the streamed report and the persisted message (mirrors handleSend's ordering). */
  onReport: (report: string, modelUsed: string) => Promise<void>;
}

export interface UseDeepResearchResult {
  isRunning: boolean;
  statusLabel: string | null;
  streamingReport: string;
  start: (
    topic: string,
    provider: Provider,
    model: string,
    seedText: string | undefined,
    seedUrls: string[],
    ourOrgContext?: string,
  ) => Promise<void>;
  cancel: () => void;
}

function describeProgress(event: ProgressEvent): string | null {
  switch (event.type) {
    case "planning":
      return "Planning research…";
    case "round_start":
      return `Round ${event.round}/${event.maxRounds}: ${event.label}`;
    case "synthesizing":
      return "Writing report…";
    default:
      return null;
  }
}

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
      ourOrgContext?: string,
    ) => {
      setIsRunning(true);
      setStatusLabel("Planning research…");
      setStreamingReport("");

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const { planner, researchRound, synthesize } = createFetchOnlyResearchFunctions(provider, model, seedText);

        const onProgress = (event: ProgressEvent) => {
          const label = describeProgress(event);
          if (label) setStatusLabel(label);
          if (event.type === "synthesis_chunk") setStreamingReport(event.accumulated);
        };

        const { session, report } = await runResearchSession({
          topic,
          ourOrgContext,
          context: { mode: "fetch-only", seedUrls },
          planner,
          researchRound,
          synthesize,
          onProgress,
          signal: controller.signal,
        });

        if (report) {
          await onReport(report, model);
        } else if (session.phase === "error") {
          toast.error(
            session.notes.length > 0
              ? `Deep Research failed: ${session.notes.join("; ")}`
              : "Deep Research failed",
          );
        }
        // cancelled with no report: user-initiated, no toast needed
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
