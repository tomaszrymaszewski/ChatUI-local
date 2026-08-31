import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionChatMode } from "@/hooks/use-sessions";

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
      { id: "s2", title: "Task", updatedAt: new Date().toISOString(), type: "agent" },
    ]);
    expect(getSessionChatMode("s2")).toBeUndefined();
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
