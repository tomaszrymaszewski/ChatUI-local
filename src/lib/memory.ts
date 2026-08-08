import type { Provider } from "@/types";
import { streamChatCompletion, type ChatCompletionMessage } from "@/lib/llm";
import { embed, embedQuery, cosineSimilarity } from "@/lib/embeddings";

export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: number;
  sourceSessionId?: string;
}

const GLOBAL_KEY = "chatui:memory:global";
const PROJECT_KEY_PREFIX = "chatui:memory:project:";
const MAX_GLOBAL = 100;
const MAX_PROJECT = 50;
const TOP_K = 12;

function keyForScope(scope: string): string {
  return scope === "global" ? GLOBAL_KEY : `${PROJECT_KEY_PREFIX}${scope}`;
}

export function loadMemory(scope: string): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(keyForScope(scope));
    if (!raw) return [];
    return JSON.parse(raw) as MemoryEntry[];
  } catch {
    return [];
  }
}

function saveMemory(scope: string, entries: MemoryEntry[]) {
  try {
    localStorage.setItem(keyForScope(scope), JSON.stringify(entries));
  } catch {
    // ignore
  }
}

export function addMemory(scope: string, text: string, sourceSessionId?: string): MemoryEntry {
  const entries = loadMemory(scope);
  const entry: MemoryEntry = { id: crypto.randomUUID(), text, createdAt: Date.now(), sourceSessionId };
  entries.unshift(entry);
  const cap = scope === "global" ? MAX_GLOBAL : MAX_PROJECT;
  saveMemory(scope, entries.slice(0, cap));
  return entry;
}

export function deleteMemory(scope: string, id: string) {
  const entries = loadMemory(scope).filter((e) => e.id !== id);
  saveMemory(scope, entries);
}

export function updateMemory(scope: string, id: string, text: string) {
  const entries = loadMemory(scope).map((e) => (e.id === id ? { ...e, text } : e));
  saveMemory(scope, entries);
}

function clearMemory(scope: string) {
  saveMemory(scope, []);
}

/** Build a system-prompt fragment from memory, ranked by relevance to the query. */
export async function buildMemoryContext(projectId: string | null, query: string): Promise<string> {
  const scopes: string[] = ["global"];
  if (projectId) scopes.push(projectId);
  const parts: string[] = [];
  for (const sc of scopes) {
    const entries = loadMemory(sc);
    if (entries.length === 0) continue;
    let selected = entries;
    if (entries.length > TOP_K && query.trim()) {
      try {
        const entryTexts = entries.map((e) => e.text);
        const entryVecs = await embed(entryTexts);
        const queryVec = await embedQuery(query);
        selected = entries
          .map((e, i) => ({ e, s: cosineSimilarity(queryVec, entryVecs[i] ?? []) }))
          .sort((a, b) => b.s - a.s)
          .slice(0, TOP_K)
          .map((x) => x.e);
      } catch {
        selected = entries.slice(0, TOP_K);
      }
    } else if (entries.length > TOP_K) {
      selected = entries.slice(0, TOP_K);
    }
    const label = sc === "global" ? "What you know about the user" : "What you know about this project";
    parts.push(`${label}:\n${selected.map((e) => `- ${e.text}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

/** Synchronous variant (no relevance ranking) for quick injection. */
export function buildMemoryContextSync(projectId: string | null): string {
  const scopes: string[] = ["global"];
  if (projectId) scopes.push(projectId);
  const parts: string[] = [];
  for (const sc of scopes) {
    const entries = loadMemory(sc).slice(0, TOP_K);
    if (entries.length === 0) continue;
    const label = sc === "global" ? "What you know about the user" : "What you know about this project";
    parts.push(`${label}:\n${entries.map((e) => `- ${e.text}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

async function chatComplete(provider: Provider, model: string, messages: ChatCompletionMessage[]): Promise<string> {
  let result = "";
  try {
    for await (const chunk of streamChatCompletion(provider, model, messages, undefined, undefined, undefined)) {
      if (chunk.content) result += chunk.content;
    }
  } catch {
    return "";
  }
  return result;
}

function parseJsonResponse(text: string): { add?: string[]; delete?: string[] } {
  // Strip code fences and extract JSON object
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const braceStart = cleaned.indexOf("{");
  const braceEnd = cleaned.lastIndexOf("}");
  if (braceStart === -1 || braceEnd === -1) return {};
  try {
    return JSON.parse(cleaned.slice(braceStart, braceEnd + 1));
  } catch {
    return {};
  }
}

/**
 * Extract durable memories from an exchange and save them.
 * Best-effort: failures are silent. Runs in the background.
 */
export async function extractAndSaveMemory(
  provider: Provider,
  model: string,
  userMessage: string,
  assistantResponse: string,
  scope: string,
  existingEntries: MemoryEntry[],
  sourceSessionId?: string,
): Promise<void> {
  const existingSummary = existingEntries.map((e) => `- ${e.text}`).join("\n");
  const systemContent =
    "You extract durable memories from conversations. " +
    "Capture only lasting facts about the user, their preferences, goals, or project context. " +
    "Ignore transient questions, one-off tasks, and small talk. " +
    "Respond with ONLY a JSON object: {\"add\": [\"memory text\", ...], \"delete\": [\"exact existing memory text to remove\", ...]}. " +
    "If nothing durable, return {\"add\": [], \"delete\": []}.";
  const userContent =
    `Existing memories:\n${existingSummary || "(none)"}\n\n` +
    `User said: ${userMessage.slice(0, 800)}\n\n` +
    `Assistant replied: ${assistantResponse.slice(0, 1200)}\n\n` +
    `Extract new or updated memories. Delete outdated ones by their exact text.`;

  const messages: ChatCompletionMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];

  const result = await chatComplete(provider, model, messages);
  if (!result) return;
  const ops = parseJsonResponse(result);

  if (ops.add && Array.isArray(ops.add)) {
    for (const text of ops.add) {
      const trimmed = String(text).trim();
      if (!trimmed || trimmed.length > 300) continue;
      // Avoid duplicates
      const existing = loadMemory(scope);
      if (existing.some((e) => e.text.toLowerCase() === trimmed.toLowerCase())) continue;
      addMemory(scope, trimmed, sourceSessionId);
    }
  }
  if (ops.delete && Array.isArray(ops.delete)) {
    for (const text of ops.delete) {
      const trimmed = String(text).trim();
      const existing = loadMemory(scope);
      const match = existing.find((e) => e.text.toLowerCase() === trimmed.toLowerCase());
      if (match) deleteMemory(scope, match.id);
    }
  }
}

export { clearMemory };
