import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportChatUiBackup,
  exportOpenAiConversations,
  exportAnthropicConversations,
  importData,
} from "./data-transfer";
import { buildMessageTree, getActivePath } from "./message-tree";
import type { Message } from "@/types";

// The vitest environment is node — stub storage and window like a browser.
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  });
  vi.stubGlobal("window", { dispatchEvent: () => true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface SeedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  parent_id?: string | null;
  is_temporary?: boolean;
}

function seedSession(sessionId: string, title: string, msgs: SeedMessage[]): void {
  const sessions = JSON.parse(storage.get("chatui:sessions") ?? "[]") as unknown[];
  sessions.push({ id: sessionId, title, updatedAt: "2026-09-10T12:00:00.000Z", type: "chat" });
  storage.set("chatui:sessions", JSON.stringify(sessions));
  storage.set(
    `chatui:messages:${sessionId}`,
    JSON.stringify(
      msgs.map((m, i) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ?? `2026-09-10T12:0${i}:00.000Z`,
        session_id: sessionId,
        parent_id: m.parent_id ?? (i === 0 ? null : msgs[i - 1].id),
        is_temporary: m.is_temporary ?? false,
      })),
    ),
  );
}

function storedSession(id: string): Record<string, unknown> | undefined {
  const sessions = JSON.parse(storage.get("chatui:sessions") ?? "[]") as Array<Record<string, unknown>>;
  return sessions.find((s) => s.id === id);
}

function storedMessages(sessionId: string): Array<Record<string, unknown>> {
  return JSON.parse(storage.get(`chatui:messages:${sessionId}`) ?? "[]") as Array<Record<string, unknown>>;
}

describe("full ChatUI backup", () => {
  it("exports every chatui key (including agents, schedules, memories) and restores them", () => {
    storage.set("chatui:providers", '[{"id":"p1"}]');
    storage.set("chatui:agents", '[{"id":"a1"}]');
    storage.set("chatui:schedules", '[{"id":"sc1"}]');
    storage.set("chatui:memory:global", '[{"id":"m1"}]');
    storage.set("chatui:messages:s1", "[]");
    storage.set("chatui_last_project_dir", "/tmp/x");
    storage.set("unrelated-key", "should not travel");

    const json = exportChatUiBackup();
    const parsed = JSON.parse(json) as { __chatui_export__: boolean; version: number; data: Record<string, string> };
    expect(parsed.__chatui_export__).toBe(true);
    expect(parsed.version).toBe(3);
    expect(Object.keys(parsed.data)).not.toContain("unrelated-key");
    expect(parsed.data["chatui:agents"]).toBe('[{"id":"a1"}]');

    storage.clear();
    expect(importData(json)).toEqual({ kind: "chatui", sessions: 0, messages: 0, skipped: 0 });
    expect(storage.get("chatui:agents")).toBe('[{"id":"a1"}]');
    expect(storage.get("chatui:memory:global")).toBe('[{"id":"m1"}]');
    expect(storage.get("chatui_last_project_dir")).toBe("/tmp/x");
  });

  it("still imports the old v2 export format", () => {
    const legacy = JSON.stringify({
      __chatui_export__: true,
      version: 2,
      data: { "chatui:settings": "{}", "chatui:messages:old": "[]" },
    });
    expect(importData(legacy).kind).toBe("chatui");
    expect(storage.has("chatui:messages:old")).toBe(true);
  });

  it("removes keys that were null in the backup", () => {
    storage.set("chatui:settings", "{}");
    const legacy = JSON.stringify({ __chatui_export__: true, data: { "chatui:settings": null } });
    importData(legacy);
    expect(storage.has("chatui:settings")).toBe(false);
  });
});

