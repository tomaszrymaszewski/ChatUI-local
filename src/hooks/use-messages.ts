import { useEffect, useState, useCallback } from "react";
import type { Message } from "@/types";
import type { ActivityItem, ReasoningStream, SharedFile } from "@/lib/agent/types";
import type { Artifact } from "@/lib/artifacts";
import { deleteFileBlob } from "@/lib/attachment-store";

function storageKey(sessionId: string) {
  return `chatui:messages:${sessionId}`;
}

const MESSAGES_EVENT = "chatui:messages-changed";

/** Read a session's stored messages (any session, not just the active one). */
export function loadMessages(sessionId: string): Message[] {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    if (!raw) return [];
    const data = JSON.parse(raw) as Array<{
      id: string;
      role: string;
      content: string;
      timestamp: string;
      model?: string;
      attachments?: any[];
      session_id?: string;
      parent_id?: string | null;
      is_temporary?: boolean;
      reasoning?: string;
      reasoningStreams?: ReasoningStream[];
      activities?: ActivityItem[];
      artifacts?: Artifact[];
      files?: SharedFile[];
    }>;
    return data.map((m) => ({
      id: m.id,
      role: m.role as Message["role"],
      content: m.content,
      timestamp: new Date(m.timestamp),
      model: m.model,
      attachments: m.attachments ?? [],
      session_id: m.session_id,
      parent_id: m.parent_id ?? null,
      is_temporary: m.is_temporary ?? false,
      reasoning: m.reasoning,
      reasoningStreams: m.reasoningStreams,
      artifacts: m.artifacts,
      files: m.files,
      // A message loaded from storage is never mid-run, so any activity that was
      // still "running" when the app quit/crashed is settled to "done" to avoid
      // permanently-pulsing chips and stuck-open sub-agent boxes.
      activities: m.activities?.map((a) =>
        a.status === "running" ? { ...a, status: "done" as const } : a,
      ),
    }));
  } catch {
    return [];
  }
}

function serializeMessages(messages: Message[]) {
  return JSON.stringify(
    messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
      model: m.model,
      // data: preview URLs (base64 screenshots) are the biggest payload here
      // by far and are rebuildable from the IndexedDB blob store on load, so
      // they are never persisted. Short blob:/http(s): URLs are kept as-is.
      attachments: (m.attachments ?? []).map((a) => ({
        ...a,
        previewUrl:
          typeof a.previewUrl === "string" && a.previewUrl.startsWith("data:")
            ? undefined
            : a.previewUrl,
      })),
      session_id: m.session_id,
      parent_id: m.parent_id,
      is_temporary: m.is_temporary,
      reasoning: m.reasoning,
      reasoningStreams: m.reasoningStreams,
      activities: m.activities,
      artifacts: m.artifacts,
      files: m.files,
    })),
  );
}

const RECENCY_KEY = "chatui:messages:recency";
const RECENCY_CAP = 500;

function readRecency(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(RECENCY_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** Best-effort write-recency index so quota eviction drops stale chats first. */
function touchRecency(sessionId: string): void {
  try {
    const recency = readRecency();
    recency[sessionId] = Date.now();
    const ids = Object.keys(recency);
    if (ids.length > RECENCY_CAP) {
      ids
        .sort((a, b) => (recency[a] ?? 0) - (recency[b] ?? 0))
        .slice(0, ids.length - RECENCY_CAP)
        .forEach((id) => delete recency[id]);
    }
    localStorage.setItem(RECENCY_KEY, JSON.stringify(recency));
  } catch {
    // non-fatal bookkeeping
  }
}

function messageStoreKeys(exceptSessionId: string): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("chatui:messages:") && key !== storageKey(exceptSessionId) && key !== RECENCY_KEY) {
        keys.push(key);
      }
    }
  } catch {
    // listing failed — nothing to evict
  }
  return keys;
}

/**
 * Persist a session's messages without ever throwing: localStorage is a
 * single ~5MB store shared by every chat, so once old chats fill it even a
 * brand-new chat's first save throws QuotaExceededError and the crash
 * boundary takes down the app. On quota pressure the least-recently-written
 * sessions are evicted (oldest first) until the write fits; when even the
 * current session alone does not fit, it stays in memory for this run.
 */
function saveMessages(sessionId: string, messages: Message[]) {
  const key = storageKey(sessionId);
  const payload = serializeMessages(messages);
  try {
    localStorage.setItem(key, payload);
    touchRecency(sessionId);
    return;
  } catch {
    // quota pressure — fall through to eviction
  }
  try {
    const recency = readRecency();
    const others = messageStoreKeys(sessionId).sort(
      (a, b) =>
        (recency[a.slice("chatui:messages:".length)] ?? 0) -
        (recency[b.slice("chatui:messages:".length)] ?? 0),
    );
    for (const other of others) {
      try {
        localStorage.removeItem(other);
      } catch {
        continue;
      }
      try {
        localStorage.setItem(key, payload);
        touchRecency(sessionId);
        console.warn(`[chatui] storage full — evicted ${other} to save the current chat`);
        return;
      } catch {
        // still full — keep evicting
      }
    }
  } catch {
    // eviction bookkeeping failed
  }
  console.warn("[chatui] storage full — current chat will not persist after reload");
}

