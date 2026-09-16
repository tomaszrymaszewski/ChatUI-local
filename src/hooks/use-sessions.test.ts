import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentSessionHeadless,
  getSessionChatMode,
  migrateSessionRecord,
} from "@/hooks/use-sessions";
import type { StoredSession } from "@/hooks/use-sessions";

// The vitest environment is node — stub localStorage like the browser would.
const storage = new Map<string, string>();

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clear();
});

function seedSessions(sessions: Array<Record<string, unknown>>) {
  storage.set("chatui:sessions", JSON.stringify(sessions));
}

describe("getSessionChatMode", () => {
  it("reads a session's stored chat mode across tabs", () => {
    seedSessions([
      {
        id: "s1",
        title: "Italian lessons",
        updatedAt: new Date().toISOString(),
        type: "chat",
        chatMode: "learn",
      },
    ]);
    expect(getSessionChatMode("s1")).toBe("learn");
  });

  it("returns undefined for sessions without a stored mode", () => {
    seedSessions([
      { id: "s2", title: "Agent chat", updatedAt: new Date().toISOString(), type: "agent", agentId: "a1" },
    ]);
    expect(getSessionChatMode("s2")).toBeUndefined();
  });

  it("reads a pre-move standalone task back as task mode", () => {
    seedSessions([
      { id: "s3", title: "Old task", updatedAt: new Date().toISOString(), type: "agent" },
    ]);
    expect(getSessionChatMode("s3")).toBe("task");
  });

  it("returns undefined for null or unknown ids", () => {
    seedSessions([]);
    expect(getSessionChatMode(null)).toBeUndefined();
    expect(getSessionChatMode("missing")).toBeUndefined();
  });

  it("survives corrupted storage", () => {
    storage.set("chatui:sessions", "{not json");
    expect(getSessionChatMode("s1")).toBeUndefined();
  });
});

describe("saveSessions quota guard", () => {
  it("never throws when the store is full", () => {
    // A QuotaExceededError during a send used to escape through the React
    // state updater into the crash boundary ("Something went wrong").
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: () => {
        throw new Error("The quota has been exceeded.");
      },
      removeItem: (k: string) => void storage.delete(k),
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    expect(() => createAgentSessionHeadless("Full store chat")).not.toThrow();
    expect(storage.has("chatui:sessions")).toBe(false);
  });
});

describe("migrateSessionRecord", () => {
  const base: StoredSession = {
    id: "s",
    title: "T",
    updatedAt: new Date().toISOString(),
    type: "agent",
  };

  it("moves unassigned agent sessions to the chat tab as task mode", () => {
    expect(migrateSessionRecord({ ...base })).toMatchObject({
      type: "chat",
      chatMode: "task",
    });
  });

  it("clears the moved-to-agent flag on the way home", () => {
    expect(
      migrateSessionRecord({ ...base, movedToAgent: true }),
    ).toMatchObject({ type: "chat", chatMode: "task", movedToAgent: undefined });
  });

  it("leaves assigned agent sessions alone", () => {
    const s: StoredSession = { ...base, agentId: "a1" };
    expect(migrateSessionRecord(s)).toBe(s);
  });

  it("leaves builder setup chats on the agents tab", () => {
    const s: StoredSession = { ...base, isSetup: true };
    expect(migrateSessionRecord(s)).toBe(s);
  });

  it("leaves chats alone", () => {
    const s: StoredSession = { ...base, type: "chat" };
    expect(migrateSessionRecord(s)).toBe(s);
  });
});

describe("createAgentSessionHeadless", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });

  it("creates unassigned runs as task-mode chats", () => {
    seedSessions([]);
    const s = createAgentSessionHeadless("Nightly backup");
    expect(s.type).toBe("chat");
    expect(s.chatMode).toBe("task");
    const stored = JSON.parse(storage.get("chatui:sessions") ?? "[]");
    expect(stored[0]).toMatchObject({ id: s.id, type: "chat", chatMode: "task" });
  });

  it("creates assigned runs as agent sessions", () => {
    seedSessions([]);
    const s = createAgentSessionHeadless("Agent job", "agent-1");
    expect(s.type).toBe("agent");
    expect(s.chatMode).toBeUndefined();
    expect(s.agentId).toBe("agent-1");
  });
});
