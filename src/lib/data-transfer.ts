import type { Message } from "@/types";

// Data export/import: full ChatUI backups (a snapshot of every chatui* localStorage
// key — chats, agents, projects, providers, settings, schedules, workflows,
// memories, connectors) plus portable conversation exports in the formats
// ChatGPT (OpenAI) and Claude (Anthropic) use for their official data exports,
// so conversations can always migrate away. importData() auto-detects which of
// the three formats a file is and restores/merges it.

const SESSIONS_KEY = "chatui:sessions";
const MESSAGES_KEY_PREFIX = "chatui:messages:";
const CHATUI_KEY_RE = /^chatui/; // both "chatui:" and "chatui_" key styles

const SESSIONS_EVENT = "chatui:sessions-changed";
const MESSAGES_EVENT = "chatui:messages-changed";

type StoredRecord = Record<string, unknown>;

interface PortableSession {
  session: { id: string; title: string; updatedAt: string };
  thread: Message[];
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadStoredSessions(): Array<StoredRecord & { id: string; title?: string; updatedAt?: string }> {
  const data = readJson<unknown>(SESSIONS_KEY, []);
  if (!Array.isArray(data)) return [];
  return data.filter((s): s is StoredRecord & { id: string } =>
    !!s && typeof s === "object" && typeof (s as StoredRecord).id === "string"
  );
}

/** Parse one session's stored messages (only the fields the exporters need). */
function loadSessionMessages(sessionId: string): Message[] {
  const data = readJson<unknown>(`${MESSAGES_KEY_PREFIX}${sessionId}`, []);
  if (!Array.isArray(data)) return [];
  return data
    .filter((m): m is StoredRecord => !!m && typeof m === "object")
    .map((m) => ({
      id: String(m.id ?? crypto.randomUUID()),
      role: (m.role === "user" || m.role === "assistant" || m.role === "system"
        ? m.role
        : "user") as Message["role"],
      content: typeof m.content === "string" ? m.content : "",
      timestamp: new Date(typeof m.timestamp === "string" ? m.timestamp : Date.now()),
      session_id: sessionId,
      parent_id: typeof m.parent_id === "string" ? m.parent_id : null,
      is_temporary: m.is_temporary === true,
    }));
}

/**
 * The visible branch of a message tree: walk from the last-appended message
 * back through parent links. Mirrors getActivePath's default (last child at
 * every branch), since newer branches are always appended last.
 */
function activeThread(messages: Message[]): Message[] {
  if (messages.length === 0) return [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  const chain: Message[] = [];
  const seen = new Set<string>();
  let cur: Message | undefined = messages[messages.length - 1];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain.reverse();
}

/** All sessions with a non-empty portable thread (temporary/empty messages dropped). */
function portableSessions(): PortableSession[] {
  const out: PortableSession[] = [];
  for (const session of loadStoredSessions()) {
    const thread = activeThread(
      loadSessionMessages(session.id).filter((m) => !m.is_temporary && m.content.trim() !== ""),
    );
    if (thread.length === 0) continue;
    out.push({
      session: {
        id: session.id,
        title: typeof session.title === "string" ? session.title : "Untitled chat",
        updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : thread[thread.length - 1].timestamp.toISOString(),
      },
      thread,
    });
  }
  return out;
}

function epochSeconds(d: Date): number {
  return d.getTime() / 1000;
}

// ─── Full ChatUI backup (proprietary format, everything) ─────────────────────

export function exportChatUiBackup(): string {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && CHATUI_KEY_RE.test(key)) {
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    }
  }
  return JSON.stringify({ __chatui_export__: true, version: 3, data }, null, 2);
}

function restoreChatUiBackup(parsed: { data?: unknown }): void {
  const data = parsed.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid export file format");
  }
  for (const [key, value] of Object.entries(data as Record<string, string | null>)) {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  }
}

// ─── ChatGPT (OpenAI) conversations.json format ─────────────────────────────

interface ChatGptNode {
  id: string;
  message: {
    id: string;
    author: { role: string };
    create_time: number | null;
    content: { content_type: string; parts: unknown[] } & { text?: string };
    status: string;
    end_turn: boolean;
    weight: number;
    recipient: string;
    metadata: Record<string, unknown>;
  } | null;
  parent: string | null;
  children: string[];
}

