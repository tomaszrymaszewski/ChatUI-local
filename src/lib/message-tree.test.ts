import { describe, expect, it } from "vitest";
import { buildMessageTree, getActivePath, getVisibleMessages } from "@/lib/message-tree";
import type { Message } from "@/types";

function message(id: string, parentId: string | null, role: Message["role"] = "user"): Message {
  return {
    id,
    role,
    content: id,
    timestamp: new Date(0),
    parent_id: parentId,
  };
}

describe("getVisibleMessages", () => {
  it("follows the last-child chain from the newest root", () => {
    const messages = [
      message("u1", null),
      message("a1", "u1", "assistant"),
      message("u2", "a1"),
      message("a2", "u2", "assistant"),
    ];
    expect(getVisibleMessages(messages).map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("excludes a regenerated-away reply (hidden sibling)", () => {
    // u1 → a1 (regenerated into a2) → u2 → a3
    const messages = [
      message("u1", null),
      message("a1", "u1", "assistant"),
      message("a2", "u1", "assistant"),
      message("u2", "a2"),
      message("a3", "u2", "assistant"),
    ];
    expect(getVisibleMessages(messages).map((m) => m.id)).toEqual(["u1", "a2", "u2", "a3"]);
  });

  it("excludes the pre-edit sibling of an edited message", () => {
    const messages = [
      message("u1", null),
      message("u1-edited", null),
      message("a1", "u1-edited", "assistant"),
    ];
    expect(getVisibleMessages(messages).map((m) => m.id)).toEqual(["u1-edited", "a1"]);
  });

  it("picks the newest root when the thread has several", () => {
    const messages = [message("u1", null), message("u2", null), message("a2", "u2", "assistant")];
    expect(getVisibleMessages(messages).map((m) => m.id)).toEqual(["u2", "a2"]);
  });

  it("treats a message with a missing parent as its own root", () => {
    const messages = [message("orphan", "gone"), message("u1", null), message("a1", "u1", "assistant")];
    expect(getVisibleMessages(messages).map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("returns nothing for an empty thread", () => {
    expect(getVisibleMessages([])).toEqual([]);
  });
});

describe("buildMessageTree / getActivePath", () => {
  it("honours an explicit child selection", () => {
    const messages = [
      message("u1", null),
      message("a1", "u1", "assistant"),
      message("a2", "u1", "assistant"),
    ];
    const { roots, nodeMap } = buildMessageTree(messages);
    const path = getActivePath(roots, nodeMap, new Map([["u1", "a1"]]));
    expect(path.map((n) => n.message.id)).toEqual(["u1", "a1"]);
  });
});
