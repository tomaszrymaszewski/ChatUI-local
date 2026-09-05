import { useEffect, useState, useCallback } from "react";
import type { ChatSession, SessionChatMode } from "@/types";

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
      chatMode?: SessionChatMode;
      agentId?: string;
      isSetup?: boolean;
      movedToAgent?: boolean;
    }>;
    return data.map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: new Date(s.updatedAt),
      projectId: s.projectId,
      type: s.type,
      isTemporary: s.isTemporary,
      chatMode: s.chatMode,
      agentId: s.agentId,
      isSetup: s.isSetup,
      movedToAgent: s.movedToAgent,
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
        chatMode: s.chatMode,
        agentId: s.agentId,
        isSetup: s.isSetup,
        movedToAgent: s.movedToAgent,
      })),
    ),
  );
}

export function useSessions(type: "chat" | "agent") {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const all = loadSessions();
    // The chat tab also lists sessions moved to the Agents tab (grayed out,
    // click → redirect notice), so they don't vanish from where they started.
    const visible =
      type === "chat"
        ? all.filter((s) => s.type === "chat" || s.movedToAgent)
        : all.filter((s) => s.type === type);
    setSessions(visible.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    ));
    setLoading(false);
  }, [type]);

  const persistSessions = useCallback(
    (updater: (prev: ChatSession[]) => ChatSession[]) => {
      setSessions((prev) => {
        const next = updater(prev);
        const all = loadSessions();
        // next can contain moved (agent-type) sessions on the chat tab —
        // de-dupe by id so they aren't written twice.
        const nextIds = new Set(next.map((s) => s.id));
        const others = all.filter((s) => !nextIds.has(s.id));
        saveSessions([...others, ...next]);
        return next;
      });
    },
    [type],
  );

  const createSession = useCallback(
    (title = "New Chat", projectId?: string, opts?: { chatMode?: SessionChatMode; agentId?: string; isSetup?: boolean }) => {
      const id = crypto.randomUUID();
      const session: ChatSession = {
        id,
        title,
        updatedAt: new Date(),
        projectId,
        type,
        isTemporary: false,
        chatMode: opts?.chatMode,
        agentId: opts?.agentId,
        isSetup: opts?.isSetup,
      };
      persistSessions((prev) => [session, ...prev]);
      return { ...session, persisted: Promise.resolve() };
    },
    [persistSessions, type],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      persistSessions((prev) => prev.filter((s) => s.id !== id));
    },
    [persistSessions],
  );

  const updateSession = useCallback(
    async (
      id: string,
      updates: {
        title?: string;
        project_id?: string | null;
        chat_mode?: SessionChatMode;
        agent_id?: string | null;
      },
    ) => {
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
                chatMode:
                  updates.chat_mode !== undefined ? updates.chat_mode : s.chatMode,
                agentId:
                  updates.agent_id !== undefined
                    ? updates.agent_id ?? undefined
                    : s.agentId,
                updatedAt: new Date(),
              }
            : s,
        ),
      );
    },
    [persistSessions],
  );

  /**
   * Move a chat session to the Agents tab (type "agent" + movedToAgent flag).
   * The messages store is keyed by session id, so the conversation carries
   * over untouched. Called from the chat tab; the agent tab picks the session
   * up from storage when it becomes active.
   */
  const moveToAgentTab = useCallback(
    async (id: string) => {
      persistSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, type: "agent", movedToAgent: true, updatedAt: new Date() }
            : s,
        ),
      );
    },
    [persistSessions],
  );

  const refetch = useCallback(() => {
    const all = loadSessions();
    const visible =
      type === "chat"
        ? all.filter((s) => s.type === "chat" || s.movedToAgent)
        : all.filter((s) => s.type === type);
    setSessions(visible.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    ));
  }, [type]);

  return { sessions, loading, createSession, deleteSession, updateSession, moveToAgentTab, refetch };
}

/**
 * Read one session's stored composer mode straight from storage — works for
 * sessions of the other tab (the hook's `sessions` array is filtered by type).
 */
export function getSessionChatMode(id: string | null): SessionChatMode | undefined {
  if (!id) return undefined;
  try {
    return loadSessions().find((s) => s.id === id)?.chatMode;
  } catch {
    return undefined;
  }
}
