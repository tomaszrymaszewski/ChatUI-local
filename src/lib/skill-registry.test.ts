import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGithubSkillUrl, fetchRegistrySkills, listAllCatalogSkills } from "./skill-registry";

function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).localStorage;
});

describe("parseGithubSkillUrl", () => {
  it("parses a repo URL as a whole-repo skill", () => {
    expect(parseGithubSkillUrl("https://github.com/owner/repo")).toEqual({
      name: "repo",
      repo: "owner/repo",
      dir: "",
      branch: undefined,
      sourceLabel: "Custom — GitHub",
    });
  });

  it("parses a /tree/<branch>/<dir> URL into the last path segment", () => {
    const parsed = parseGithubSkillUrl(
      "https://github.com/anthropics/skills/tree/main/skills/pdf",
    );
    expect(parsed?.name).toBe("pdf");
    expect(parsed?.repo).toBe("anthropics/skills");
    expect(parsed?.dir).toBe("skills/pdf");
    expect(parsed?.branch).toBeUndefined(); // main is the default
  });

  it("keeps non-main branches", () => {
    const parsed = parseGithubSkillUrl("https://github.com/owner/repo/tree/next/skill-pack");
    expect(parsed?.branch).toBe("next");
    expect(parsed?.dir).toBe("skill-pack");
  });

  it("rejects non-repo URLs", () => {
    expect(parseGithubSkillUrl("https://example.com/owner/repo")).toBeNull();
    expect(parseGithubSkillUrl("not a url")).toBeNull();
  });
});

describe("fetchRegistrySkills", () => {
  it("fetches from the registry URL and caches", async () => {
    stubLocalStorage();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 1,
          skills: [{ name: "a", title: "A", description: "d", category: "Coding", sourceLabel: "s", keywords: ["k"] }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const skills = await fetchRegistrySkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].keywords).toEqual(["k"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call within TTL: cache, no second fetch.
    await expect(fetchRegistrySkills()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the stale cache when the network fails", async () => {
    stubLocalStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    await expect(fetchRegistrySkills()).resolves.toHaveLength(0); // primes (empty) cache
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchRegistrySkills()).resolves.toHaveLength(0);
  });

  it("returns empty (never throws) with no cache and a failing network", async () => {
    stubLocalStorage();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchRegistrySkills()).resolves.toEqual([]);
  });
});

describe("listAllCatalogSkills", () => {
  it("merges bundled + registry + curated fallback and dedupes by name", async () => {
    stubLocalStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            version: 1,
            skills: [
              // Overrides the bundled research skill's description.
              { name: "research", title: "Registry Research", description: "registry", category: "Workflow", sourceLabel: "reg", keywords: [] },
              { name: "registry-only", title: "Only In Registry", description: "d", category: "Coding", sourceLabel: "reg", keywords: [] },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const catalog = await listAllCatalogSkills();
    const byName = new Map(catalog.map((s) => [s.name, s]));
    // Bundled wins over registry.
    expect(byName.get("research")?.description).not.toBe("registry");
    expect(byName.get("fastapi")?.category).toBe("Built-in");
    // Registry-only entries come through.
    expect(byName.get("registry-only")?.title).toBe("Only In Registry");
    // In-bundle curated entries survive even when the registry doesn't know them.
    expect(byName.get("pptx")?.name).toBe("pptx");
  });
});
