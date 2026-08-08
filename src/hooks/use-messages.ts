import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Message } from "@/types";

interface RawMessage {
  id: string;
  role: string;
  content: string;
  model: string | null;
  attachments: any[];
  created_at: string;
  session_id: string;
  parent_id: string | null;
  is_temporary: boolean;
  reasoning: string | null;
}

function mapRawMessage(m: RawMessage): Message {
  return {
    id: m.id,
    role: m.role as Message["role"],
    content: m.content,
    timestamp: new Date(m.created_at),
    model: m.model ?? undefined,
    attachments: m.attachments ?? [],
    session_id: m.session_id,
    parent_id: m.parent_id ?? null,
    is_temporary: m.is_temporary ?? false,
    reasoning: m.reasoning ?? undefined,
  };
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

    setMessages([]);
    setLoading(true);

    const channel = supabase
      .channel(`messages_${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const newMsg = payload.new as RawMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, mapRawMessage(newMsg)];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const oldMsg = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== oldMsg.id));
        }
      )
      .subscribe();

    fetchMessages();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const fetchMessages = useCallback(async () => {
    if (!sessionId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("messages")
      .select("id, role, content, model, attachments, created_at, session_id, parent_id, is_temporary, reasoning")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching messages:", error);
      setLoading(false);
      return;
    }

    setMessages((data ?? []).map(mapRawMessage));
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
      setMessages((prev) => [...prev, msg]);

      const { error } = await supabase.from("messages").insert({
        id,
        session_id: sessionId,
        role,
        content,
        model: model ?? null,
        attachments: attachments ?? [],
        parent_id: parentId ?? null,
        is_temporary: isTemporary ?? false,
        reasoning: reasoning || null,
      });

      if (error) {
        setMessages((prev) => prev.filter((m) => m.id !== id));
        throw error;
      }

      return msg;
    },
    [],
  );

  const deleteTemporaryMessages = useCallback(async (sessionId: string) => {
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("session_id", sessionId)
      .eq("is_temporary", true);

    if (error) {
      console.error("Error deleting temporary messages:", error);
    }

    setMessages((prev) => prev.filter((m) => !m.is_temporary));
  }, []);

  return {
    messages,
    loading,
    addMessage,
    deleteTemporaryMessages,
    refetch: fetchMessages,
  };
}