const ROOT_NODE_ID = "root";

export function exportOpenAiConversations(): string {
  const conversations = portableSessions().map(({ session, thread }) => {
    const mapping: Record<string, ChatGptNode> = {
      [ROOT_NODE_ID]: { id: ROOT_NODE_ID, message: null, parent: null, children: [] },
    };
    let prevId = ROOT_NODE_ID;
    for (const m of thread) {
      mapping[m.id] = {
        id: m.id,
        parent: prevId,
        children: [],
        message: {
          id: m.id,
          author: { role: m.role },
          create_time: epochSeconds(m.timestamp),
          content: { content_type: "text", parts: [m.content] },
          status: "finished_successfully",
          end_turn: true,
          weight: m.role === "system" ? 0 : 1,
          recipient: "all",
          metadata: {},
        },
      };
      mapping[prevId].children.push(m.id);
      prevId = m.id;
    }
    return {
      title: session.title,
      create_time: epochSeconds(thread[0].timestamp),
      update_time: epochSeconds(thread[thread.length - 1].timestamp),
      mapping,
      current_node: prevId,
      conversation_id: session.id,
    };
  });
  return JSON.stringify(conversations, null, 2);
}

/** Extract text from a ChatGPT message content block. */
function chatGptContentText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as { content_type?: string; parts?: unknown; text?: unknown };
  if (typeof c.text === "string" && !c.parts) return c.text; // "code" content type
  if (!Array.isArray(c.parts)) return "";
  return c.parts
    .filter((p): p is string => typeof p === "string")
    .join("");
}

/** The active branch of a ChatGPT mapping: current_node walked back to the root. */
function chatGptThread(
  mapping: Record<string, ChatGptNode>,
  currentNode: unknown,
  fallbackTime: number,
): Array<{ id: string; role: "user" | "assistant" | "system"; content: string; timestamp: Date }> {
  const nodeIds = Object.keys(mapping);
  let leafId: string | null =
    typeof currentNode === "string" && mapping[currentNode] ? currentNode : null;
  if (!leafId) {
    // No current_node — fall back to the freshest leaf.
    let best = -Infinity;
    for (const id of nodeIds) {
      const node = mapping[id];
      if (!node || node.children.length > 0 || !node.message) continue;
      const t = node.message.create_time ?? best;
      if (typeof t === "number" && t >= best) {
        best = t;
        leafId = id;
      }
    }
  }
  const out: Array<{ id: string; role: "user" | "assistant" | "system"; content: string; timestamp: Date }> = [];
  const seen = new Set<string>();
  let cur = leafId ? mapping[leafId] : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.message) {
      const role = cur.message.author?.role;
      const content = chatGptContentText(cur.message.content);
      const t = typeof cur.message.create_time === "number" ? cur.message.create_time : null;
      if ((role === "user" || role === "assistant" || role === "system") && content.trim() !== "") {
        out.push({
          id: cur.message.id || cur.id,
          role,
          content,
          timestamp: t !== null ? new Date(t * 1000) : new Date(fallbackTime),
        });
      }
    }
    cur = cur.parent ? mapping[cur.parent] : undefined;
  }
  return out.reverse();
}

// ─── Claude (Anthropic) conversations.json format ───────────────────────────

export function exportAnthropicConversations(): string {
  const conversations = portableSessions()
    .map(({ session, thread }) => {
      const chats = thread
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
          const at = m.timestamp.toISOString();
          return m.role === "user"
            ? {
                uuid: m.id,
                text: m.content,
                sender: "human",
                created_at: at,
                updated_at: at,
              }
            : {
                uuid: m.id,
                sender: "assistant",
                created_at: at,
                updated_at: at,
                content_feature_store: [{ content_type: "text", text: m.content }],
              };
        });
      return {
        uuid: session.id,
        name: session.title,
        created_at: chats.length > 0 ? chats[0].created_at : session.updatedAt,
        updated_at: chats.length > 0 ? chats[chats.length - 1].created_at : session.updatedAt,
        chats,
      };
    })
    .filter((c) => c.chats.length > 0);
  return JSON.stringify(conversations, null, 2);
}

