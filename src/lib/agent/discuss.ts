// Discuss mode — a multi-agent deliberation pipeline orchestrated by a Chairman.
//
// Every stage is anchored to the user's ORIGINAL question (the last user message,
// verbatim). The chairman may sharpen the question into a revised_query, but the
// verbatim question always accompanies it so no stage can drift onto an earlier
// conversation topic.
//
// Roles:
//   - Contrarian: critiques the Expansionist's proposal (pessimist vs. optimist).
//   - First-Principles Thinker: critiques the Outsider's proposal (rigor vs. lateral).
//   - Expansionist: optimistic, pushes boundaries.
//   - Outsider: lateral, unconventional perspective.
//   - Chairman: coordinates, asks clarifying questions, synthesizes the final answer.
//
// Stages:
//   0. Alignment — the chairman checks if the query is clear enough. If not, it asks
//      clarifying questions (including about per-role models) and stops. The user's
//      answers come back through chat history on the next send.
//   1. Independent positions (parallel) — each role agent does moderate research and
//      writes its full reasoning trace.
//   2. Sparse pairing critique (parallel, 1 round) — Contrarian critiques Expansionist;
//      First-Principles critiques Outsider. Each sees the counterpart's full trace +
//      digests of the other two.
//   2b. Alignment check — if all four positions are substantively aligned, skip Stage 3.
//   3. Rebuttal (parallel, only if not aligned) — Expansionist answers Contrarian;
//      Outsider answers First-Principles.
//   4. Synthesis — the chairman reads all full reasoning traces and writes the final
//      answer, assembling correct intermediate steps even if that means overriding
//      an apparent 3-1 consensus.

import { createAgent, tool, toolCallLimitMiddleware } from "langchain";
import { z } from "zod";
import type { Provider } from "@/types";
import type { ContentPart } from "@/lib/llm";
import { createChatModel } from "@/lib/agent/models";
import { resolveHistoryBudget, truncateMessagesToBudget } from "@/lib/agent/history";
import type { AgentEvent, StructuredInputRequest } from "@/lib/agent/types";
import type { AgentMessage } from "@/lib/agent/runtime";
import { defaultCouncilRoster } from "@/lib/council-roster";

export interface DiscussOptions {
  provider: Provider;
  modelName: string;
  messages: AgentMessage[];
  instructions?: string;
  webFetchEnabled: boolean;
  projectDir?: string | null;
  availableModels: Array<{ name: string; providerId: string; displayName?: string }>;
  providers: Provider[];
}

type InputResolution = { cancelled: true } | { values: Record<string, unknown> };

/** Tool calls per panelist: enough for 2-3 searches plus a few full-page fetches. */
const ROLE_LIMIT = 8;

const ALIGNMENT_SCHEMA = z.object({
  status: z.enum(["clarify", "ready"]).describe("'clarify' if the query is too vague; 'ready' if you can proceed."),
  questions: z
    .array(
      z.object({
        question: z.string().describe("A concise clarifying question for the user."),
        placeholder: z.string().optional().describe("A hint or example answer."),
      }),
    )
    .max(3)
    .describe("Clarifying questions. Empty when status is 'ready'."),
  revised_query: z
    .string()
    .optional()
    .describe("The sharpened, specific version of the user's question. Required when status is 'ready'."),
  model_assignments: z
    .object({
      contrarian: z.string().optional(),
      first_principles: z.string().optional(),
      expansionist: z.string().optional(),
      outsider: z.string().optional(),
    })
    .optional()
    .describe("Per-role model names if the user has already expressed a preference in chat history. Omit to let the setup form handle it or use defaults."),
});

const ALIGNMENT_CHECK_SCHEMA = z.object({
  aligned: z.boolean().describe("True if all four positions are substantively aligned with no interesting tension."),
  rationale: z.string().describe("Why the positions are or aren't aligned."),
});

const DIGEST_SCHEMA = z.object({
  contrarian: z.string().describe("2-3 sentence digest of the Contrarian's position: key claim and main reasoning."),
  first_principles: z.string().describe("2-3 sentence digest of the First-Principles Thinker's position: key claim and main reasoning."),
  expansionist: z.string().describe("2-3 sentence digest of the Expansionist's position: key claim and main reasoning."),
  outsider: z.string().describe("2-3 sentence digest of the Outsider's position: key claim and main reasoning."),
});

// Shared output contract for all panelists. Kept short on purpose: these
// prompts are paid for in the model's working memory on every tool loop.
const ROLE_OUTPUT_RULES = `If you need facts, research quietly with your tools — but your tool budget is tiny, so run at most 2 searches; if results are poor, stop searching and rely on your own knowledge instead of retrying. Never narrate searches or plans. Your final message must be your position itself: clear claims, evidence, and step-by-step reasoning, citing source URLs where you have them. Never submit a log of what you tried or a list of next steps. Always finish by writing your full position — that is the deliverable.`;

