import { useEffect, useState, useCallback } from "react";
import type { ChatSession } from "@/types";

const STORAGE_KEY = "chatui:sessions";

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as Array<{
      id: string;
      title: string;
      updatedAt: string;
      projectId?: string;
      type: "chat" | "agent";
      isTemporary?: boolean;
    }>;
    return data.map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: new Date(s.updatedAt),
      projectId: s.projectId,
      type: s.type,
      isTemporary: s.isTemporary,
    }));
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      sessions.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt.toISOString(),
        projectId: s.projectId,
        type: s.type,
        isTemporary: s.isTemporary,
      })),
    ),
  );
}

export function useSessions(type: "chat" | "agent") {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const all = loadSessions();
    setSessions(all.filter((s) => s.type === type).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    ));
    setLoading(false);
  }, [type]);

  const persistSessions = useCallback(
    (updater: (prev: ChatSession[]) => ChatSession[]) => {
      setSessions((prev) => {
        const next = updater(prev);
        const all = loadSessions();
        const otherType = all.filter((s) => s.type !== type);
        const combined = [...otherType, ...next];
        saveSessions(combined);
        return next;
      });
    },
    [type],
  );

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
      persistSessions((prev) => [session, ...prev]);
      return { ...session, persisted: Promise.resolve() };
    },
    [persistSessions],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      persistSessions((prev) => prev.filter((s) => s.id !== id));
    },
    [persistSessions],
  );

  const updateSession = useCallback(
    async (id: string, updates: { title?: string; project_id?: string | null }) => {
      persistSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                title: updates.title ?? s.title,
                projectId:
                  updates.project_id !== undefined
                    ? updates.project_id ?? undefined
                    : s.projectId,
                updatedAt: new Date(),
              }
            : s,
        ),
      );
    },
    [persistSessions],
  );

  const refetch = useCallback(() => {
    const all = loadSessions();
    setSessions(all.filter((s) => s.type === type).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    ));
  }, [type]);

  return { sessions, loading, createSession, deleteSession, updateSession, refetch };
}
