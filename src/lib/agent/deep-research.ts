// Fixed-loop Deep Research pipeline — code-orchestrated, deterministic.
// When the user activates Deep Research mode, this runs instead of the normal
// single-agent session. Research ALWAYS happens because every stage is
// driven by TypeScript code, not by the model's willingness to follow a
// prompt.
//
// Stages:
//   0. Clarify — structured-output call checks if the topic is clear enough.
//      If not, a structured-input form asks the user clarifying questions.
//   1. Plan — structured-output call decomposes the topic into sub-questions.
//      The plan is shown to the user via a structured-input form for editing.
//   2. Research — one researcher agent per sub-question (max 3 concurrent),
//      each with web_search + web_fetch, capped by toolCallLimitMiddleware.
//      Every search and fetch emits tool/source activities visible in the UI.
//   3. Gap check (max 1 round) — structured call identifies 0–3 gaps; follow-up
//      research if needed.
//   4. Synthesize — streams a cited markdown report (Summary → themed sections →
//      Open Questions → Sources) as the visible reply, then emits a markdown
//      artifact programmatically.

import { createAgent, tool, toolCallLimitMiddleware } from "langchain";
import { z } from "zod";
import type { Provider } from "@/types";
import type { ContentPart } from "@/lib/llm";
import { createChatModel } from "@/lib/agent/models";
import { resolveHistoryBudget, truncateMessagesToBudget } from "@/lib/agent/history";
import type { AgentEvent, TodoItem, StructuredInputRequest } from "@/lib/agent/types";
import type { AgentMessage } from "@/lib/agent/runtime";

const MAX_SUBQUESTIONS = 8;
const MAX_CONCURRENT = 3;
const RESEARCHER_TOOL_LIMIT = 12;
const MAX_GAPS = 3;

export interface DeepResearchOptions {
  provider: Provider;
  modelName: string;
  messages: AgentMessage[];
  instructions?: string;
  webFetchEnabled: boolean;
  projectDir?: string | null;
}

type InputResolution = { cancelled: true } | { values: Record<string, unknown> };

const CLARIFY_SCHEMA = z.object({
  status: z.enum(["clarify", "ready"]).describe("'clarify' if the topic is too vague; 'ready' if you can proceed."),
  questions: z
    .array(
      z.object({
        question: z.string().describe("A clarifying question for the user."),
        placeholder: z.string().optional().describe("A hint or example answer."),
      }),
    )
    .max(5)
    .describe("Clarifying questions. Empty if status is 'ready'."),
  revised_topic: z
    .string()
    .optional()
    .describe("The sharpened research topic. Required when status is 'ready'."),
});

const RESEARCHER_INSTRUCTIONS = `You are a research assistant. For context, today's date is {date}.

Your job is to use tools to gather comprehensive information about the assigned sub-question.

Think like a thorough human researcher:
1. Read the question carefully — what specific information is needed?
2. Start with broader searches — use web_search with broad queries first.
3. Try multiple search queries with different phrasings to find diverse sources.
4. After each search, fetch the full content of promising URLs with web_fetch.
5. Aim to read at least 3–5 full pages, not just search snippets.
6. After each fetch, assess: do I have enough? What's missing?
7. Execute narrower searches to fill gaps.
8. Stop when you can answer confidently with multiple sources.

Tool Call Budget:
- Simple queries: 3–5 tool calls.
- Complex queries: up to 8 tool calls.
- Always fetch at least 2–3 promising URLs per search.
- Use diverse search phrasings to find different perspectives and sources.

When providing your findings:
1. Structure your response with clear headings and detailed explanations.
2. Cite sources inline using [1], [2], [3] format.
3. End with ### Sources listing each numbered source with title and URL.
4. Include direct quotes or specific data points from the sources.

Example:
## Key Findings
The topic is important because [1]. Additional context [2].

### Sources
[1] Source Title: https://example.com/source1
[2] Another Source: https://example.com/source2
`.trim();

const PLAN_SCHEMA = z.object({
  subquestions: z
    .array(z.string())
    .min(1)
    .max(MAX_SUBQUESTIONS)
    .describe("Focused sub-questions that together cover the research topic comprehensively. Use as many or as few as the topic genuinely needs (2–8 depending on breadth)."),
});

