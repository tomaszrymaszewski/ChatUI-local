import type { Provider } from "../../../types";
import { streamChatCompletion, type ChatCompletionMessage } from "../../llm";
import type { ModelPort, ModelTurnRequest } from "../loop/researchLoop";

export const DEFAULT_MODEL_TIMEOUT_MS = 60_000;

export interface CreateAppModelPortOptions {
  /** Defaults to DEFAULT_MODEL_TIMEOUT_MS. ModelPort.complete(request, signal) has no numeric
   *  timeout parameter (frozen interface), so — exactly like Stage 2's createFsToolPort({ timeoutMs }) —
   *  the timeout is configured once at construction time. */
  readonly timeoutMs?: number;
}

export function createAppModelPort(provider: Provider, model: string, options: CreateAppModelPortOptions = {}): ModelPort {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
  return {
    complete(request: ModelTurnRequest, signal: AbortSignal): Promise<string> {
      return completeTurn(provider, model, timeoutMs, request, signal);
    },
  };
}

type AbortReason = "timeout" | "cancelled" | null;

interface CombinedAbort {
  readonly signal: AbortSignal;
  readonly reason: () => AbortReason;
  readonly cleanup: () => void;
}

// Hand-rolled listener-based combining, not AbortSignal.any — matches the precedent set in
// researchLoop.ts's callWithTimeoutAndRetry and tools/shared.ts's raceAgainstSignal, both of
// which avoid it for uncertain DOM-lib/webview support.
function combineSignals(outerSignal: AbortSignal, timeoutMs: number): CombinedAbort {
  const controller = new AbortController();
  let reason: AbortReason = null;

  const fire = (r: Exclude<AbortReason, null>) => {
    if (!controller.signal.aborted) {
      reason = r;
      controller.abort();
    }
  };

  if (outerSignal.aborted) fire("cancelled");

  const timer = setTimeout(() => fire("timeout"), timeoutMs);
  const onOuterAbort = () => fire("cancelled");
  outerSignal.addEventListener("abort", onOuterAbort);

  return {
    signal: controller.signal,
    reason: () => reason,
    cleanup: () => {
      clearTimeout(timer);
      outerSignal.removeEventListener("abort", onOuterAbort);
    },
  };
}

async function completeTurn(
  provider: Provider,
  model: string,
  timeoutMs: number,
  request: ModelTurnRequest,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw new Error("Model request was cancelled");

  const combined = combineSignals(signal, timeoutMs);
  try {
    const messages: ChatCompletionMessage[] = [{ role: "user", content: request.userPrompt }];
    let buffer = "";
    try {
      for await (const chunk of streamChatCompletion(
        provider,
        model,
        messages,
        combined.signal,
        undefined, // tools — never passed; Stage 1's protocol is plain-JSON-in-text, not native function-calling
        undefined, // projectInstructions — gets a misleading "Project instructions: " prefix, wrong fit
        request.systemPrompt, // skillsContext — appended raw/unlabeled, closest fit for the RESEARCH agent's contract
      )) {
        if (chunk.content) buffer += chunk.content; // .reasoning intentionally excluded — not action JSON
      }
    } catch (error) {
      const reason = combined.reason();
      if (reason === "timeout") throw new Error(`Model request timed out after ${timeoutMs}ms`);
      if (reason === "cancelled") throw new Error("Model request was cancelled");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Model request failed: ${message}`);
    }
    return buffer;
  } finally {
    combined.cleanup();
  }
}
