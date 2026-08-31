import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAgentDefinitions,
  saveAgentDefinition,
  deleteAgentDefinition,
  subscribeToAgents,
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
});