const GAP_SCHEMA = z.object({
  gaps: z
    .array(
      z.object({
        question: z.string().describe("A specific information gap."),
        query: z.string().describe("A search query to fill this gap."),
      }),
    )
    .max(MAX_GAPS)
    .describe("Information gaps remaining after the first research round. Empty if coverage is sufficient."),
});

const SYNTHESIS_INSTRUCTIONS = `You are a research synthesizer. You have been given findings from multiple research sub-agents, each covering a different sub-question of a research topic. Your job is to write a comprehensive, well-structured cited report.

## Report Structure
- **Summary** — a brief overview of the key findings (2–3 paragraphs).
- **Themed sections** — group findings by theme, not by sub-agent. Use ## headings.
- **Open Questions** — what remains unanswered or uncertain.
- **Sources** — a consolidated numbered list of all URLs cited across all findings.

## Citation Rules
- Cite sources inline using [1], [2], [3] format.
- Assign each unique URL a single citation number across ALL findings.
- Number sources sequentially without gaps (1, 2, 3, 4, …).
- Format: [1] Source Title: URL (each on a separate line).

## Style
- Write in paragraph form by default — be text-heavy, not just bullet points.
- Do NOT use self-referential language ("I found…", "I researched…").
- Write as a professional report without meta-commentary.
- Each section should be comprehensive and detailed.`.trim();