/**
 * Headless (non-React) message persistence for scheduler/workflow runs, which
 * have no hook instance. Fires the change event so an open session view can
 * reload.
 */
export function appendMessageHeadless(sessionId: string, msg: Message) {
  const next = [...loadMessages(sessionId), msg];
  saveMessages(sessionId, next);
  window.dispatchEvent(new Event(MESSAGES_EVENT));
  return msg;
}

export function updateMessageHeadless(
  sessionId: string,
  messageId: string,
  updates: Partial<Pick<Message, "content" | "reasoning" | "activities" | "reasoningStreams" | "artifacts" | "files">>,
) {
  const loaded = loadMessages(sessionId);
  if (!loaded.some((m) => m.id === messageId)) return;
  saveMessages(
    sessionId,
    loaded.map((m) => (m.id === messageId ? { ...m, ...updates } : m)),
  );
  window.dispatchEvent(new Event(MESSAGES_EVENT));
}

export function subscribeToMessageChanges(fn: () => void): () => void {
  window.addEventListener(MESSAGES_EVENT, fn);
  return () => window.removeEventListener(MESSAGES_EVENT, fn);
}

export function useMessages(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setMessages(loadMessages(sessionId));
    setLoading(false);
    // Headless runs (scheduler/workflows) persist outside any hook — the
    // change event keeps an open session view in sync with storage.
    return subscribeToMessageChanges(() => setMessages(loadMessages(sessionId)));
  }, [sessionId]);

  const addMessage = useCallback(
    async (
      sessionId: string,
      role: Message["role"],
      content: string,
      model?: string,
      attachments?: any[],
      parentId?: string | null,
      isTemporary?: boolean,
      reasoning?: string,
      activities?: ActivityItem[],
      reasoningStreams?: ReasoningStream[],
    ) => {
      const id = crypto.randomUUID();
      const msg: Message = {
        id,
        role,
        content,
        timestamp: new Date(),
        model,
        attachments: attachments ?? [],
        session_id: sessionId,
        parent_id: parentId ?? null,
        is_temporary: isTemporary ?? false,
        reasoning: reasoning || undefined,
        reasoningStreams: reasoningStreams?.length ? reasoningStreams : undefined,
        activities: activities?.length ? activities : undefined,
      };
      setMessages((prev) => {
        const next = [...prev, msg];
        saveMessages(sessionId, next);
        return next;
      });
      return msg;
    },
    [],
  );

  /**
   * Update a message's streaming fields, keeping React state and localStorage in
   * sync. When the message is in the current state we update it there and
   * persist the full list (consistent with addMessage, so nothing is clobbered).
   * When the user has navigated to another session the message is no longer in
   * state, so we persist it directly to disk to keep the in-progress run safe.
   */
  const updateMessage = useCallback(
    (
      sessionId: string,
      messageId: string,
      updates: Partial<
        Pick<Message, "content" | "reasoning" | "activities" | "reasoningStreams" | "artifacts" | "files">
      >,
    ) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === messageId)) {
          const next = prev.map((m) =>
            m.id === messageId ? { ...m, ...updates } : m,
          );
          saveMessages(sessionId, next);
          return next;
        }
        const loaded = loadMessages(sessionId);
        if (loaded.some((m) => m.id === messageId)) {
          saveMessages(
            sessionId,
            loaded.map((m) => (m.id === messageId ? { ...m, ...updates } : m)),
          );
        }
        return prev;
      });
    },
    [],
  );

  const deleteMessage = useCallback((sessionId: string, messageId: string) => {
    const purgeAttachmentBlobs = (dropped: Message[]) => {
      for (const m of dropped) {
        for (const a of m.attachments ?? []) {
          if (a.storageId) void deleteFileBlob(a.storageId);
        }
      }
    };
    setMessages((prev) => {
      if (prev.some((m) => m.id === messageId)) {
        const next = prev.filter((m) => m.id !== messageId);
        purgeAttachmentBlobs(prev.filter((m) => m.id === messageId));
        saveMessages(sessionId, next);
        return next;
      }
      const loaded = loadMessages(sessionId);
      const next = loaded.filter((m) => m.id !== messageId);
      if (next.length !== loaded.length) {
        purgeAttachmentBlobs(loaded.filter((m) => m.id === messageId));
        saveMessages(sessionId, next);
      }
      return prev;
    });
  }, []);

  const deleteTemporaryMessages = useCallback(async (sessionId: string) => {
    setMessages((prev) => {
      const dropped = prev.filter((m) => m.is_temporary);
      const next = prev.filter((m) => !m.is_temporary);
      for (const m of dropped) {
        for (const a of m.attachments ?? []) {
          if (a.storageId) void deleteFileBlob(a.storageId);
        }
      }
      saveMessages(sessionId, next);
      return next;
    });
  }, []);

  const refetch = useCallback(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    setMessages(loadMessages(sessionId));
  }, [sessionId]);

  return {
    messages,
    loading,
    addMessage,
    updateMessage,
    deleteMessage,
    deleteTemporaryMessages,
    refetch,
  };
}
