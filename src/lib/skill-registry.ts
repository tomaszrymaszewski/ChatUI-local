import {
  CURATED_SKILLS,
  listBundledSkills,
  getBundledSkillContent,
  type SkillCategory,
} from "@/lib/skills-library";

// ─── Remote skill registry ──────────────────────────────────────────────────
//
// The catalog lives as `registry.json` in the app's own GitHub repo, so new
// skills reach every install without shipping an app release. The fetch is
// cached in localStorage (24 h TTL) and falls back to the in-bundle curated
// list when offline — the app is fully usable either way.

/** Raw URL of the registry file in the app's repo (main branch). */
const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/tomaszrymaszewski/ChatUI-local/main/registry.json";

/** Optional override (e.g. a personal fork) — read by the settings UI later. */
const REGISTRY_URL_KEY = "chatui:skills:registry-url";
const REGISTRY_CACHE_KEY = "chatui:skills:registry";
const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;

/** Custom skills added by the user (GitHub URL flows). */
const CUSTOM_SKILLS_KEY = "chatui:skills:custom";

export interface RegistrySkill {
  /** Folder name used on disk (`<skillsDir>/<name>/SKILL.md`). */
  name: string;
  title: string;
  description: string;
  category: SkillCategory;
  sourceLabel: string;
  /** GitHub repo "owner/repo" to fetch from. */
  repo: string;
  /** Directory within the repo containing the skill files ("" = repo root). */
  dir: string;
  /** Branch to fetch from (default "main"). */
  branch?: string;
  /**
   * Extra retrieval keywords — searched by RAG and search_skills so the
   * skill is findable by tasks it helps with, not just its name.
   */
  keywords: string[];
}

/** One unified catalog entry (bundled + registry + custom), for UI + tools. */
export interface CatalogSkill {
  name: string;
  title: string;
  description: string;
  category: SkillCategory;
  sourceLabel: string;
  keywords: string[];
  /** Where the skill files come from — undefined for bundled-only skills. */
  repo?: string;
  dir?: string;
  branch?: string;
  /** true = user-added via the skills panel. */
  custom?: boolean;
}

interface RegistryFile {
  version: number;
  skills: RegistrySkill[];
  /** Same registry can also carry connector (MCP server) catalog entries. */
  connectors?: unknown[];
}

interface RegistryCache {
  fetchedAt: number;
  file: RegistryFile;
}

function registryUrl(): string {
  try {
    return localStorage.getItem(REGISTRY_URL_KEY) ?? DEFAULT_REGISTRY_URL;
  } catch {
    return DEFAULT_REGISTRY_URL;
  }
}

function readCache(): RegistryCache | null {
  try {
    const raw = localStorage.getItem(REGISTRY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RegistryCache;
    if (!parsed?.file || !Array.isArray(parsed.file.skills)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(file: RegistryFile): void {
  try {
    localStorage.setItem(
      REGISTRY_CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), file } satisfies RegistryCache),
    );
  } catch {
    // ignore quota errors
  }
}

/**
 * The whole registry file, freshest available: network fetch (cached 24 h) →
 * stale cache → null (callers fall back to their bundled lists).
 */
export async function fetchRegistryFile(): Promise<RegistryFile | null> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < REGISTRY_TTL_MS) {
    return cached.file;
  }
  try {
    const res = await fetch(registryUrl());
    if (res.ok) {
      const data = (await res.json()) as RegistryFile;
      if (Array.isArray(data?.skills)) {
        writeCache(data);
        return data;
      }
    }
  } catch {
    // offline — fall through to cache
  }
  return cached?.file ?? null;
}

/**
 * Registry skills, freshest available: network fetch (cached 24 h) → stale
 * cache → empty (callers fall back to the bundled curated list).
 */
export async function fetchRegistrySkills(): Promise<RegistrySkill[]> {
  const file = await fetchRegistryFile();
  return (
    file?.skills.filter(
      (s) => s && typeof s.name === "string" && typeof s.description === "string",
    ) ?? []
  );
}