function anthropicChatText(chat: StoredRecord): string {
  if (typeof chat.text === "string") return chat.text;
  const store = chat.content_feature_store;
  if (!Array.isArray(store)) return "";
  return store
    .filter(
      (c): c is { text: string } =>
        !!c && typeof c === "object" &&
        (c as StoredRecord).content_type === "text" &&
        typeof (c as StoredRecord).text === "string",
    )
    .map((c) => c.text)
    .join("");
}

function anthropicThread(
  chats: unknown,
  fallbackTime: number,
): Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: Date }> {
  if (!Array.isArray(chats)) return [];
  const out: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: Date }> = [];
  for (const chat of chats) {
    if (!chat || typeof chat !== "object") continue;
    const c = chat as StoredRecord;
    const sender = typeof c.sender === "string" ? c.sender.toLowerCase() : "";
    if (sender !== "human" && sender !== "user" && sender !== "assistant" && sender !== "model") continue;
    const role: "user" | "assistant" =
      sender === "human" || sender === "user" ? "user" : "assistant";
    const content = anthropicChatText(c);
    if (content.trim() === "") continue;
    const parsed = typeof c.created_at === "string" ? Date.parse(c.created_at) : NaN;
    out.push({
      id: typeof c.uuid === "string" ? c.uuid : crypto.randomUUID(),
      role,
      content,
      timestamp: new Date(Number.isFinite(parsed) ? parsed : fallbackTime),
    });
  }
  return out;
}

// ─── Import (auto-detects the format) ───────────────────────────────────────

export interface ImportResult {
  kind: "chatui" | "openai" | "anthropic";
  /** Conversations imported (portable formats only). */
  sessions: number;
  /** Messages imported (portable formats only). */
  messages: number;
  /** Conversations skipped because they were already imported (same id). */
  skipped: number;
}

function mergeImportedSessions(
  newSessions: Array<{ id: string; title: string; updatedAt: string; type: "chat"; isTemporary: boolean }>,
): void {
  if (newSessions.length === 0) return;
  const stored = loadStoredSessions();
  const ids = new Set(stored.map((s) => s.id));
  for (const s of newSessions) {
    if (!ids.has(s.id)) stored.push(s);
  }
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(stored));
  window.dispatchEvent(new Event(SESSIONS_EVENT));
  window.dispatchEvent(new Event(MESSAGES_EVENT));
}

/**
 * Write one imported thread as a new chat session's message store. Message
 * records match the use-messages serialization shape; duplicate/missing entry
 * ids get fresh uuids so the parent chain and React keys stay valid.
 */
function persistImportedThread(
  sessionId: string,
  thread: Array<{ id: string; role: string; content: string; timestamp: Date }>,
): string {
  const usedIds = new Set<string>();
  const finalIds = thread.map((m) => {
    let id = m.id;
    if (!id || usedIds.has(id)) id = crypto.randomUUID();
    usedIds.add(id);
    return id;
  });
  const records = thread.map((m, i) => ({
    id: finalIds[i],
    role: m.role,
    content: m.content,
    timestamp: m.timestamp.toISOString(),
    attachments: [],
    session_id: sessionId,
    parent_id: i === 0 ? null : finalIds[i - 1],
    is_temporary: false,
  }));
  localStorage.setItem(`${MESSAGES_KEY_PREFIX}${sessionId}`, JSON.stringify(records));
  return records[records.length - 1].timestamp;
}

function importChatGptConversations(conversations: unknown[]): { sessions: number; messages: number; skipped: number } {
  const sessions: Array<{ id: string; title: string; updatedAt: string; type: "chat"; isTemporary: boolean }> = [];
  const existingIds = new Set(loadStoredSessions().map((s) => s.id));
  let messages = 0;
  let skipped = 0;
  for (const conv of conversations) {
    if (!conv || typeof conv !== "object") continue;
    const c = conv as StoredRecord;
    const mapping = c.mapping;
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) continue;
    const fallbackTime =
      typeof c.update_time === "number" ? c.update_time * 1000 :
      typeof c.create_time === "number" ? c.create_time * 1000 :
      Date.now();
    const thread = chatGptThread(
      mapping as Record<string, ChatGptNode>,
      c.current_node,
      fallbackTime,
    ).filter((m) => m.role !== "system"); // ChatGPT boilerplate system nodes
    if (thread.length === 0) continue;
    // Reuse the source conversation id so re-importing the same file is a no-op.
    const sessionId =
      typeof c.conversation_id === "string" && c.conversation_id ? c.conversation_id : crypto.randomUUID();
    if (existingIds.has(sessionId)) {
      skipped++;
      continue;
    }
    existingIds.add(sessionId);
    const updatedAt = persistImportedThread(sessionId, thread);
    const title = typeof c.title === "string" && c.title.trim() !== "" ? c.title : "Imported chat";
    sessions.push({ id: sessionId, title, updatedAt, type: "chat", isTemporary: false });
    messages += thread.length;
  }
  mergeImportedSessions(sessions);
  return { sessions: sessions.length, messages, skipped };
}