const ROLE_PROMPTS: Record<string, string> = {
  contrarian: `You are the CONTRARIAN on a deliberation panel. Your instinct is skepticism: find the weakest assumptions, the failure modes, and where the consensus could be wrong. Be rigorous and specific — never "it depends."\n\n${ROLE_OUTPUT_RULES}`,

  first_principles: `You are the FIRST-PRINCIPLES THINKER on a deliberation panel. Strip away assumptions and build your answer step by step from fundamental, verifiable truths. Don't accept conventional wisdom.\n\n${ROLE_OUTPUT_RULES}`,

  expansionist: `You are the EXPANSIONIST on a deliberation panel. Your instinct is optimism and scale: the best case, the upside, how this could be bigger than people think. Be ambitious but grounded in evidence.\n\n${ROLE_OUTPUT_RULES}`,

  outsider: `You are the OUTSIDER on a deliberation panel. Think laterally: draw on adjacent fields and unexpected analogies, and challenge the framing of the question itself.\n\n${ROLE_OUTPUT_RULES}`,
};

const CRITIC_PROMPT = `You are a critic on a deliberation panel. Critique the given reasoning trace specifically and rigorously: wrong or outdated facts, flawed reasoning, what it misses, and where it is right. Cite evidence — show exactly where and why, not just "I disagree". Your critique helps the chairman decide which reasoning steps are correct.`;

const REBUTTAL_PROMPT = `You are answering a critique of your position on a deliberation panel. Acknowledge what the critic got right, defend what you still believe with evidence, and revise where the critique is valid. Be rigorous — don't stubbornly repeat your original answer.`;

const CHAIRMAN_SYNTHESIS_PROMPT = `You are the CHAIRMAN of a deliberation panel synthesizing its final answer from the positions, critiques, and rebuttals.

- Assemble correct reasoning steps wherever they appear — even if that overrides a 3-1 consensus.
- Discount low-quality traces (e.g. research logs); lean on the substantive ones.
- Be honest about where the panel agreed, disagreed, and where tension was productive.
- Write a clear, well-structured answer the user can act on.

Do NOT just summarize — ASSESS and DECIDE.`.trim();

function currentDate(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Cap each reasoning trace before it is fed to the synthesis prompt. Four full
 * traces + critiques + rebuttals can easily exceed the chairman model's context
 * window, which makes the final request fail or hang indefinitely.
 */
const TRACE_CHAR_LIMIT = 6000;
function truncateTrace(trace: string): string {
  if (!trace) return "(no output)";
  if (trace.length <= TRACE_CHAR_LIMIT) return trace;
  return trace.slice(0, TRACE_CHAR_LIMIT) + "\n\n[…trace truncated for length…]";
}

/** Tighter cap for chairman side-stages (digest, alignment check) that only
 *  need the gist of each trace — keeps those calls fast and cheap on context. */
function sliceFor(text: string, limit: number): string {
  if (!text) return "(no output)";
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n[…truncated…]";
}

/** Flatten a message content (string or content parts) into plain text. */
function contentToString(content: string | ContentPart[] | unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as ContentPart[])
      .map((part) => (part.type === "image_url" ? "[image attached]" : part.text ?? ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** The user's question under deliberation — always the LAST user message, verbatim. */
function extractOriginalQuery(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const text = contentToString(messages[i].content).trim();
      if (text) return text;
    }
  }
  return "Discuss this topic.";
}

/**
 * Build the question brief handed to every panel stage. The verbatim user
 * question comes first so no stage can drift onto an earlier conversation
 * topic; the chairman's sharpened framing and any setup answers follow as
 * supplementary context.
 */
function buildQuestionBrief(originalQuery: string, revisedQuery: string, setupAnswers?: string): string {
  const parts = [`## The user's question (verbatim)\n${originalQuery}`];
  const revised = revisedQuery.trim();
  if (revised && revised !== originalQuery.trim()) {
    parts.push(`## Chairman's sharpened framing\n${revised}`);
  }
  if (setupAnswers && setupAnswers.trim()) {
    parts.push(`## Clarification provided during panel setup\n${setupAnswers.trim()}`);
  }
  return parts.join("\n\n");
}

/**
 * Run an agent with streamEvents v3, emitting reasoning tokens to the UI
 * while accumulating text internally. Returns the full text content.
 */
async function streamAgentWithReasoning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any,
  input: Record<string, unknown>,
  emit: (event: AgentEvent) => void,
  reasoningId: string,
  reasoningLabel: string,
  signal: AbortSignal,
): Promise<string> {
  let content = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = await agent.streamEvents(input, { version: "v3", signal });
  for await (const msg of stream.messages) {
    await Promise.all([
      (async () => {
        for await (const token of msg.text) {
          content += token;
        }
      })(),
      (async () => {
        for await (const token of msg.reasoning) {
          emit({ type: "reasoning", text: token, id: reasoningId, label: reasoningLabel });
        }
      })(),
    ]);
  }
  try {
    await stream.output;
  } catch {
    // stream may end via abort
  }
  return content;
}