function currentDate(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Cap each researcher's findings before they are fed to the synthesis prompt.
 * Up to 8 sub-questions + 3 gaps of full findings can easily exceed the model's
 * context window, which makes the final synthesis fail or hang indefinitely.
 */
const FINDING_CHAR_LIMIT = 5000;
function truncateFinding(content: string): string {
  if (!content) return "(no findings)";
  if (content.length <= FINDING_CHAR_LIMIT) return content;
  return content.slice(0, FINDING_CHAR_LIMIT) + "\n\n[…findings truncated for length…]";
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

/** Run promises with a concurrency cap. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
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

/** Build researcher tools that emit activities (search chips, source links) to the UI. */
function buildResearcherTools(
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
      async ({ query, max_results }: { query: string; max_results?: number }) => {
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
        const results = await webSearch(query, max_results ?? 8, signal);

        emit({
          type: "activity",
          activity: { id: toolId, kind: "tool", name: "web_search", status: "done", parentId: subagentId },
        });

        if (results.length === 0)
          return `No results for "${query}". Try a different query.`;
        return results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n    URL: ${r.url}${r.snippet ? `\n    ${r.snippet}` : ""}`,
          )
          .join("\n\n");
      },
      {
        name: "web_search",
        description:
          "Search the web. Returns titles, URLs, and snippets. Use this first, then web_fetch on promising URLs.",
        schema: z.object({
          query: z.string(),
          max_results: z.number().optional(),
        }),
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
              .slice(0, 8000);
          } else {
            body = resp.body.slice(0, 8000);
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

export async function runDeepResearch(
  opts: DeepResearchOptions,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
  requestInput?: (req: StructuredInputRequest) => Promise<InputResolution>,
): Promise<{ completed: boolean }> {
  const model = await createChatModel(opts.provider, opts.modelName);
  const historyBudget = await resolveHistoryBudget(opts.provider, opts.modelName);
  let lcMessages = toLcMessages(
    truncateMessagesToBudget(opts.messages, historyBudget),
  );

  // ─── Stage 0: Clarify ───────────────────────────────────────────────────
  if (requestInput) {
    emit({
      type: "activity",
      activity: {
        id: "stage-clarify",
        kind: "tool",
        name: "Clarifying",
        status: "running",
        label: "Assessing research topic",
      },
    });

    try {
      const clarifyAgent = createAgent({
        model,
        systemPrompt: `You are a research coordinator. The user wants to research a topic. Decide whether the topic is clear enough to research, or whether you need to ask clarifying questions first.

Rules:
- If the topic is vague, ambiguous, or could be interpreted in very different ways, set status to "clarify" and write concise clarifying questions (max 5).
- If the topic is already clear, set status to "ready" with a revised_topic that sharpens the research focus.
- Don't over-clarify simple topics — only ask if the answers would meaningfully change the research direction.
- Each question should be specific and answerable in a sentence or two.`,
        responseFormat: CLARIFY_SCHEMA,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await invokeStructuredWithReasoning(
        clarifyAgent,
        { messages: lcMessages as any },
        emit,
        "stage-clarify",
        "Coordinator",
        signal,
      );
      const response = result?.structuredResponse as {
        status: "clarify" | "ready";
        questions?: Array<{ question: string; placeholder?: string }>;
        revised_topic?: string;
      };

      if (response.status === "clarify" && response.questions && response.questions.length > 0) {
        const clarifyReq: StructuredInputRequest = {
          title: "Research Clarification",
          description: "Answer the questions below to help focus the research.",
          submitLabel: "Start Research",
          fields: response.questions.map((q, i) => ({
            name: `q${i}`,
            label: q.question,
            type: "textarea" as const,
            description: q.placeholder,
          })),
        };

        emit({
          type: "activity",
          activity: { id: "stage-clarify", kind: "tool", name: "Clarifying", status: "done" },
        });

        const resolution = await requestInput(clarifyReq);
        if (!("cancelled" in resolution)) {
          const answers = response.questions
            .map((q, i) => {
              const val = resolution.values[`q${i}`];
              return val ? `Q: ${q.question}\nA: ${val}` : null;
            })
            .filter(Boolean)
            .join("\n\n");
          if (answers) {
            lcMessages = [
              ...lcMessages,
              { role: "user", content: `Research clarification:\n${answers}` },
            ];
          }
        }
      }
    } catch {
      // Clarification is best-effort; proceed without it.
    }

    emit({
      type: "activity",
      activity: { id: "stage-clarify", kind: "tool", name: "Clarifying", status: "done" },
    });
  }

  // ─── Stage 1: Plan ──────────────────────────────────────────────────────
  emit({
    type: "activity",
    activity: {
      id: "stage-plan",
      kind: "tool",
      name: "Planning",
      status: "running",
      label: "Planning research",
    },
  });

  let subquestions: string[] = [];
  try {
    const planAgent = createAgent({
      model,
      systemPrompt: `You are a research planner. Decompose the user's research topic into focused sub-questions that together cover the topic comprehensively. The number of sub-questions should match the scope of the topic: a narrow, specific question may only need 2–3 sub-questions, while a broad or multi-part topic may need up to ${MAX_SUBQUESTIONS}. Never pad with filler questions to reach a number, and never squeeze a broad topic into too few. Each sub-question should be answerable through web research. Return only the sub-questions.`,
      responseFormat: PLAN_SCHEMA,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await invokeStructuredWithReasoning(
      planAgent,
      { messages: lcMessages as any },
      emit,
      "stage-plan",
      "Planner",
      signal,
    );
    subquestions = (result?.structuredResponse as { subquestions?: string[] })?.subquestions ?? [];
  } catch {
    // Fallback: use the last user message as a single sub-question.
    const lastUser = [...lcMessages].reverse().find((m) => m.role === "user");
    const text = typeof lastUser?.content === "string" ? lastUser.content : "Research this topic";
    subquestions = [text];
  }

  if (subquestions.length === 0) {
    const lastUser = [...lcMessages].reverse().find((m) => m.role === "user");
    const text = typeof lastUser?.content === "string" ? lastUser.content : "Research this topic";
    subquestions = [text];
  }

  emit({
    type: "activity",
    activity: {
      id: "stage-plan",
      kind: "tool",
      name: "Planning",
      status: "done",
    },
  });

  // Let the user review and edit the plan.
  if (requestInput) {
    const planReq: StructuredInputRequest = {
      title: "Research Plan",
      description: "Review and edit the sub-questions below. Clear a field to remove it. Add new sub-questions in the last field.",
      submitLabel: "Start Research",
      fields: [
        ...subquestions.map((q, i) => ({
          name: `q${i}`,
          label: `Sub-question ${i + 1}`,
          type: "textarea" as const,
          default: q,
        })),
        {
          name: "additional",
          label: "Additional sub-questions (one per line)",
          type: "textarea" as const,
          description: "Add new sub-questions here, one per line.",
        },
      ],
    };

    const resolution = await requestInput(planReq);
    if (!("cancelled" in resolution)) {
      const edited: string[] = [];
      for (let i = 0; i < subquestions.length; i++) {
        const val = resolution.values[`q${i}`];
        if (val && String(val).trim()) edited.push(String(val).trim());
      }
      const additional = resolution.values["additional"];
      if (additional && String(additional).trim()) {
        for (const line of String(additional).split("\n")) {
          if (line.trim()) edited.push(line.trim());
        }
      }
      if (edited.length > 0) subquestions = edited;
    }
  }

  // Emit todos so the user sees the plan.
  const todos: TodoItem[] = subquestions.map((q, i) => ({
    content: q,
    status: i === 0 ? "in_progress" : "pending",
  }));
  emit({ type: "todos", todos });

  // ─── Stage 2: Research ──────────────────────────────────────────────────
  const researcherSystemPrompt = RESEARCHER_INSTRUCTIONS.replace("{date}", currentDate());

  const findings = await pool(subquestions, MAX_CONCURRENT, async (sq, i) => {
    const actId = `researcher-${i}`;
    const shortQ = sq.slice(0, 50);
    emit({
      type: "activity",
      activity: {
        id: actId,
        kind: "subagent",
        name: `Research: ${shortQ}`,
        status: "running",
        label: `Researching: ${sq.slice(0, 60)}`,
      },
    });

    try {
      const researcher = createAgent({
        model,
        tools: buildResearcherTools(emit, actId, `R${i + 1}`, signal, opts.webFetchEnabled),
        systemPrompt: researcherSystemPrompt,
        middleware: [
          toolCallLimitMiddleware({
            runLimit: RESEARCHER_TOOL_LIMIT,
            exitBehavior: "continue",
          }),
        ],
      });
      const content = await streamAgentWithReasoning(
        researcher,
        {
          messages: [
            {
              role: "user",
              content: `Research this sub-question thoroughly: ${sq}\n\nProvide your findings with inline citations [1], [2], etc. and a ### Sources section with URLs.`,
            },
          ],
        },
        emit,
        actId,
        `Researcher ${i + 1}`,
        signal,
      );

      emit({
        type: "activity",
        activity: { id: actId, kind: "subagent", name: `Research: ${shortQ}`, status: "done", output: content },
      });

      return { subquestion: sq, content };
    } catch (err) {
      emit({
        type: "activity",
        activity: { id: actId, kind: "subagent", name: `Research: ${shortQ}`, status: "error", output: `Research failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return {
        subquestion: sq,
        content: `Research failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  // Update todos — all research done.
  emit({
    type: "todos",
    todos: subquestions.map((q) => ({ content: q, status: "completed" as const })),
  });

  // ─── Stage 3: Gap check (max 1 round) ───────────────────────────────────
  let allFindings = findings.map((f) => `## Sub-question: ${f.subquestion}\n\n${truncateFinding(f.content)}`).join("\n\n---\n\n");

  try {
    const gapAgent = createAgent({
      model,
      systemPrompt:
        "You are a research gap analyzer. Review the findings and identify up to 3 specific information gaps that would significantly improve the report if filled. If coverage is sufficient, return an empty gaps array.",
      responseFormat: GAP_SCHEMA,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gapResult = await invokeStructuredWithReasoning(
      gapAgent,
      {
        messages: [
          {
            role: "user",
            content: `Research topic and history:\n${lcMessages.map((m) => `${m.role}: ${m.content}`).join("\n")}\n\nFindings so far:\n${allFindings}`,
          },
        ] as any,
      },
      emit,
      "stage-gap",
      "Gap analyzer",
      signal,
    );
    const gaps = (gapResult?.structuredResponse as { gaps?: Array<{ question: string; query: string }> })?.gaps ?? [];

    if (gaps.length > 0) {
      const gapFindings = await pool(gaps, MAX_CONCURRENT, async (gap, i) => {
        const actId = `gap-${i}`;
        const shortQ = gap.question.slice(0, 50);
        emit({
          type: "activity",
          activity: {
            id: actId,
            kind: "subagent",
            name: `Gap: ${shortQ}`,
            status: "running",
            label: `Filling gap: ${gap.question.slice(0, 60)}`,
          },
        });
        try {
          const researcher = createAgent({
            model,
            tools: buildResearcherTools(emit, actId, `G${i + 1}`, signal, opts.webFetchEnabled),
            systemPrompt: researcherSystemPrompt,
            middleware: [toolCallLimitMiddleware({ runLimit: RESEARCHER_TOOL_LIMIT, exitBehavior: "continue" })],
          });
          const content = await streamAgentWithReasoning(
            researcher,
            {
              messages: [
                {
                  role: "user",
                  content: `Research this: ${gap.question}\nSearch query suggestion: ${gap.query}\n\nProvide findings with citations and sources.`,
                },
              ],
            },
            emit,
            actId,
            `Gap ${i + 1}`,
            signal,
          );
          emit({ type: "activity", activity: { id: actId, kind: "subagent", name: `Gap: ${shortQ}`, status: "done", output: content } });
          return { subquestion: gap.question, content };
        } catch {
          emit({ type: "activity", activity: { id: actId, kind: "subagent", name: `Gap: ${shortQ}`, status: "error", output: "Gap research failed." } });
          return { subquestion: gap.question, content: "Gap research failed." };
        }
      });
      allFindings += "\n\n---\n\n" + gapFindings.map((f) => `## Gap: ${f.subquestion}\n\n${truncateFinding(f.content)}`).join("\n\n---\n\n");
    }
  } catch {
    // Gap check is best-effort; skip on failure.
  }

  // ─── Stage 4: Synthesize ────────────────────────────────────────────────
  emit({
    type: "activity",
    activity: {
      id: "stage-synthesize",
      kind: "tool",
      name: "Synthesizing",
      status: "running",
      label: "Writing report",
    },
  });

  let reportContent = "";

  // The synthesis call is the largest request in the pipeline and can stall if
  // the provider buffers or drops it. Watch for an idle stream and abort so the
  // run always terminates (the findings above are already persisted).
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

  try {
    const synthesisAgent = createAgent({
      model,
      systemPrompt: SYNTHESIS_INSTRUCTIONS,
    });

    const stream = await synthesisAgent.streamEvents(
      {
        messages: [
          {
            role: "user",
            content: `Write a comprehensive research report based on the following findings from multiple research sub-agents.\n\n${allFindings}\n\nWrite the report as your reply.`,
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
            reportContent += token;
          }
        })(),
        (async () => {
          for await (const token of msg.reasoning) {
            resetIdle();
            emit({ type: "reasoning", text: token, id: "stage-synthesize", label: "Synthesis" });
          }
        })(),
      ]);
    }

    try {
      await stream.output;
    } catch {
      // stream may end via abort
    }
  } catch {
    if (!signal.aborted) {
      if (idleTimedOut && reportContent.length === 0) {
        emit({ type: "token", text: "*Research synthesis timed out — the sub-agent findings above were preserved.*" });
      }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    signal.removeEventListener("abort", onParentAbort);
  }

  // Emit the artifact programmatically after streaming completes.
  if (reportContent.length > 0) {
    emit({
      type: "artifact",
      artifact: {
        id: `research-${Date.now()}`,
        title: "Research Report",
        language: "markdown",
        content: reportContent,
        index: 0,
      },
    });

    // Produce a brief LLM-generated summary for the chat (the full report lives
    // only in the artifact, not duplicated inline).
    try {
      const summaryAgent = createAgent({
        model,
        systemPrompt: "You are a research assistant. You just produced a comprehensive research report that is now open in the user's side panel as an editable artifact. Write 1-2 sentences telling the user what you produced and mentioning they can view, edit, and download it from the side panel. Be conversational and concise — do NOT repeat the report content.",
      });
      const summaryStream = await summaryAgent.streamEvents(
        {
          messages: [
            {
              role: "user",
              content: `The report covers the following findings (first 500 chars): ${reportContent.slice(0, 500)}\n\nWrite a brief summary for the user.`,
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
      emit({ type: "token", text: "I've generated a research report — it's open in the side panel where you can view, edit, and download it." });
    }
  }

  emit({
    type: "activity",
    activity: {
      id: "stage-synthesize",
      kind: "tool",
      name: "Synthesizing",
      status: "done",
    },
  });

  return { completed: !signal.aborted };
}
