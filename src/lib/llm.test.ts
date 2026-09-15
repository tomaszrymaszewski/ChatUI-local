import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDERS_EVENT,
  capTitleWords,
  createProvider,
  deleteProvider,
  fetchProviders,
  getProviderApiKey,
  instantChatTitle,
  updateProvider,
} from "./llm";

const storage = new Map<string, string>();
const seen: string[] = [];

beforeEach(() => {
  storage.clear();
  seen.length = 0;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  });
  vi.stubGlobal("window", {
    dispatchEvent: (e: Event) => {
      seen.push(e.type);
      return true;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider CRUD", () => {
  it("editing a provider without models preserves the model list and key", async () => {
    await createProvider("P", "https://x", "sk-x", [{ id: "m1", name: "model-1" }]);
    const [before] = await fetchProviders();
    // Blank key + omitted models: a name/URL touch-up.
    await updateProvider(before.id, "P2", "https://y", "", undefined);
    const [after] = await fetchProviders();
    expect(after.name).toBe("P2");
    expect(after.baseUrl).toBe("https://y");
    expect(after.models).toEqual([{ id: "m1", name: "model-1" }]);
    expect(await getProviderApiKey(before.id)).toBe("sk-x");
  });

  it("passing models still replaces the list", async () => {
    await createProvider("P", "https://x", "sk-x", [{ id: "m1", name: "model-1" }]);
    const [before] = await fetchProviders();
    await updateProvider(before.id, "P", "https://x", "", [{ id: "m2", name: "model-2" }]);
    const [after] = await fetchProviders();
    expect(after.models).toEqual([{ id: "m2", name: "model-2" }]);
  });

  it("deleting the last provider drops the key so sync propagates a tombstone", async () => {
    await createProvider("P", "https://x", "sk-x", []);
    const [p] = await fetchProviders();
    await deleteProvider(p.id);
    expect(storage.has("chatui:providers")).toBe(false);
    expect(await fetchProviders()).toEqual([]);
    expect(seen).toContain(PROVIDERS_EVENT);
  });

  it("deleting one of several providers keeps the rest", async () => {
    await createProvider("A", "https://a", "sk-a", []);
    await createProvider("B", "https://b", "sk-b", []);
    const [a] = await fetchProviders();
    await deleteProvider(a.id);
    const rest = await fetchProviders();
    expect(rest.map((p) => p.name)).toEqual(["B"]);
    expect(storage.has("chatui:providers")).toBe(true);
  });
});

describe("capTitleWords", () => {
  it("keeps a short title unchanged (minus trailing punctuation)", () => {
    expect(capTitleWords("Rust async patterns.")).toBe("Rust async patterns");
  });

  it("truncates to 4 words", () => {
    expect(capTitleWords("How do I parse a JSON file in Rust", 4)).toBe(
      "How do I parse",
    );
  });

  it("supports a custom word cap", () => {
    expect(capTitleWords("one two three four", 2)).toBe("one two");
  });

  it("strips quotes and newlines", () => {
    expect(capTitleWords('"Reactive\nProgramming" in Vue.js today')).toBe(
      "Reactive Programming in Vue.js",
    );
  });

  it("returns empty for whitespace-only input", () => {
    expect(capTitleWords("   ")).toBe("");
  });
});

describe("instantChatTitle", () => {
  it("uses the first 4 words of the message", () => {
    expect(instantChatTitle("what is the best way to cook rice")).toBe(
      "What is the best",
    );
  });

  it("capitalizes the first letter", () => {
    expect(instantChatTitle("fixing a memory leak")).toBe("Fixing a memory leak");
  });

  it("strips mode-trigger prefixes", () => {
    expect(instantChatTitle("research the history of the Ming dynasty")).toBe(
      "The history of the",
    );
    expect(instantChatTitle("teach me linear algebra")).toBe("Linear algebra");
    expect(instantChatTitle("i want to learn python properly")).toBe(
      "Python properly",
    );
    expect(instantChatTitle("discuss the pros of nuclear power")).toBe(
      "The pros of nuclear",
    );
  });

  it("falls back to New Chat for empty input", () => {
    expect(instantChatTitle("")).toBe("New Chat");
    expect(instantChatTitle("   ")).toBe("New Chat");
  });

  it("handles a message that is only a trigger word", () => {
    expect(instantChatTitle("research")).toBe("New Chat");
  });

  it("falls back to a word-based title for attachments-only sends", () => {
    expect(instantChatTitle("Attachments")).toBe("Attachments");
  });
});