describe("portable exports", () => {
  it("follows the active (last-child) branch and skips temporary and empty messages", () => {
    seedSession("s1", "Rust help", [
      { id: "u1", role: "user", content: "how do threads work" },
      { id: "a1", role: "assistant", content: "old answer" },
      { id: "a2", role: "assistant", content: "regenerated answer", parent_id: "u1" },
      { id: "u2", role: "user", content: "thanks", parent_id: "a2" },
      { id: "u3", role: "user", content: "draft", parent_id: "a2", is_temporary: true },
      { id: "a3", role: "assistant", content: "", parent_id: "u2" },
    ]);

    const gpt = JSON.parse(exportOpenAiConversations()) as Array<{
      title: string;
      mapping: Record<string, { message: { author: { role: string }; content: { parts: string[] } } | null; parent: string | null; children: string[] }>;
      current_node: string;
    }>;
    expect(gpt).toHaveLength(1);
    expect(gpt[0].title).toBe("Rust help");
    // root → u1 → a2 (regenerated branch) → u2; a1/u3/a3 dropped
    expect(gpt[0].mapping.root.children).toEqual(["u1"]);
    expect(gpt[0].mapping.u1.children).toEqual(["a2"]);
    expect(gpt[0].mapping.a2.children).toEqual(["u2"]);
    expect(gpt[0].mapping.u2.children).toEqual([]);
    expect(gpt[0].current_node).toBe("u2");
    expect(gpt[0].mapping.a2.message?.content.parts).toEqual(["regenerated answer"]);

    const claude = JSON.parse(exportAnthropicConversations()) as Array<{
      name: string;
      chats: Array<{ sender: string; text?: string; content_feature_store?: Array<{ text: string }> }>;
    }>;
    expect(claude).toHaveLength(1);
    expect(claude[0].chats.map((c) => c.sender)).toEqual(["human", "assistant", "human"]);
    expect(claude[0].chats[0].text).toBe("how do threads work");
    expect(claude[0].chats[1].content_feature_store?.[0].text).toBe("regenerated answer");
  });

  it("skips sessions with no portable messages", () => {
    seedSession("s-empty", "Empty", []);
    seedSession("s-full", "Full", [{ id: "u1", role: "user", content: "hi" }]);
    const gpt = JSON.parse(exportOpenAiConversations()) as unknown[];
    expect(gpt).toHaveLength(1);
  });
});

describe("import from ChatGPT format", () => {
  function chatGptNode(id: string, parent: string | null, children: string[], message: Record<string, unknown> | null) {
    return { id, parent, children, message };
  }

  it("walks current_node to the root and drops system/tool boilerplate", () => {
    const mapping = {
      root: chatGptNode("root", null, ["sys"], null),
      sys: chatGptNode("sys", "root", ["u1"], {
        id: "sys",
        author: { role: "system" },
        create_time: 1700000000,
        content: { content_type: "text", parts: ["You are ChatGPT"] },
      }),
      u1: chatGptNode("u1", "sys", ["a1"], {
        id: "u1",
        author: { role: "user" },
        create_time: 1700000001,
        content: { content_type: "text", parts: ["hello"] },
      }),
      tool: chatGptNode("tool", "u1", ["a1"], {
        id: "tool",
        author: { role: "tool" },
        create_time: 1700000002,
        content: { content_type: "tool_use_response", parts: [] },
      }),
      a1: chatGptNode("a1", "u1", ["u2"], {
        id: "a1",
        author: { role: "assistant" },
        create_time: 1700000003,
        content: { content_type: "multimodal_text", parts: ["answer", { content_type: "image_asset_pointer" }] },
      }),
      u2: chatGptNode("u2", "a1", [], {
        id: "u2",
        author: { role: "user" },
        create_time: 1700000004,
        content: { content_type: "text", parts: ["thanks"] },
      }),
    };
    const file = JSON.stringify([
      { title: "GPT chat", create_time: 1700000000, update_time: 1700000004, mapping, current_node: "u2", conversation_id: "c-gpt-1" },
    ]);

    const result = importData(file);
    expect(result).toEqual({ kind: "openai", sessions: 1, messages: 3, skipped: 0 });
    expect(storedSession("c-gpt-1")).toMatchObject({ title: "GPT chat", type: "chat" });
    const msgs = storedMessages("c-gpt-1");
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "hello"],
      ["assistant", "answer"], // multimodal part objects dropped
      ["user", "thanks"],
    ]);
    expect(msgs[0].parent_id).toBeNull();
    expect(msgs[1].parent_id).toBe("u1");
    expect(new Date(msgs[1].timestamp as string).getTime()).toBe(1700000003 * 1000);
  });

  it("is idempotent: re-importing the same file adds nothing", () => {
    const mapping = {
      root: chatGptNode("root", null, ["u1"], null),
      u1: chatGptNode("u1", "root", [], {
        id: "u1",
        author: { role: "user" },
        create_time: 1700000000,
        content: { content_type: "text", parts: ["hi"] },
      }),
    };
    const file = JSON.stringify([{ title: "Once", mapping, current_node: "u1", conversation_id: "c-gpt-2" }]);
    importData(file);
    const result = importData(file);
    expect(result).toEqual({ kind: "openai", sessions: 0, messages: 0, skipped: 1 });
    expect(storedMessages("c-gpt-2")).toHaveLength(1);
  });
});

