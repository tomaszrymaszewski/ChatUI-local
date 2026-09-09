// Guard against model turns that end with no visible output.
//
// Reasoning models on OpenAI-compatible endpoints can end a turn with ONLY
// reasoning: the provider drops the stream mid-thought (e.g. serverless
// preemption) or the output-token budget runs out before any text or tool
// calls are produced. LangChain's model router treats such a response as a
// normal final answer and ends the run — with no error anywhere. In the UI
// this shows up as a thought process that stops mid-sentence and then
// nothing, which looks like the agent was "cut off".
//
// This middleware detects that state (an AIMessage with no text content and
// no tool calls) and re-invokes the model with a nudge appended to the
// system message, up to a bounded number of retries. If every attempt comes
// back empty it throws a descriptive error so the failure is visible in the
// UI instead of silently ending the run. The empty attempts never reach the
// graph state — only the final response is returned to the agent.

import { AIMessage, createMiddleware } from "langchain";

/** Extra model attempts after the first comes back empty (3 calls total). */
const MAX_RETRIES = 2;

const RETRY_NOTE =
  " IMPORTANT NOTE: Your previous response attempt ended without producing any visible output or tool calls — it was cut off. Do not restart the task and do not repeat your earlier reasoning. Continue from where you left off and produce your answer or the next tool calls now.";

/**
 * True when the model produced something the agent loop can act on: tool
 * calls or non-empty text. Reasoning-only or fully empty messages return
 * false — that is the silent cut-off state this middleware guards against.
 */
function hasVisibleOutput(msg: AIMessage): boolean {
  if (msg.tool_calls?.length) return true;
  const content = msg.content;
  if (typeof content === "string") return content.trim().length > 0;
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim().length > 0,
    )
  );
}

export function emptyResponseGuardMiddleware() {
  return createMiddleware({
    name: "emptyResponseGuard",
    wrapModelCall: async (request, handler) => {
      let response = await handler(request);
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (!AIMessage.isInstance(response) || hasVisibleOutput(response)) return response;
        // Retry with the nudge appended to the ORIGINAL system message, so
        // repeated retries never stack notes.
        response = await handler(
          request.systemMessage
            ? { ...request, systemMessage: request.systemMessage.concat(RETRY_NOTE) }
            : { ...request, systemPrompt: `${request.systemPrompt ?? ""}${RETRY_NOTE}` },
        );
      }
      if (AIMessage.isInstance(response) && !hasVisibleOutput(response)) {
        throw new Error(
          "The model ended this turn with no visible output — its response was likely cut off mid-reasoning by the provider. Try sending again or switching models.",
        );
      }
      return response;
    },
  });
}