function importAnthropicConversations(conversations: unknown[]): { sessions: number; messages: number; skipped: number } {
  const sessions: Array<{ id: string; title: string; updatedAt: string; type: "chat"; isTemporary: boolean }> = [];
  const existingIds = new Set(loadStoredSessions().map((s) => s.id));
  let messages = 0;
  let skipped = 0;
  for (const conv of conversations) {
    if (!conv || typeof conv !== "object") continue;
    const c = conv as StoredRecord;
    const fallbackTime =
      typeof c.updated_at === "string" && Number.isFinite(Date.parse(c.updated_at))
        ? Date.parse(c.updated_at)
        : Date.now();
    const thread = anthropicThread(c.chats, fallbackTime);
    if (thread.length === 0) continue;
    // Reuse the source conversation uuid so re-importing the same file is a no-op.
    const sessionId = typeof c.uuid === "string" && c.uuid ? c.uuid : crypto.randomUUID();
    if (existingIds.has(sessionId)) {
      skipped++;
      continue;
    }
    existingIds.add(sessionId);
    const updatedAt = persistImportedThread(sessionId, thread);
    const name = typeof c.name === "string" && c.name.trim() !== "" ? c.name : "Imported chat";
    sessions.push({ id: sessionId, title: name, updatedAt, type: "chat", isTemporary: false });
    messages += thread.length;
  }
  mergeImportedSessions(sessions);
  return { sessions: sessions.length, messages, skipped };
}

function looksLikeChatGptExport(items: unknown[]): boolean {
  const first = items.find((c) => c && typeof c === "object");
  if (!first) return false;
  const c = first as StoredRecord;
  return !!c.mapping && typeof c.mapping === "object" && !Array.isArray(c.mapping);
}

function looksLikeAnthropicExport(items: unknown[]): boolean {
  const first = items.find((c) => c && typeof c === "object");
  if (!first) return false;
  const c = first as StoredRecord;
  if (!Array.isArray(c.chats)) return false;
  const chat = c.chats.find((ch) => ch && typeof ch === "object") as StoredRecord | undefined;
  return !!chat && typeof chat.sender === "string";
}

/**
 * Import an export file, auto-detecting the format: a ChatUI backup
 * (restores everything and needs an app reload) or a conversations.json from
 * ChatGPT/Claude (merged in as new chat sessions).
 */
export function importData(jsonString: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error("The file is not valid JSON.");
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as StoredRecord;
    if (obj.__chatui_export__ === true) {
      restoreChatUiBackup(obj as { data?: unknown });
      return { kind: "chatui", sessions: 0, messages: 0, skipped: 0 };
    }
    // Some tools wrap a conversations array in an object.
    if (Array.isArray(obj.conversations)) parsed = obj.conversations;
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error("The import file contains no conversations.");
    }
    if (looksLikeChatGptExport(parsed)) {
      const { sessions, messages, skipped } = importChatGptConversations(parsed);
      if (sessions === 0 && skipped === 0) {
        throw new Error("No conversations with messages were found in the file.");
      }
      return { kind: "openai", sessions, messages, skipped };
    }
    if (looksLikeAnthropicExport(parsed)) {
      const { sessions, messages, skipped } = importAnthropicConversations(parsed);
      if (sessions === 0 && skipped === 0) {
        throw new Error("No conversations with messages were found in the file.");
      }
      return { kind: "anthropic", sessions, messages, skipped };
    }
  }

  throw new Error(
    "Unrecognized import format. Expected a ChatUI backup or a ChatGPT/Claude conversations.json export.",
  );
}
