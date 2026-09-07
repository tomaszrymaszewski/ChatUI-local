import { describe, expect, it } from "vitest";
import {
  ALWAYS_ON_KNOWLEDGE_TYPES,
  diffSourceDocs,
  enabledKnowledgeSourceTypes,
  hashKnowledgeText,
  type KnowledgeHit,
  type RawSourceDoc,
} from "@/lib/knowledge-index";
import {
  buildKnowledgeBlock,
  formatKnowledgeHitsForTool,
  hitLabel,
} from "@/lib/knowledge-retrieval";
import type { UserSettings } from "@/types";
import { resolveCodingAgent, type CodingAgentInfo } from "@/lib/coding-delegate";

function doc(overrides: Partial<RawSourceDoc> = {}): RawSourceDoc {
  return {
    sourceType: "chat",
    sourceRef: "s1:m1",
    sourceTitle: "Title",
    texts: ["chunk one", "chunk two"],
    hash: "h1",
    ...overrides,
  };
}

function hit(overrides: Partial<KnowledgeHit> = {}): KnowledgeHit {
  return {
    id: "chat:s1:m1:0",
    sourceType: "chat",
    sourceRef: "s1:m1",
    sourceTitle: "Trip planning",
    chunkIndex: 0,
    text: "User wants to visit Kyoto in autumn.",
    extra: { role: "user", ts: "2026-09-07T10:00:00.000Z" },
    distance: 0.2,
    ...overrides,
  };
}

function settings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    defaultModel: null,
    sendOnEnter: true,
    showTimestamps: true,
    soundEffects: false,
    temporaryByDefault: false,
    autoMemory: true,
    nickname: "",
    instructions: "",
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    backgroundPattern: "dots",
    terminalApproval: "ask",
    embeddingEndpoint: null,
    knowledgeEnabled: true,
    knowledgeSources: { chats: true, files: true, images: true, memories: true },
    ...overrides,
  };
}

describe("hashKnowledgeText", () => {
  it("is deterministic and length-aware", () => {
    expect(hashKnowledgeText("hello")).toBe(hashKnowledgeText("hello"));
    expect(hashKnowledgeText("hello")).not.toBe(hashKnowledgeText("hellö"));
  });

  it("changes when the content changes", () => {
    expect(hashKnowledgeText("v1")).not.toBe(hashKnowledgeText("v2"));
  });
});

describe("diffSourceDocs", () => {
  const state = [
    { sourceType: "chat", sourceRef: "s1:m1", contentHash: "h1", chunkCount: 2 },
    { sourceType: "chat", sourceRef: "s1:m2", contentHash: "h2", chunkCount: 1 },
    { sourceType: "chat", sourceRef: "s1:m5", contentHash: "h5", chunkCount: 1 },
  ];

  it("keeps unchanged, re-embeds changed/new, deletes gone", () => {
    const docs = [
      doc(), // unchanged (h1, 2 chunks)
      doc({ sourceRef: "s1:m2", texts: ["only"], hash: "h2-new" }), // hash changed
      doc({ sourceRef: "s1:m3", texts: ["new"], hash: "h3" }), // new
    ];
    const diff = diffSourceDocs(docs, state, new Set());
    expect(diff.changed.map((d) => d.sourceRef)).toEqual(["s1:m2", "s1:m3"]);
    expect(diff.removedRefs).toEqual(["s1:m5"]);
  });

  it("re-embeds when the chunk count changes even if the hash matches", () => {
    const docs = [doc({ texts: ["one", "two", "three"] })];
    const diff = diffSourceDocs(docs, state, new Set());
    expect(diff.changed.map((d) => d.sourceRef)).toEqual(["s1:m1"]);
  });

  it("treats skipped refs (unchanged sessions) as neither changed nor removed", () => {
    const docs = [doc()];
    const diff = diffSourceDocs(docs, state, new Set(["s1:m2", "s1:m5"]));
    expect(diff.changed).toHaveLength(0);
    expect(diff.removedRefs).toHaveLength(0);
  });
});