describe("import from Claude format", () => {
  it("maps human/assistant chats with text or content_feature_store", () => {
    const file = JSON.stringify([
      {
        uuid: "c-claude-1",
        name: "Claude chat",
        created_at: "2026-01-02T03:04:05.000000+00:00",
        updated_at: "2026-01-02T03:05:05.000000+00:00",
        chats: [
          { uuid: "h1", sender: "human", text: "hey there", created_at: "2026-01-02T03:04:05Z" },
          {
            uuid: "a1",
            sender: "assistant",
            created_at: "2026-01-02T03:04:30Z",
            content_feature_store: [
              { content_type: "text", text: "Hi! " },
              { content_type: "text", text: "How can I help?" },
            ],
          },
          { uuid: "h2", sender: "human", text: "", created_at: "2026-01-02T03:05:05Z" },
        ],
      },
    ]);

    const result = importData(file);
    expect(result).toEqual({ kind: "anthropic", sessions: 1, messages: 2, skipped: 0 });
    expect(storedSession("c-claude-1")).toMatchObject({ title: "Claude chat", type: "chat" });
    const msgs = storedMessages("c-claude-1");
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "hey there"],
      ["assistant", "Hi! How can I help?"],
    ]);
    expect(msgs[1].parent_id).toBe("h1");
  });
});

describe("round trip", () => {
  it("ChatUI → ChatGPT format → back into a fresh store preserves the conversation", () => {
    seedSession("s1", "Round trip", [
      { id: "u1", role: "user", content: "question" },
      { id: "a1", role: "assistant", content: "answer" },
    ]);
    const exported = exportOpenAiConversations();

    storage.clear();
    const result = importData(exported);
    expect(result).toEqual({ kind: "openai", sessions: 1, messages: 2, skipped: 0 });

    const sessions = JSON.parse(storage.get("chatui:sessions") ?? "[]") as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    const msgs = storedMessages(sessions[0].id as string);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "question"],
      ["assistant", "answer"],
    ]);
    // The restored chain renders as one linear thread.
    const asMessages = msgs.map((m) => ({
      id: m.id as string,
      role: m.role as Message["role"],
      content: m.content as string,
      timestamp: new Date(m.timestamp as string),
      parent_id: (m.parent_id as string | null) ?? null,
    })) as Message[];
    const { roots, nodeMap } = buildMessageTree(asMessages);
    const thread = getActivePath(roots, nodeMap, new Map());
    expect(thread.map((n) => n.message.content)).toEqual(["question", "answer"]);
  });
});

describe("format detection errors", () => {
  it("rejects invalid JSON", () => {
    expect(() => importData("{nope")).toThrow("not valid JSON");
  });

  it("rejects unknown structures", () => {
    expect(() => importData('{"foo": 1}')).toThrow("Unrecognized import format");
    expect(() => importData('[{"foo": 1}]')).toThrow("Unrecognized import format");
  });

  it("rejects an empty conversations array", () => {
    expect(() => importData("[]")).toThrow("no conversations");
  });
});