/**
 * Invoke an agent with a structured response format while streaming reasoning
 * tokens to the UI. Returns the full result including structuredResponse.
 */
async function invokeStructuredWithReasoning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any,
  input: Record<string, unknown>,
  emit: (event: AgentEvent) => void,
  reasoningId: string,
  reasoningLabel: string,
  signal: AbortSignal,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const stream = await agent.streamEvents(input, { version: "v3", signal });
  for await (const msg of stream.messages) {
    for await (const token of msg.reasoning) {
      emit({ type: "reasoning", text: token, id: reasoningId, label: reasoningLabel });
    }
  }
  try {
    return await stream.output;
  } catch {
    // stream may end via abort
    return undefined;
  }
}

function toLcMessages(messages: AgentMessage[]): Array<{ role: string; content: unknown }> {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    const blocks = (m.content as ContentPart[]).map((part) =>
      part.type === "image_url"
        ? { type: "image_url", image_url: { url: part.image_url?.url ?? "" } }
        : { type: "text", text: part.text ?? "" },
    );
    return { role: m.role, content: blocks };
  });
}

const ROLE_NAMES = ["contrarian", "first_principles", "expansionist", "outsider"] as const;
type RoleName = (typeof ROLE_NAMES)[number];

function resolveRoleModels(
  assignments: { contrarian?: string; first_principles?: string; expansionist?: string; outsider?: string } | undefined,
  availableModels: Array<{ name: string; providerId: string }>,
  selectedModel: string,
): Record<RoleName, string> {
  const defaults = defaultCouncilRoster(
    availableModels.map((m) => ({ name: m.name, providerId: m.providerId })),
    selectedModel,
  );

  const resolve = (role: RoleName, idx: number): string => {
    const assigned = assignments?.[role];
    if (assigned && availableModels.some((m) => m.name === assigned)) return assigned;
    return defaults[idx] ?? selectedModel;
  };

  return {
    contrarian: resolve("contrarian", 0),
    first_principles: resolve("first_principles", 1),
    expansionist: resolve("expansionist", 2),
    outsider: resolve("outsider", 3),
  };
}

async function resolveModel(
  modelName: string,
  providers: Provider[],
): Promise<{ provider: Provider; model: Awaited<ReturnType<typeof createChatModel>> } | null> {
  for (const p of providers) {
    if (p.models.some((m) => m.name === modelName)) {
      const model = await createChatModel(p, modelName);
      return { provider: p, model };
    }
  }
  return null;
}

