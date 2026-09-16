import { useEffect, useState, useCallback } from "react";
import type { ChatSession, ReasoningEffort, SessionChatMode } from "@/types";
import { readBigKey, writeBigKey } from "@/lib/idb-store";
import { deleteSessionMessageStore } from "./use-messages";

const STORAGE_KEY = "chatui:sessions";
const SESSIONS_EVENT = "chatui:sessions-changed";

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: string;
  projectId?: string;
  type: "chat" | "agent";
  isTemporary?: boolean;
  chatMode?: SessionChatMode;
  reasoningEffort?: ReasoningEffort;
  agentId?: string;
  isSetup?: boolean;
  movedToAgent?: boolean;
}

/**
 * Standalone tasks used to live on the Agents tab as agent sessions with no
 * agent assigned; they are chat-tab sessions with chatMode "task" now. The
 * rewrite is data-driven (no flag) so it also heals downgrade/re-upgrade and
 * pre-move cloud rows: every load maps the old shape to the new one, and the
 * next persist writes it back. Idempotent — migrated records pass through.
 */
export function migrateSessionRecord(s: StoredSession): StoredSession {
  if (s.type === "agent" && !s.agentId && !s.isSetup) {
    return { ...s, type: "chat", chatMode: "task", movedToAgent: undefined };
  }
  return s;
}

function loadSessions(): ChatSession[] {
  try {
    const raw = readBigKey(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as StoredSession[];
    return data.map((s) => migrateSessionRecord(s)).map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: new Date(s.updatedAt),
      projectId: s.projectId,
      type: s.type,
      isTemporary: s.isTemporary,
      chatMode: s.chatMode,
      reasoningEffort: s.reasoningEffort,
      agentId: s.agentId,
      isSetup: s.isSetup,
      movedToAgent: s.movedToAgent,
    }));
  } catch {
    return [];
  }
}

/**
 * Persist the session list without ever throwing: this runs inside React
 * state updaters (and therefore during render), so a QuotaExceededError from
 * a full store would escape to the crash boundary and take down the app on
 * every send. The list stays in memory for this run when it cannot persist.
 */
function saveSessions(sessions: ChatSession[]) {
  try {
    writeBigKey(
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
          reasoningEffort: s.reasoningEffort,
          agentId: s.agentId,
          isSetup: s.isSetup,
          movedToAgent: s.movedToAgent,
        })),
      ),
    );
  } catch {
    console.warn("[chatui] storage full — session list will not persist after reload");
  }
  window.dispatchEvent(new Event(SESSIONS_EVENT));
}

export function subscribeToSessionChanges(fn: () => void): () => void {
  window.addEventListener(SESSIONS_EVENT, fn);
  return () => window.removeEventListener(SESSIONS_EVENT, fn);
}

/**
 * Create a session straight from storage — used by headless runs
 * (scheduler/workflows) which have no React tree. Fires the change event so
 * open sidebars pick the session up. Runs with no agent assigned land on the
 * Chat tab as task-mode chats; only agent-assigned runs get agent sessions.
 */
export function createAgentSessionHeadless(
  title: string,
  agentId?: string,
): ChatSession {
  const session: ChatSession = {
    id: crypto.randomUUID(),
    title,
    updatedAt: new Date(),
    type: agentId ? "agent" : "chat",
    isTemporary: false,
    chatMode: agentId ? undefined : "task",
    agentId,
  };
  saveSessions([session, ...loadSessions()]);
  return session;
}

export function useSessions(type: "chat" | "agent") {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  // The unfiltered list — the Agents tab needs it for cross-tab pickers
  // (e.g. the agent console's external-chats access grant).
  const [allSessions, setAllSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      const all = loadSessions();
      setAllSessions(all);
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
    };
    load();
    // Headless runs (scheduler/workflows) create sessions outside any hook —
    // the change event keeps the sidebar in sync with storage.
    return subscribeToSessionChanges(load);
  }, [type]);

  const persistSessions = useCallback(
    (updater: (prev: ChatSession[]) => ChatSession[]) => {
      setSessions((prev) => {
        const next = updater(prev);
        // Sessions that vanished from this hook's state were deleted — they
        // must also be dropped from storage. Filtering only by the surviving
        // ids would merge the deleted session straight back in (storage still
        // has it, and it is no longer in `next` to exclude it).
        const prevIds = new Set(prev.map((s) => s.id));
        const deletedIds = new Set(
          [...prevIds].filter((id) => !next.some((s) => s.id === id)),
        );
        const nextIds = new Set(next.map((s) => s.id));
        const all = loadSessions().filter((s) => !deletedIds.has(s.id));
        // `next` wins over its own stored copies (updates); other-tab
        // sessions survive the merge untouched.
        saveSessions([...all.filter((s) => !nextIds.has(s.id)), ...next]);
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
      // Drop the message store too — older versions left it behind and the
      // orphans accumulated forever.
      deleteSessionMessageStore(id);
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
        reasoning_effort?: ReasoningEffort;
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
                reasoningEffort:
                  updates.reasoning_effort !== undefined
                    ? updates.reasoning_effort
                    : s.reasoningEffort,
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
   * Move an agent session to the Chat tab as a task-mode chat (type "chat" +
   * chatMode "task", assignment cleared). The messages store is keyed by
   * session id, so the conversation carries over untouched. Called from the
   * agent tab ("Remove from agent"); the chat tab picks the session up from
   * storage when it becomes active.
   */
  const moveToChatTab = useCallback(
    async (id: string) => {
      persistSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                type: "chat",
                agentId: undefined,
                movedToAgent: undefined,
                chatMode: "task",
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
    setAllSessions(all);
    const visible =
      type === "chat"
        ? all.filter((s) => s.type === "chat" || s.movedToAgent)
        : all.filter((s) => s.type === type);
    setSessions(visible.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    ));
  }, [type]);

  return { sessions, allSessions, loading, createSession, deleteSession, updateSession, moveToChatTab, refetch };
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
