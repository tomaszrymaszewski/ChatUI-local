import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAgentDefinitions,
  saveAgentDefinition,
  updateAgentDefinition,
  deleteAgentDefinition,
  subscribeToAgents,
  AGENT_FACE_COLORS,
  ensureAgentColor,
  agentColor,
  type AgentUpdatePatch,
} from "@/lib/agents";

// The vitest environment is node — stub the browser globals agents.ts uses.
const storage = new Map<string, string>();
const listeners = new Set<() => void>();

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal("window", {
    dispatchEvent: (e: { type?: string }) => {
      if (e.type === "chatui:agents-changed") listeners.forEach((l) => l());
      return true;
    },
    addEventListener: (_: string, l: () => void) => {
      listeners.add(l);
    },
    removeEventListener: (_: string, l: () => void) => {
      listeners.delete(l);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clear();
  listeners.clear();
});

const sampleDef = {
  name: "Invoice Wrangler",
  purpose: "Chases unpaid invoices",
  systemPrompt: "You chase invoices politely.",
  skills: ["docx"],
  connectors: ["zapier"],
  capabilities: { terminal: false, web: true, files: false, computerUse: false },
};

describe("agent definitions storage", () => {
  it("saves and reloads a definition with generated id and createdAt", () => {
    const saved = saveAgentDefinition(sampleDef);
    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toBeTruthy();

    const all = loadAgentDefinitions();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Invoice Wrangler");
    expect(all[0].capabilities.terminal).toBe(false);
    expect(all[0].skills).toEqual(["docx"]);
  });

  it("deletes a definition by id", () => {
    const saved = saveAgentDefinition(sampleDef);
    deleteAgentDefinition(saved.id);
    expect(loadAgentDefinitions()).toHaveLength(0);
  });

  it("updates a definition in place, keeping id and createdAt", () => {
    const saved = saveAgentDefinition(sampleDef);
    const updated = updateAgentDefinition(saved.id, {
      name: "Invoice Boss",
      systemPrompt: "You chase invoices aggressively.",
      model: "gpt-5",
      readChats: true,
      allowedFolders: ["/Users/tester/Projects/invoices"],
      capabilities: { terminal: true },
    });
    expect(updated?.id).toBe(saved.id);
    expect(updated?.createdAt).toBe(saved.createdAt);
    expect(updated?.name).toBe("Invoice Boss");
    expect(updated?.model).toBe("gpt-5");
    expect(updated?.readChats).toBe(true);
    expect(updated?.allowedFolders).toEqual(["/Users/tester/Projects/invoices"]);
    // capabilities patch merges into the existing object, not replaces it.
    // The load inside updateAgentDefinition runs the one-time computerUse
    // rollout first, so the merged record carries computerUse: true.
    expect(updated?.capabilities).toEqual({
      terminal: true,
      web: true,
      files: false,
      computerUse: true,
    });
    // Still exactly one record, updated in place.
    const all = loadAgentDefinitions();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Invoice Boss");
  });

  it("stamps createdAt and updatedAt together on save", () => {
    const saved = saveAgentDefinition(sampleDef);
    expect(saved.createdAt).toBeTruthy();
    expect(saved.updatedAt).toBe(saved.createdAt);
  });

  it("bumps updatedAt on update but keeps id and createdAt", () => {
    const saved = saveAgentDefinition(sampleDef);
    const updated = updateAgentDefinition(saved.id, { purpose: "New purpose" });
    expect(updated?.id).toBe(saved.id);
    expect(updated?.createdAt).toBe(saved.createdAt);
    expect(Date.parse(updated?.updatedAt ?? "")).toBeGreaterThanOrEqual(Date.parse(saved.createdAt));
  });

  it("ignores forged identity and timestamp fields in patches", () => {
    const saved = saveAgentDefinition(sampleDef);
    const updated = updateAgentDefinition(saved.id, {
      name: "Renamed",
      ...({ id: "forged", createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z" } as unknown as AgentUpdatePatch),
    });
    expect(updated?.id).toBe(saved.id);
    expect(updated?.createdAt).toBe(saved.createdAt);
    expect(updated?.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("backfills updatedAt from createdAt for legacy records", () => {
    const saved = saveAgentDefinition(sampleDef);
    const legacy = { ...saved };
    delete (legacy as Partial<typeof legacy>).updatedAt;
    storage.set("chatui:agents", JSON.stringify([legacy]));
    const all = loadAgentDefinitions();
    expect(all[0].updatedAt).toBe(saved.createdAt);
    // The backfill persists so it runs once, not on every load.
    expect(JSON.parse(storage.get("chatui:agents")!)[0].updatedAt).toBe(saved.createdAt);
  });

  it("clears a patchable field back to undefined (e.g. model)", () => {
    const saved = saveAgentDefinition({ ...sampleDef, model: "gpt-5" });
    const updated = updateAgentDefinition(saved.id, { model: undefined });
    expect(updated?.model).toBeUndefined();
  });

  it("returns null when updating an unknown id and changes nothing", () => {
    saveAgentDefinition(sampleDef);
    expect(updateAgentDefinition("nope", { name: "X" })).toBeNull();
    expect(loadAgentDefinitions()[0].name).toBe("Invoice Wrangler");
  });

  it("notifies subscribers when a definition is updated", () => {
    const saved = saveAgentDefinition(sampleDef);
    // Burn the one-time computerUse migration so its persist doesn't count
    // toward the update's own notification.
    loadAgentDefinitions();
    const fn = vi.fn();
    const unsubscribe = subscribeToAgents(fn);
    updateAgentDefinition(saved.id, { purpose: "New purpose" });
    expect(fn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("drops malformed entries instead of throwing", () => {
    storage.set("chatui:agents", JSON.stringify([{ nope: true }, "junk"]));
    expect(loadAgentDefinitions()).toEqual([]);
  });

  it("notifies subscribers when a definition is saved", () => {
    const fn = vi.fn();
    const unsubscribe = subscribeToAgents(fn);
    saveAgentDefinition(sampleDef);
    expect(fn).toHaveBeenCalledTimes(1);
    unsubscribe();
    saveAgentDefinition(sampleDef);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("migrates legacy readChats=true agents to externalChats=all (keeps their reach)", () => {
    const saved = saveAgentDefinition({ ...sampleDef, readChats: true });
    storage.set(
      "chatui:agents",
      // Wipe the migrated field to simulate a pre-split record.
      JSON.stringify([{ ...saved, externalChats: undefined }]),
    );
    const all = loadAgentDefinitions();
    expect(all[0].readChats).toBe(true);
    expect(all[0].externalChats).toBe("all");
    // The migration persists so it runs once, not on every load.
    expect(JSON.parse(storage.get("chatui:agents")!)[0].externalChats).toBe("all");
  });

  it("migrates agents to computerUse=true once (browser automation shipped)", () => {
    const saved = saveAgentDefinition(sampleDef);
    // Re-seed the saved record to simulate a pre-migration agent.
    storage.set("chatui:agents", JSON.stringify([saved]));
    const all = loadAgentDefinitions();
    expect(all[0].capabilities.computerUse).toBe(true);
    // The migration persists so it runs once, not on every load.
    expect(JSON.parse(storage.get("chatui:agents")!)[0].capabilities.computerUse).toBe(true);
    // A user turning it off afterwards sticks (the rollout never re-fires).
    updateAgentDefinition(saved.id, { capabilities: { computerUse: false } });
    expect(loadAgentDefinitions()[0].capabilities.computerUse).toBe(false);
  });

  it("leaves agents with externalChats already set (or readChats off) untouched", () => {
    const saved = saveAgentDefinition({ ...sampleDef, readChats: true });
    storage.set("chatui:agents", JSON.stringify([{ ...saved, externalChats: "selected" }]));
    expect(loadAgentDefinitions()[0].externalChats).toBe("selected");

    const off = saveAgentDefinition(sampleDef);
    storage.set("chatui:agents", JSON.stringify([off]));
    expect(loadAgentDefinitions()[0].externalChats).toBeUndefined();
    expect(storage.get("chatui:agents")).toBe(JSON.stringify([off]));
  });
});

describe("agent face colors", () => {
  it("assigns every new agent a distinct color from the palette", () => {
    const colors = new Set<string>();
    for (let i = 0; i < AGENT_FACE_COLORS.length; i++) {
      const saved = saveAgentDefinition({ ...sampleDef, name: `Agent ${i}` });
      expect(saved.color).toBeTruthy();
      colors.add(saved.color!);
    }
    expect(colors.size).toBe(AGENT_FACE_COLORS.length);
    // Persisted with the definitions (so cloud sync carries them).
    const all = loadAgentDefinitions();
    expect(all.every((a) => AGENT_FACE_COLORS.includes(a.color!))).toBe(true);
  });

  it("keeps a caller-supplied color", () => {
    const saved = saveAgentDefinition({ ...sampleDef, color: "#123456" });
    expect(saved.color).toBe("#123456");
    expect(agentColor(saved.id)).toBe("#123456");
  });

  it("ensureAgentColor backfills legacy agents once and stays stable", () => {
    const saved = saveAgentDefinition({ ...sampleDef });
    // Simulate a pre-color record.
    updateAgentDefinition(saved.id, { color: undefined });
    expect(agentColor(saved.id)).toBeUndefined();

    const first = ensureAgentColor(saved.id);
    expect(AGENT_FACE_COLORS).toContain(first);
    expect(agentColor(saved.id)).toBe(first);
    // Idempotent: a second call returns the stored color.
    expect(ensureAgentColor(saved.id)).toBe(first);
  });
});