function buildRoleTools(
  emit: (event: AgentEvent) => void,
  subagentId: string,
  subagentLabel: string,
  signal: AbortSignal,
  webFetchEnabled: boolean,
) {
  if (!webFetchEnabled) return [];
  let toolCounter = 0;
  return [
    tool(
      async ({ query }: { query: string }) => {
        const toolId = `${subagentId}-search-${++toolCounter}`;
        emit({
          type: "activity",
          activity: {
            id: toolId,
            kind: "tool",
            name: "web_search",
            status: "running",
            label: `${subagentLabel}: Searching "${query.slice(0, 40)}"`,
            parentId: subagentId,
          },
        });
        const { webSearch } = await import("@/lib/agent/web-search");
        const results = await webSearch(query, 5, signal);
        emit({
          type: "activity",
          activity: { id: toolId, kind: "tool", name: "web_search", status: "done", parentId: subagentId },
        });
        if (results.length === 0) return `No results for "${query}".`;
        return results
          .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}${r.snippet ? `\n    ${r.snippet}` : ""}`)
          .join("\n\n");
      },
      {
        name: "web_search",
        description: "Search the web for information.",
        schema: z.object({ query: z.string() }),
      },
    ),
    tool(
      async ({ url }: { url: string }) => {
        const toolId = `${subagentId}-fetch-${++toolCounter}`;
        let hostname = url;
        try { hostname = new URL(url).hostname; } catch { /* keep raw */ }
        emit({
          type: "activity",
          activity: {
            id: toolId,
            kind: "tool",
            name: "web_fetch",
            status: "running",
            label: `${subagentLabel}: Reading ${hostname}`,
            parentId: subagentId,
          },
        });
        emit({
          type: "activity",
          activity: {
            id: `${toolId}-src`,
            kind: "source",
            name: hostname,
            status: "running",
            url,
            title: hostname,
            label: hostname,
            parentId: subagentId,
          },
        });
        const { httpFetch } = await import("@/lib/http-fetch");
        try {
          const resp = await httpFetch(url);
          if (resp.status < 200 || resp.status >= 300) {
            emit({ type: "activity", activity: { id: toolId, kind: "tool", name: "web_fetch", status: "error", parentId: subagentId } });
            emit({ type: "activity", activity: { id: `${toolId}-src`, kind: "source", name: hostname, status: "error", url, title: hostname, parentId: subagentId } });
            return `Error: HTTP ${resp.status}`;
          }
          let body: string;
          if (resp.contentType.includes("text/html")) {
            body = resp.body
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<nav[\s\S]*?<\/nav>/gi, "")
              .replace(/<footer[\s\S]*?<\/footer>/gi, "")
              .replace(/<header[\s\S]*?<\/header>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 6000);
          } else {
            body = resp.body.slice(0, 6000);
          }
          emit({ type: "activity", activity: { id: toolId, kind: "tool", name: "web_fetch", status: "done", parentId: subagentId } });
          emit({ type: "activity", activity: { id: `${toolId}-src`, kind: "source", name: hostname, status: "done", url, title: hostname, parentId: subagentId } });
          return body;
        } catch (err) {
          emit({ type: "activity", activity: { id: toolId, kind: "tool", name: "web_fetch", status: "error", parentId: subagentId } });
          emit({ type: "activity", activity: { id: `${toolId}-src`, kind: "source", name: hostname, status: "error", url, title: hostname, parentId: subagentId } });
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
      {
        name: "web_fetch",
        description: "Fetch the full content of a web page URL.",
        schema: z.object({ url: z.string() }),
      },
    ),
  ];
}

async function runRoleAgent(
  role: RoleName,
  modelName: string,
  providers: Provider[],
  brief: string,
  webFetchEnabled: boolean,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<string> {
  const actId = `role-${role}`;
  const roleLabel = role.replace(/_/g, " ");
  emit({
    type: "activity",
    activity: {
      id: actId,
      kind: "subagent",
      name: roleLabel,
      status: "running",
      label: `${roleLabel}: researching`,
    },
  });

  try {
    const resolved = await resolveModel(modelName, providers);
    const model = resolved?.model ?? (await createChatModel(providers[0], modelName));

    const agent = createAgent({
      model,
      tools: buildRoleTools(emit, actId, roleLabel, signal, webFetchEnabled),
      systemPrompt: `${ROLE_PROMPTS[role]}\n\nToday's date: ${currentDate()}`,
      middleware: [toolCallLimitMiddleware({ runLimit: ROLE_LIMIT, exitBehavior: "continue" })],
    });

    // Some models burn their whole tool budget on searches (especially when the
    // results are poor) and end the run without ever writing a position. Run once
    // with tools; if that yields no real trace, re-run WITHOUT tools so the
    // panelist writes straight from knowledge instead of looping on searches.
    // Downstream stages need a real trace.
    let content = await streamAgentWithReasoning(
      agent,
      { messages: [{ role: "user", content: `${brief}\n\nResearch if needed, then take your position on the question above.` }] },
      emit,
      actId,
      roleLabel,
      signal,
    );
    if (content.trim().length < 300 && !signal.aborted) {
      const fallback = createAgent({
        model,
        tools: [],
        systemPrompt: `${ROLE_PROMPTS[role]}\n\nToday's date: ${currentDate()}`,
      });
      content = await streamAgentWithReasoning(
        fallback,
        { messages: [{ role: "user", content: `${brief}\n\nWrite your full position on the question above now, from your own knowledge.` }] },
        emit,
        actId,
        roleLabel,
        signal,
      );
    }

    if (!content.trim()) {
      const errText = `${roleLabel} produced no output.`;
      emit({ type: "activity", activity: { id: actId, kind: "subagent", name: roleLabel, status: "error", output: errText } });
      return errText;
    }

    emit({ type: "activity", activity: { id: actId, kind: "subagent", name: roleLabel, status: "done", output: content } });
    return content;
  } catch (err) {
    const errText = `Error: ${err instanceof Error ? err.message : String(err)}`;
    emit({ type: "activity", activity: { id: actId, kind: "subagent", name: roleLabel, status: "error", output: errText } });
    return errText;
  }
}

