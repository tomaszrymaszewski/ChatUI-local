import { useEffect, useState, useCallback } from "react";
import type { Message } from "@/types";

function storageKey(sessionId: string) {
  return `chatui:messages:${sessionId}`;
}

function loadMessages(sessionId: string): Message[] {
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
    }));
  } catch {
    return [];
  }
}

function saveMessages(sessionId: string, messages: Message[]) {
  localStorage.setItem(
    storageKey(sessionId),
    JSON.stringify(
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
      })),
    ),
  );
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

  const deleteTemporaryMessages = useCallback(async (sessionId: string) => {
    setMessages((prev) => {
      const next = prev.filter((m) => !m.is_temporary);
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
    deleteTemporaryMessages,
    refetch,
  };
}
