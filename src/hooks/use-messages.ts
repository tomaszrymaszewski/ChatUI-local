import { useEffect, useState, useCallback } from "react";
import type { Message } from "@/types";
import type { ActivityItem, ReasoningStream } from "@/lib/agent/types";
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
      attachments: m.attachments,
      session_id: m.session_id,
      parent_id: m.parent_id,
      is_temporary: m.is_temporary,
      reasoning: m.reasoning,
      reasoningStreams: m.reasoningStreams,
      activities: m.activities,
      artifacts: m.artifacts,
    })),
  );
}

function saveMessages(sessionId: string, messages: Message[]) {
  localStorage.setItem(storageKey(sessionId), serializeMessages(messages));
}

/**
 * Headless (non-React) message persistence for scheduler/workflow runs, which
 * have no hook instance. Fires the change event so an open session view can
 * reload.
 */
export function appendMessageHeadless(sessionId: string, msg: Message) {
  const next = [...loadMessages(sessionId), msg];
  localStorage.setItem(storageKey(sessionId), serializeMessages(next));
  window.dispatchEvent(new Event(MESSAGES_EVENT));
  return msg;
}

export function updateMessageHeadless(
  sessionId: string,
  messageId: string,
  updates: Partial<Pick<Message, "content" | "reasoning" | "activities" | "reasoningStreams" | "artifacts">>,
) {
  const loaded = loadMessages(sessionId);
  if (!loaded.some((m) => m.id === messageId)) return;
  localStorage.setItem(
    storageKey(sessionId),
    serializeMessages(loaded.map((m) => (m.id === messageId ? { ...m, ...updates } : m))),
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
        Pick<Message, "content" | "reasoning" | "activities" | "reasoningStreams" | "artifacts">
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
