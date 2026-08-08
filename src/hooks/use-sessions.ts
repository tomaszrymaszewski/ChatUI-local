import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { ChatSession } from "@/types";

export function useSessions(type: "chat" | "agent") {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  // Unique per hook instance: supabase.channel() dedupes channels by name,
  // and calling .on() on an already-subscribed channel throws when two
  // instances share the same type (e.g. both using "agent" after a tab switch).
  const channelSuffix = useMemo(() => Math.random().toString(36).slice(2, 8), []);

  useEffect(() => {
    const channel = supabase
      .channel(`sessions_${type}_${channelSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_sessions",
          filter: `type=eq.${type}`,
        },
        () => fetchSessions()
      )
      .subscribe();

    fetchSessions();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [type, channelSuffix]);

  const fetchSessions = useCallback(async () => {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id, title, project_id, type, is_temporary, updated_at")
      .eq("type", type)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error fetching sessions:", error);
      setLoading(false);
      return;
    }

    const dbSessions = (data ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: new Date(s.updated_at),
      projectId: s.project_id ?? undefined,
      type: s.type as "chat" | "agent",
      isTemporary: s.is_temporary,
    }));

    setSessions((prev) => {
      const dbIds = new Set(dbSessions.map((s) => s.id));
      const localOnly = prev.filter((s) => !dbIds.has(s.id));
      return [...dbSessions, ...localOnly].sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
      );
    });
    setLoading(false);
  }, [type]);

  const createSession = useCallback(
    (title = "New Chat", projectId?: string) => {
      const id = crypto.randomUUID();
      const session: ChatSession = {
        id,
        title,
        updatedAt: new Date(),
        projectId,
        type,
        isTemporary: false,
      };
      setSessions((prev) => [session, ...prev]);

      const persisted: Promise<void> = Promise.resolve(
        supabase
          .from("chat_sessions")
          .insert({
            id,
            title,
            type,
            project_id: projectId ?? null,
          })
          .then(({ error }) => {
            if (error) {
              setSessions((prev) => prev.filter((s) => s.id !== id));
              throw error;
            }
          })
      );

      return { ...session, persisted };
    },
    [type]
  );

  const deleteSession = useCallback(async (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    const { error } = await supabase
      .from("chat_sessions")
      .delete()
      .eq("id", id);
    if (error) {
      fetchSessions();
      throw error;
    }
  }, [fetchSessions]);

  const updateSession = useCallback(
    async (id: string, updates: { title?: string; project_id?: string | null }) => {
      const { error } = await supabase
        .from("chat_sessions")
        .update(updates)
        .eq("id", id);
      if (error) throw error;

      setSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                title: updates.title ?? s.title,
                projectId: updates.project_id ?? s.projectId,
              }
            : s,
        ),
      );
    },
    []
  );

  return { sessions, loading, createSession, deleteSession, updateSession, refetch: fetchSessions };
}