export async function runDiscuss(
  opts: DiscussOptions,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
  requestInput?: (req: StructuredInputRequest) => Promise<InputResolution>,
  _clearPendingInput?: () => void,
): Promise<{ completed: boolean }> {
  const chairmanModel = await createChatModel(opts.provider, opts.modelName);
  const historyBudget = await resolveHistoryBudget(opts.provider, opts.modelName);
  const lcMessages = toLcMessages(
    truncateMessagesToBudget(opts.messages, historyBudget),
  );

  // The question under deliberation is ALWAYS the last user message, verbatim.
  // Every stage below receives it so the panel can never drift onto an earlier
  // conversation topic.
  const originalQuery = extractOriginalQuery(opts.messages);

  // ─── Stage 0: Alignment ─────────────────────────────────────────────────
  const modelList = opts.availableModels
    .map((m) => `- ${m.name} (${m.displayName ?? m.name})`)
    .join("\n");

  const chairmanAlignmentPrompt = `You are the CHAIRMAN of a deliberation panel (Contrarian, First-Principles Thinker, Expansionist, Outsider). Decide whether the user's question is clear enough to proceed or needs clarifying questions.

The question under deliberation is the LAST user message, quoted verbatim:
"""
${originalQuery}
"""
Earlier messages are background only — never substitute an earlier topic for this question.

Available models for per-role assignment:
${modelList}

Rules:
- Vague or ambiguous question → status "clarify" with up to 3 concise, specific questions.
- Clear question → status "ready" with a revised_query that sharpens the CURRENT question (same subject, more specific).
- Never ask about model preferences; fill model_assignments only if the user already stated one earlier in the chat.
- Don't over-clarify simple questions.`;

  emit({
    type: "activity",
    activity: {
      id: "stage-alignment",
      kind: "tool",
      name: "Chairman",
      status: "running",
      label: "Chairman: assessing the question",
    },
  });

  let revisedQuery = "";
  let setupAnswers = "";
  let modelAssignments: { contrarian?: string; first_principles?: string; expansionist?: string; outsider?: string } | undefined;

  try {
    const alignmentAgent = createAgent({
      model: chairmanModel,
      systemPrompt: chairmanAlignmentPrompt,
      responseFormat: ALIGNMENT_SCHEMA,
    });
    // Only recent history is needed for the alignment decision; dropping older
    // messages keeps large earlier conversations from dominating the decision.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await invokeStructuredWithReasoning(
      alignmentAgent,
      { messages: lcMessages.slice(-16) as any },
      emit,
      "stage-alignment",
      "Chairman",
      signal,
    );
    // A missing structuredResponse (unsupported model, aborted stream) is
    // treated as "ready" so the setup form still lets the user pick models.
    const response = (result?.structuredResponse as {
      status: "clarify" | "ready";
      questions?: Array<{ question: string; placeholder?: string }>;
      revised_query?: string;
      model_assignments?: typeof modelAssignments;
    } | undefined) ?? { status: "ready" as const };

    if (requestInput) {
      const questions = response.status === "clarify" ? (response.questions ?? []) : [];

      if (response.status === "clarify" && questions.length === 0) {
        // Clarify requested but no questions parsed — fall through to ready.
        revisedQuery = response.revised_query ?? originalQuery;
        modelAssignments = response.model_assignments;
      } else {
        // Build a structured setup form: textareas for each clarifying question
        // (if any) plus per-role model selects. Always shown so the user can
        // pick models even when the chairman deems the question clear.
        const modelOptions = opts.availableModels.map((m) => m.displayName ?? m.name);
        const setupReq: StructuredInputRequest = {
          title: "Panel Setup",
          description: questions.length > 0
            ? "The chairman needs a few details before convening the panel."
            : "Pick models for each panelist, then start the discussion.",
          submitLabel: "Start Discussion",
          fields: [
            ...questions.map((q, i) => ({
              name: `q${i}`,
              label: q.question,
              type: "textarea" as const,
              description: q.placeholder,
            })),
            {
              name: "model_contrarian",
              label: "Model for Contrarian",
              type: "select" as const,
              description: "Leave empty to use the default spread.",
              options: modelOptions,
            },
            {
              name: "model_first_principles",
              label: "Model for First-Principles Thinker",
              type: "select" as const,
              description: "Leave empty to use the default spread.",
              options: modelOptions,
            },
            {
              name: "model_expansionist",
              label: "Model for Expansionist",
              type: "select" as const,
              description: "Leave empty to use the default spread.",
              options: modelOptions,
            },
            {
              name: "model_outsider",
              label: "Model for Outsider",
              type: "select" as const,
              description: "Leave empty to use the default spread.",
              options: modelOptions,
            },
          ],
        };

        emit({
          type: "activity",
          activity: { id: "stage-alignment", kind: "tool", name: "Chairman", status: "done" },
        });

        const resolution = await requestInput(setupReq);
        if ("cancelled" in resolution) {
          // User switched to free text — emit the questions as chat context and
          // stop. Discuss mode stays on so the next send re-enters the pipeline
          // with the user's answer in history.
          if (questions.length > 0) {
            emit({ type: "token", text: questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n\n") });
          }
          return { completed: false };
        }

        // Collect the Q/A pairs — they are folded into the question brief so
        // every panel stage sees the clarification.
        setupAnswers = questions
          .map((q, i) => {
            const val = resolution.values[`q${i}`];
            return val ? `Q: ${q.question}\nA: ${val}` : null;
          })
          .filter(Boolean)
          .join("\n\n");

        // Map selected model display names to model names.
        const resolveModelName = (val: unknown): string | undefined => {
          if (typeof val !== "string" || !val) return undefined;
          const match = opts.availableModels.find((m) => (m.displayName ?? m.name) === val);
          return match?.name ?? (opts.availableModels.some((m) => m.name === val) ? val : undefined);
        };
        modelAssignments = {
          contrarian: resolveModelName(resolution.values["model_contrarian"]),
          first_principles: resolveModelName(resolution.values["model_first_principles"]),
          expansionist: resolveModelName(resolution.values["model_expansionist"]),
          outsider: resolveModelName(resolution.values["model_outsider"]),
        };
        // Drop undefined values so defaults fill in.
        modelAssignments = Object.fromEntries(
          Object.entries(modelAssignments).filter(([, v]) => v),
        ) as typeof modelAssignments;

        revisedQuery = response.revised_query ?? originalQuery;
      }
    } else {
      // No structured input available.
      if (response.status === "clarify" && response.questions && response.questions.length > 0) {
        emit({
          type: "activity",
          activity: { id: "stage-alignment", kind: "tool", name: "Chairman", status: "done" },
        });
        emit({ type: "token", text: response.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n\n") });
        return { completed: false };
      } else {
        revisedQuery = response.revised_query ?? originalQuery;
        modelAssignments = response.model_assignments;
      }
    }
  } catch {
    // Fallback: proceed with the user's verbatim question.
    revisedQuery = originalQuery;
  }

  // Abort check — user may have stopped during the form.
  if (signal.aborted) return { completed: false };

  emit({
    type: "activity",
    activity: { id: "stage-alignment", kind: "tool", name: "Chairman", status: "done" },
  });

  // ─── Resolve role models ────────────────────────────────────────────────
  const roleModels = resolveRoleModels(modelAssignments, opts.availableModels, opts.modelName);

  // ─── Stage 1: Independent positions (parallel) ──────────────────────────
  const questionBrief = buildQuestionBrief(originalQuery, revisedQuery, setupAnswers);
  const positions = await Promise.all(
    ROLE_NAMES.map((role) =>
      runRoleAgent(role, roleModels[role], opts.providers, questionBrief, opts.webFetchEnabled, emit, signal),
    ),
  );

  const positionMap = Object.fromEntries(ROLE_NAMES.map((r, i) => [r, positions[i]])) as Record<RoleName, string>;

  // ─── Digest: chairman produces 2-3 sentence digests of each position ────
  let digestMap: Record<RoleName, string> = {
    contrarian: "",
    first_principles: "",
    expansionist: "",
    outsider: "",
  };
  try {
    const digestAgent = createAgent({
      model: chairmanModel,
      systemPrompt: "Write a 2-3 sentence digest of each panelist's position: key claim and main reasoning.",
      responseFormat: DIGEST_SCHEMA,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const digestResult = await invokeStructuredWithReasoning(
      digestAgent,
      {
        messages: [
          {
            role: "user",
            content: `Question under deliberation:\n\n${questionBrief}\n\nDigest each position:\n\n${ROLE_NAMES.map((r) => `### ${r.replace(/_/g, " ")}\n${sliceFor(positionMap[r], 2500)}`).join("\n\n")}`,
          },
        ] as any,
      },
      emit,
      "stage-digest",
      "Chairman digest",
      signal,
    );
    const parsed = digestResult?.structuredResponse as z.infer<typeof DIGEST_SCHEMA> | undefined;
    if (parsed) {
      digestMap = {
        contrarian: parsed.contrarian ?? "",
        first_principles: parsed.first_principles ?? "",
        expansionist: parsed.expansionist ?? "",
        outsider: parsed.outsider ?? "",
      };
    }
  } catch {
    // fall through to the truncated-slice fallback below
  }
  for (const r of ROLE_NAMES) {
    if (!digestMap[r].trim()) digestMap[r] = positionMap[r].slice(0, 400);
  }

  // ─── Stage 2: Sparse pairing critique (parallel, 1 round) ───────────────
  // Contrarian critiques Expansionist; First-Principles critiques Outsider.
  const pairings: Array<{ critic: RoleName; target: RoleName; otherDigests: string }> = [
    {
      critic: "contrarian",
      target: "expansionist",
      otherDigests: `### First-Principles Thinker (digest)\n${digestMap.first_principles}\n### Outsider (digest)\n${digestMap.outsider}`,
    },
    {
      critic: "first_principles",
      target: "outsider",
      otherDigests: `### Contrarian (digest)\n${digestMap.contrarian}\n### Expansionist (digest)\n${digestMap.expansionist}`,
    },
  ];

  const critiques = await Promise.all(
    pairings.map(async ({ critic, target, otherDigests }) => {
      const actId = `critique-${critic}`;
      emit({
        type: "activity",
        activity: {
          id: actId,
          kind: "subagent",
          name: `${critic.replace(/_/g, " ")} → ${target.replace(/_/g, " ")}`,
          status: "running",
          label: `${critic.replace(/_/g, " ")}: critiquing ${target.replace(/_/g, " ")}`,
        },
      });
      try {
        const resolved = await resolveModel(roleModels[critic], opts.providers);
        const model = resolved?.model ?? chairmanModel;
        const agent = createAgent({
          model,
          systemPrompt: `${CRITIC_PROMPT}\n\nToday's date: ${currentDate()}`,
        });
        const content = await streamAgentWithReasoning(
          agent,
          {
            messages: [
              {
                role: "user",
                content: `Question under deliberation:\n\n${questionBrief}\n\nYou are the ${critic.replace(/_/g, " ")}. Critique the ${target.replace(/_/g, " ")}'s position.\n\n## The ${target.replace(/_/g, " ")}'s reasoning trace:\n${truncateTrace(positionMap[target])}\n\n## Digests of other positions:\n${otherDigests}`,
              },
            ],
          },
          emit,
          actId,
          `${critic.replace(/_/g, " ")} critique`,
          signal,
        );
        emit({ type: "activity", activity: { id: actId, kind: "subagent", name: `${critic.replace(/_/g, " ")} → ${target.replace(/_/g, " ")}`, status: "done", output: content } });
        return content;
      } catch (err) {
        const errText = `Critique failed: ${err instanceof Error ? err.message : String(err)}`;
        emit({ type: "activity", activity: { id: actId, kind: "subagent", name: `${critic.replace(/_/g, " ")} → ${target.replace(/_/g, " ")}`, status: "error", output: errText } });
        return errText;
      }
    }),
  );

  const critiqueMap: Record<RoleName, string> = {
    contrarian: critiques[0],
    first_principles: critiques[1],
    expansionist: "",
    outsider: "",
  };

  // ─── Stage 2b: Alignment check ──────────────────────────────────────────
  let skipRebuttal = false;
  try {
    const checkAgent = createAgent({
      model: chairmanModel,
      systemPrompt: "Decide whether the panel's four positions are substantively aligned or carry genuine tension worth a rebuttal round.",
      responseFormat: ALIGNMENT_CHECK_SCHEMA,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checkResult = await invokeStructuredWithReasoning(
      checkAgent,
      {
        messages: [
          {
            role: "user",
            content: `Question under deliberation:\n\n${questionBrief}\n\n## The four positions:\n${ROLE_NAMES.map((r) => `### ${r.replace(/_/g, " ")}\n${sliceFor(positionMap[r], 3000)}`).join("\n\n")}\n\n## The critiques:\n${pairings.map((p) => `### ${p.critic.replace(/_/g, " ")} on ${p.target.replace(/_/g, " ")}\n${sliceFor(critiqueMap[p.critic], 2000)}`).join("\n\n")}\n\nAre all four positions substantively aligned with no interesting tension? If yes, the rebuttal round can be skipped.`,
          },
        ] as any,
      },
      emit,
      "stage-alignment-check",
      "Chairman alignment check",
      signal,
    );
    skipRebuttal = (checkResult?.structuredResponse as { aligned?: boolean })?.aligned ?? false;
  } catch {
    skipRebuttal = false;
  }

  // ─── Stage 3: Rebuttal (only if not aligned) ────────────────────────────
  if (!skipRebuttal) {
    const allRebuttalTargets: Array<{ responder: RoleName; critique: string }> = [
      { responder: "expansionist", critique: critiqueMap.contrarian },
      { responder: "outsider", critique: critiqueMap.first_principles },
    ];
    // Skip rebuttals whose critique came back empty or failed.
    const rebuttalTargets = allRebuttalTargets.filter(
      ({ critique }) => critique.trim() && !critique.startsWith("Critique failed"),
    );

    await Promise.all(
      rebuttalTargets.map(async ({ responder, critique }) => {
        const actId = `rebuttal-${responder}`;
        emit({
          type: "activity",
          activity: {
            id: actId,
            kind: "subagent",
            name: `${responder.replace(/_/g, " ")} rebuttal`,
            status: "running",
            label: `${responder.replace(/_/g, " ")}: rebutting`,
          },
        });
        try {
          const resolved = await resolveModel(roleModels[responder], opts.providers);
          const model = resolved?.model ?? chairmanModel;
          const agent = createAgent({
            model,
            systemPrompt: REBUTTAL_PROMPT,
          });
          const content = await streamAgentWithReasoning(
            agent,
            {
              messages: [
                {
                  role: "user",
                  content: `Question under deliberation:\n\n${questionBrief}\n\nYou are the ${responder.replace(/_/g, " ")}. Your original position:\n\n${truncateTrace(positionMap[responder])}\n\nCritique of your position:\n\n${truncateTrace(critique)}\n\nRespond to the critique.`,
                },
              ],
            },
            emit,
            actId,
            `${responder.replace(/_/g, " ")} rebuttal`,
            signal,
          );
          positionMap[responder] = `${positionMap[responder]}\n\n## Rebuttal\n${content}`;
          emit({ type: "activity", activity: { id: actId, kind: "subagent", name: `${responder.replace(/_/g, " ")} rebuttal`, status: "done", output: content } });
        } catch (err) {
          emit({ type: "activity", activity: { id: actId, kind: "subagent", name: `${responder.replace(/_/g, " ")} rebuttal`, status: "error", output: `Rebuttal failed: ${err instanceof Error ? err.message : String(err)}` } });
        }
      }),
    );
  }

  // ─── Stage 4: Synthesis ────────────────────────────────────────────────
  emit({
    type: "activity",
    activity: {
      id: "stage-synthesis",
      kind: "tool",
      name: "Chairman synthesis",
      status: "running",
      label: "Chairman: writing final answer",
    },
  });

  const allTraces = ROLE_NAMES.map((r) =>
    `### ${r.replace(/_/g, " ")} — full reasoning trace\n${truncateTrace(positionMap[r])}`,
  ).join("\n\n---\n\n");

  const critiqueTraces = pairings.map((p) =>
    `### ${p.critic.replace(/_/g, " ")} critiquing ${p.target.replace(/_/g, " ")}\n${truncateTrace(critiqueMap[p.critic])}`,
  ).join("\n\n---\n\n");

  // The synthesis call is the largest request in the pipeline and can stall if
  // the provider buffers or drops it. Watch for an idle stream and abort so the
  // run always terminates (the partial positions above are already persisted).
  const synthAbort = new AbortController();
  let idleTimedOut = false;
  const onParentAbort = () => synthAbort.abort();
  signal.addEventListener("abort", onParentAbort);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      synthAbort.abort();
    }, 60000);
  };
  resetIdle();

  let synthesisContent = "";

  try {
    const synthesisAgent = createAgent({
      model: chairmanModel,
      systemPrompt: CHAIRMAN_SYNTHESIS_PROMPT,
    });

    const stream = await synthesisAgent.streamEvents(
      {
        messages: [
          {
            role: "user",
            content: `The user's question:\n\n${questionBrief}\n\n## Reasoning traces:\n\n${allTraces}\n\n## Critiques:\n\n${critiqueTraces}\n\n${skipRebuttal ? "(Rebuttal round skipped — the panel was aligned.)" : "(Rebuttals are included in the traces above.)"}\n\nStay on the question above — ignore any off-topic drift. Write your final synthesized answer now.`,
          },
        ],
      },
      { version: "v3", signal: synthAbort.signal },
    );

    for await (const msg of stream.messages) {
      await Promise.all([
        (async () => {
          for await (const token of msg.text) {
            resetIdle();
            synthesisContent += token;
          }
        })(),
        (async () => {
          for await (const token of msg.reasoning) {
            resetIdle();
            emit({ type: "reasoning", text: token, id: "stage-synthesis", label: "Chairman synthesis" });
          }
        })(),
      ]);
    }

    try {
      await stream.output;
    } catch {
      // stream may end via abort
    }
  } catch (err) {
    if (!signal.aborted) {
      const note = idleTimedOut
        ? "\n\n*Chairman synthesis timed out — the panel's positions above were preserved.*"
        : `\n\n*Synthesis failed: ${err instanceof Error ? err.message : String(err)}*`;
      emit({ type: "token", text: note });
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    signal.removeEventListener("abort", onParentAbort);
  }

  // Emit the synthesis as a markdown artifact so it opens in the side panel.
  if (synthesisContent.length > 0) {
    emit({
      type: "artifact",
      artifact: {
        id: `council-${Date.now()}`,
        title: "Discussion Brief",
        language: "markdown",
        content: synthesisContent,
        index: 0,
      },
    });

    // Produce a brief LLM-generated summary for the chat (the full synthesis
    // lives only in the artifact, not duplicated inline).
    try {
      const summaryAgent = createAgent({
        model: chairmanModel,
        systemPrompt: "You are the chairman of a deliberation panel. You just synthesized the panel's final answer into a discussion brief that is now open in the user's side panel as an editable artifact. Write 1-2 sentences telling the user what you produced and mentioning they can view, edit, and download it from the side panel. Be conversational and concise — do NOT repeat the brief content.",
      });
      const summaryStream = await summaryAgent.streamEvents(
        {
          messages: [
            {
              role: "user",
              content: `The user's question was: ${originalQuery}\nThe brief covers (first 500 chars): ${synthesisContent.slice(0, 500)}\n\nWrite a brief summary for the user.`,
            },
          ],
        },
        { version: "v3", signal },
      );
      for await (const msg of summaryStream.messages) {
        for await (const token of msg.text) {
          emit({ type: "token", text: token });
        }
      }
      try {
        await summaryStream.output;
      } catch {
        // stream may end via abort
      }
    } catch {
      emit({ type: "token", text: "I've synthesized the panel's deliberation into a discussion brief — it's open in the side panel where you can view, edit, and download it." });
    }
  }

  emit({
    type: "activity",
    activity: {
      id: "stage-synthesis",
      kind: "tool",
      name: "Chairman synthesis",
      status: "done",
    },
  });

  return { completed: !signal.aborted };
}
