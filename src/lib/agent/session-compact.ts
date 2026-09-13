// Manual context compaction — the "Compact" button in the context widget.
//
// Runs replay persisted history on a fresh thread every send, so compaction
// is bookkeeping at that replay boundary: an LLM summary of the conversation
// up to an anchor message id is stored in localStorage, and subsequent runs
// swap the summarized prefix for one synthetic user turn. The message tree
// itself is never modified, and a compaction whose anchor leaves the active
// path (branch switch, deleted message) is silently ignored.

import { getProviderApiKey } from "@/lib/llm";
import type { Provider } from "@/types";
import type { AgentMessage } from "@/lib/agent/runtime";

export interface SessionCompaction {
  summary: string;
  /** Everything up to and including this message id is replaced by the summary. */
  upToId: string;
  /** Epoch ms — informational. */
  at: number;
}

const KEY_PREFIX = "chatui:compaction:";

/** Load a session's pending compaction, null when absent/corrupt. */
export function loadSessionCompaction(sessionId: string): SessionCompaction | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + sessionId);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SessionCompaction>;
    if (typeof data.summary !== "string" || typeof data.upToId !== "string") return null;
    if (!data.summary.trim() || !data.upToId) return null;
    return { summary: data.summary, upToId: data.upToId, at: typeof data.at === "number" ? data.at : 0 };
  } catch {
    return null;
  }
}

export function saveSessionCompaction(sessionId: string, compaction: SessionCompaction) {
  try {
    localStorage.setItem(KEY_PREFIX + sessionId, JSON.stringify(compaction));
  } catch {
    // storage full/unavailable — compaction is best-effort
  }
}

/** Per-message head clip and total transcript budget (~40k tokens) for the summarizer. */
const MESSAGE_CHAR_LIMIT = 4000;
const TRANSCRIPT_CHAR_LIMIT = 160_000;

/**
 * Plain-text transcript of the session's active path for the summarizer.
 * Takes `{ role, content }` structurally so callers can pass their message
 * shape directly.
 */
export function transcriptFromMessages(
  messages: Array<{ role: string; content: string }>,
): string {
  const lines: string[] = [];
  let total = 0;
  for (const m of messages) {
    const text = m.content.trim();
    if (!text) continue;
    const clipped =
      text.length > MESSAGE_CHAR_LIMIT ? `${text.slice(0, MESSAGE_CHAR_LIMIT)}\n[…clipped…]` : text;
    const line = `${m.role === "user" ? "User" : "Assistant"}: ${clipped}`;
    if (total + line.length > TRANSCRIPT_CHAR_LIMIT) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n\n");
}

/**
 * Index in the active path of the compaction anchor (upToId) — the divider
 * renders directly after this message. -1 when there is no compaction, or
 * the anchor left the path (branch switch, deleted message): the same
 * condition under which compactHistoryMessages leaves history untouched, so
 * the marker and the replayed context can never disagree.
 */
export function compactionAnchorIndex(
  pathIds: string[],
  compaction: SessionCompaction | null,
): number {
  if (!compaction) return -1;
  return pathIds.indexOf(compaction.upToId);
}

/**
 * Swap a session's compacted history prefix for one synthetic summary turn.
 * `pathIds[i]` is the message id of `messages[i]` (the active path aligned
 * with the run's history messages). Returns the messages unchanged when
 * there is no compaction, or its anchor is no longer on the path.
 */
export function compactHistoryMessages(
  pathIds: string[],
  messages: AgentMessage[],
  compaction: SessionCompaction | null,
): AgentMessage[] {
  if (!compaction) return messages;
  const cut = pathIds.indexOf(compaction.upToId);
  if (cut < 0) return messages;
  const kept = messages.slice(cut + 1);
  return [
    {
      role: "user",
      content: `[Compacted context — the earlier conversation was summarized on ${new Date(
        compaction.at,
      ).toLocaleDateString()}; treat as background unless the user refers to it:]\n\n${compaction.summary}`,
    },
    ...kept,
  ];
}

const SUMMARY_SYSTEM_PROMPT =
  "You summarize a chat conversation so a compact context block can replace its older turns. " +
  "Produce a dense markdown summary that preserves: the user's goals and constraints, key facts, " +
  "numbers, names, file paths and code identifiers, decisions made, tasks still open, and any " +
  "unfinished threads. Use short bullet sections. Do not add commentary or greetings.";

/**
 * LLM-summarize a conversation transcript (one-off chat-completions call,
 * same pattern as generateChatTitle in llm.ts). Returns "" on provider
 * trouble — callers surface that as a failed compaction.
 */
export async function summarizeConversation(
  provider: Provider,
  modelName: string,
  transcript: string,
): Promise<string> {
  if (!transcript.trim()) return "";
  const apiKey = await getProviderApiKey(provider.id);
  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const request = (maxField: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        stream: false,
        messages: [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: `Summarize the conversation below.\n\n${transcript}` },
        ],
        [maxField]: 2048,
      }),
    });

  // Newer OpenAI/reasoning models require max_completion_tokens; fall back to
  // max_tokens for broad OpenAI-compatible compatibility (see generateChatTitle).
  let response = await request("max_completion_tokens");
  if (!response.ok && response.status === 400) {
    response = await request("max_tokens");
  }
  if (!response.ok) throw new Error(`Summarizer request failed (${response.status})`);

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}