/**
 * The unified skill catalog: bundled (always available, offline) + registry
 * (remote) + custom (user-added). Deduped by name — bundled wins, then
 * registry, then custom. Consumers: the skills panel, search_skills, and the
 * knowledge index.
 */
export async function listAllCatalogSkills(): Promise<CatalogSkill[]> {
  const bundled: CatalogSkill[] = listBundledSkills().map((s) => ({
    name: s.name,
    title: s.name,
    description: s.description,
    category: "Built-in",
    sourceLabel: "Built-in",
    keywords: [],
  }));
  const registry: CatalogSkill[] = (await fetchRegistrySkills()).map((s) => ({
    name: s.name,
    title: s.title,
    description: s.description,
    category: s.category,
    sourceLabel: s.sourceLabel,
    keywords: s.keywords ?? [],
    repo: s.repo,
    dir: s.dir,
    branch: s.branch,
  }));
  const custom = listCustomSkills().map(
    (s): CatalogSkill => ({
      name: s.name,
      title: s.title,
      description: s.description,
      category: s.category,
      sourceLabel: s.sourceLabel,
      keywords: s.keywords ?? [],
      repo: s.repo,
      dir: s.dir,
      branch: s.branch,
      custom: true,
    }),
  );

  const byName = new Map<string, CatalogSkill>();
  // Registry first, then bundled overrides, then custom (newest user intent).
  for (const entry of [...registry, ...bundled, ...custom]) {
    byName.set(entry.name, entry);
  }
  // In-bundle curated entries last — the registry is a superset, but keep any
  // entry that neither the (fresh or stale) registry nor bundled knows.
  for (const curated of CURATED_SKILLS) {
    if (!byName.has(curated.name)) {
      byName.set(curated.name, {
        name: curated.name,
        title: curated.title,
        description: curated.description,
        category: curated.category,
        sourceLabel: curated.sourceLabel,
        keywords: [],
        repo: curated.repo,
        dir: curated.dir,
      });
    }
  }
  return [...byName.values()];
}

// ─── Custom (user-added) catalog entries ────────────────────────────────────

export function listCustomSkills(): RegistrySkill[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SKILLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RegistrySkill[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomSkill(entry: RegistrySkill): void {
  try {
    const skills = listCustomSkills().filter((s) => s.name !== entry.name);
    skills.unshift(entry);
    localStorage.setItem(CUSTOM_SKILLS_KEY, JSON.stringify(skills));
  } catch {
    // ignore quota errors
  }
}

export function removeCustomSkill(name: string): void {
  try {
    localStorage.setItem(
      CUSTOM_SKILLS_KEY,
      JSON.stringify(listCustomSkills().filter((s) => s.name !== name)),
    );
  } catch {
    // ignore quota errors
  }
}

/**
 * Parse a GitHub URL into registry-install info. Accepts:
 * - https://github.com/owner/repo                          (repo root = skill)
 * - https://github.com/owner/repo/tree/<branch>/<dir>/...  (one skill folder)
 * Returns null for URLs that don't point at a GitHub repo.
 */
export function parseGithubSkillUrl(url: string): Omit<RegistrySkill, "title" | "description" | "category" | "keywords"> | null {
  const m = url
    .trim()
    .match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/]+)((?:\/[\w.\-~]+)*))?\/?$/);
  if (!m) return null;
  const [, owner, repo, branch, dirPath] = m;
  const dir = (dirPath ?? "").replace(/^\/+|\/+$/g, "");
  const name = dir ? (dir.split("/").pop() ?? repo) : repo;
  return {
    name,
    repo: `${owner}/${repo}`,
    dir,
    branch: branch && branch !== "main" ? branch : undefined,
    sourceLabel: "Custom — GitHub",
  };
}

/** Bundled skill bodies stay installable through the same interface. */
export function getCatalogSkillBody(name: string): string | undefined {
  return getBundledSkillContent(name);
}
