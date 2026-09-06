import type { Message, Provider } from "@/types";
import type { ContentPart } from "@/lib/llm";
import { getModelContextWindow } from "@/lib/model-capabilities";
import type { AgentMessage, AgentMessageRunMeta } from "./runtime";

const CHARS_PER_TOKEN = 4;
/** Reserved for system prompt + tool schemas + the model's reply. */
const OVERHEAD_RESERVE_TOKENS = 4096;
/** Local runtimes (Ollama/LM Studio) load small contexts by default. */
const LOCAL_FALLBACK_CONTEXT = 8192;
const DEFAULT_FALLBACK_CONTEXT = 32768;

function isLocalBaseUrl(baseUrl: string): boolean {
  const u = baseUrl.toLowerCase();
  return (
    u.includes("localhost") ||
    u.includes("127.0.0.1") ||
    u.includes("0.0.0.0") ||
    u.includes("[::1]")
  );
}

/**
 * How many estimated tokens of replayed conversation history to allow.
 * Uses the models.dev context limit when known, a conservative budget for
 * local runtimes, and a moderate default otherwise.
 */
export async function resolveHistoryBudget(
  provider: Provider,
  modelName: string,
): Promise<number> {
  const known = await getModelContextWindow(provider, modelName).catch(() => null);
  const contextWindow =
    known ?? (isLocalBaseUrl(provider.baseUrl) ? LOCAL_FALLBACK_CONTEXT : DEFAULT_FALLBACK_CONTEXT);
  return Math.max(1024, contextWindow - OVERHEAD_RESERVE_TOKENS);
}

export function estimateMessageTokens(
  message: { content: string | ContentPart[] },
): number {
  if (typeof message.content === "string") {
    return Math.ceil(message.content.length / CHARS_PER_TOKEN) + 4;
  }
  let total = 4;
  for (const part of message.content) {
    if (part.type === "image_url") {
      total += 1100;
    } else {
      total += Math.ceil((part.text?.length ?? 0) / CHARS_PER_TOKEN);
    }
  }
  return total;
}

// ── Run-metadata replay ──────────────────────────────────────────────────
// Assistant messages from agent runs carry metadata the user saw in the UI
// (thought process, research sub-agent outputs, artifacts) that is not part
// of the message text. Replaying only the text leaves follow-up prompts
// ("continue the report") without the material to continue from, so a capped
// digest of the metadata is folded into the replayed assistant content.

const DIGEST_REASONING_LIMIT = 2000;
const DIGEST_FINDINGS_LIMIT = 6000;
const DIGEST_ARTIFACT_LIMIT = 4000;

const DIGEST_PREAMBLE =
  "[Context from this turn that was not shown inline in the reply: thought process, " +
  "sub-agent findings, and artifact contents. Use it to answer follow-ups and to " +
  "continue unfinished work — e.g. when asked to continue a report that was cut off.]";

function clipHead(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[…truncated…]`;
}

/** Keep the beginning and the very end — the tail is where a cut-off report stopped. */
function clipHeadAndTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const tail = Math.min(600, Math.floor(limit / 3));
  const head = Math.max(0, limit - tail - 20);
  return `${text.slice(0, head)}\n[…truncated…]\n${text.slice(text.length - tail)}`;
}

/**
 * Compact, capped digest of an assistant run's metadata for history replay.
 * Returns "" when there is nothing worth replaying.
 */
export function buildRunDigest(meta: AgentMessageRunMeta): string {
  const parts: string[] = [];

  const streams = (meta.reasoningStreams ?? []).filter((s) => s.text && s.text.trim());
  const reasoning =
    streams.length > 0
      ? streams.map((s) => `[${s.label}]\n${s.text.trim()}`).join("\n\n")
      : (meta.reasoning ?? "").trim();
  if (reasoning) {
    parts.push(`Thought process:\n${clipHead(reasoning, DIGEST_REASONING_LIMIT)}`);
  }

  const findings = (meta.activities ?? []).filter(
    (a) => a.kind === "subagent" && a.status !== "error" && a.output && a.output.trim(),
  );
  if (findings.length > 0) {
    const per = Math.max(400, Math.floor(DIGEST_FINDINGS_LIMIT / findings.length));
    parts.push(
      `Sub-agent findings:\n${findings
        .map((f) => `## ${f.name}\n${clipHeadAndTail((f.output ?? "").trim(), per)}`)
        .join("\n\n")}`,
    );
  }

  const artifacts = meta.artifacts ?? [];
  if (artifacts.length > 0) {
    const per = Math.max(400, Math.floor(DIGEST_ARTIFACT_LIMIT / artifacts.length));
    parts.push(
      `Artifacts produced:\n${artifacts
        .map((a) => `## ${a.title} (${a.language})\n${clipHeadAndTail(a.content, per)}`)
        .join("\n\n")}`,
    );
  }

  if (parts.length === 0) return "";
  return `${DIGEST_PREAMBLE}\n\n${parts.join("\n\n")}`;
}

function expandAssistantMessage(m: AgentMessage): AgentMessage {
  if (m.role !== "assistant" || !m.meta || typeof m.content !== "string") return m;
  const digest = buildRunDigest(m.meta);
  if (!digest) return m;
  return { ...m, content: m.content ? `${m.content}\n\n${digest}` : digest };
}

/**
 * Convert a stored message into a history-replay message, carrying assistant
 * run metadata (thought process, sub-agent outputs, artifacts) so the next
 * run's model can see it. `content` overrides the stored text (e.g. rebuilt
 * attachment context).
 */
export function toHistoryMessage(m: Message, content?: string | ContentPart[]): AgentMessage {
  const base: AgentMessage = { role: m.role, content: content ?? m.content };
  if (
    m.role === "assistant" &&
    (m.reasoning || m.reasoningStreams?.length || m.activities?.length || m.artifacts?.length)
  ) {
    base.meta = {
      reasoning: m.reasoning,
      reasoningStreams: m.reasoningStreams,
      activities: m.activities,
      artifacts: m.artifacts,
    };
  }
  return base;
}

/**
 * Drop the oldest messages so the estimated total fits the budget. Assistant
 * messages carrying run metadata are expanded with the findings/reasoning
 * digest first; when the expanded form does not fit a tight budget, the plain
 * message is kept instead before dropping history. The most recent message is
 * always kept, even if it alone exceeds the budget (the provider's error will
 * surface to the user instead of silent confusion).
 */
export function truncateMessagesToBudget(
  messages: AgentMessage[],
  budgetTokens: number,
): AgentMessage[] {
  const expanded = messages.map(expandAssistantMessage);
  const kept: AgentMessage[] = [];
  let used = 0;
  for (let i = expanded.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(expanded[i]);
    if (kept.length > 0 && used + tokens > budgetTokens) {
      const plain = messages[i];
      if (plain !== expanded[i]) {
        const plainTokens = estimateMessageTokens(plain);
        if (used + plainTokens <= budgetTokens) {
          kept.unshift(plain);
          used += plainTokens;
          continue;
        }
      }
      break;
    }
    kept.unshift(expanded[i]);
    used += tokens;
  }
  return kept;
}