describe("buildKnowledgeBlock", () => {
  it("formats one labeled line per hit", () => {
    const block = buildKnowledgeBlock([hit(), hit({ sourceType: "memory", sourceTitle: null, extra: null, id: "memory:m1:0", text: "User prefers window seats." })]);
    expect(block).toContain("Relevant knowledge from the user's library");
    expect(block).toContain("[past chat — Trip planning, 2026-09-07]: User wants to visit Kyoto in autumn.");
    expect(block).toContain("[memory]: User prefers window seats.");
  });

  it("stops within the character budget", () => {
    const long = "x".repeat(400);
    const block = buildKnowledgeBlock([hit({ text: long }), hit({ id: "chat:s1:m2:0", sourceRef: "s1:m2", text: long })], 450);
    expect(block).toContain("Relevant knowledge");
    expect(block.match(/^- /gm)?.length).toBe(1);
  });

  it("returns empty for no hits", () => {
    expect(buildKnowledgeBlock([])).toBe("");
  });
});

describe("formatKnowledgeHitsForTool", () => {
  it("includes ids and the exclusion hint", () => {
    const out = formatKnowledgeHitsForTool([hit()]);
    expect(out).toContain("id: chat:s1:m1:0");
    expect(out).toContain("exclude_ids");
    expect(out).toContain("chunk 0");
  });
});

describe("hitLabel", () => {
  it("labels every source type", () => {
    expect(hitLabel(hit({ sourceType: "file", sourceTitle: "notes.pdf" }))).toBe("[file — notes.pdf]");
    expect(hitLabel(hit({ sourceType: "image", sourceTitle: "cat.png" }))).toBe("[image — cat.png]");
    expect(hitLabel(hit({ sourceType: "skill_doc", sourceTitle: "pdf" }))).toBe("[skill — pdf]");
    expect(hitLabel(hit({ sourceType: "connector", sourceTitle: "Notion" }))).toBe("[connector — Notion]");
    expect(hitLabel(hit({ sourceType: "memory", sourceTitle: null }))).toBe("[memory]");
  });
});

describe("enabledKnowledgeSourceTypes", () => {
  it("always includes skills and connectors, even with the master toggle off", () => {
    const types = enabledKnowledgeSourceTypes(
      settings({ knowledgeEnabled: false }),
    );
    for (const t of ALWAYS_ON_KNOWLEDGE_TYPES) {
      expect(types).toContain(t);
    }
    expect(types).not.toContain("chat");
    expect(types).not.toContain("memory");
  });

  it("respects the user-data toggles when the master toggle is on", () => {
    const types = enabledKnowledgeSourceTypes(
      settings({ knowledgeSources: { chats: true, files: false, images: false, memories: true } }),
    );
    expect(types).toContain("chat");
    expect(types).toContain("memory");
    expect(types).not.toContain("file");
    expect(types).not.toContain("image");
    for (const t of ALWAYS_ON_KNOWLEDGE_TYPES) {
      expect(types).toContain(t);
    }
  });
});

describe("resolveCodingAgent", () => {
  const opencode: CodingAgentInfo = { id: "opencode", name: "OpenCode", path: "/usr/local/bin/opencode" };
  const claude: CodingAgentInfo = { id: "claude", name: "Claude Code", path: "/usr/local/bin/claude" };

  it("picks the only installed agent automatically", () => {
    const choice = resolveCodingAgent([opencode]);
    expect(choice).toEqual({ status: "ok", agent: opencode });
  });

  it("honors an explicit request", () => {
    const choice = resolveCodingAgent([opencode, claude], "claude");
    expect(choice).toEqual({ status: "ok", agent: claude });
  });

  it("asks when several are installed and nothing requested", () => {
    const choice = resolveCodingAgent([opencode, claude]);
    expect(choice).toEqual({ status: "ask", options: [opencode, claude] });
  });

  it("reports missing agents", () => {
    expect(resolveCodingAgent([opencode], "codex")).toEqual({
      status: "missing",
      requested: "codex",
    });
    expect(resolveCodingAgent([], "claude")).toEqual({
      status: "missing",
      requested: "claude",
    });
  });

  it("falls back to the deep agent when none is installed", () => {
    expect(resolveCodingAgent([])).toEqual({ status: "none" });
  });
});
