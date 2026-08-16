// Seed pipeline for Phase 2-C's upload input mode — turns an uploaded doc
// and/or a list of URLs into plain text the planner and (in Stage 2) the
// research rounds can use, with zero search dependency. Reuses the app's
// existing file-text extraction (src/lib/files.ts) and web_fetch tool
// (src/lib/tools.ts) rather than adding new parsing/fetch code.

import { extractFileText } from "@/lib/files";
import { executeTool } from "@/lib/tools";

const URL_LINE_PATTERN = /^https?:\/\/\S+$/;
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

/** Heuristic: is this text basically just a list of URLs (one per line)? */
export function looksLikeUrlList(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  const urlLines = lines.filter((line) => URL_LINE_PATTERN.test(line));
  return urlLines.length / lines.length >= 0.8;
}

/** Pull every http(s) URL out of arbitrary text (also used by Stage 2 to find links inside a seed doc). */
export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  const cleaned = matches.map((url) => url.replace(/[.,;:!?)]+$/, ""));
  return Array.from(new Set(cleaned));
}

/** Fetches a URL via the app's existing web_fetch tool. Returns null (never throws) on failure — a bad URL degrades gracefully, it doesn't abort the seed pipeline. */
export async function fetchUrlContent(url: string): Promise<string | null> {
  const result = await executeTool({ id: crypto.randomUUID(), name: "web_fetch", arguments: JSON.stringify({ url }) });
  if (result.content.startsWith("Error:")) return null;
  return result.content;
}

export interface SeedFile {
  name: string;
  file: File;
}

export interface SeedResult {
  /** Concatenated, source-labeled text ready to hand to the planner (and, in Stage 2, the research rounds). */
  text: string;
  sourceCount: number;
  /** URLs actually fetched while building the seed (from a detected URL-list file or direct URLs) — the seed's "home" URLs, if it has any. */
  fetchedUrls: string[];
}

/**
 * Builds seed text from uploaded files and/or a directly-provided URL list.
 * A file whose content looks like a plain list of URLs is treated as a URL
 * list (each URL fetched) rather than literal grounding text — matches the
 * plan's "PDF, docx, txt/md, and a URL list" input shapes.
 */
export async function buildResearchSeed(files: SeedFile[] = [], directUrls: string[] = []): Promise<SeedResult> {
  const parts: string[] = [];
  const fetchedUrls: string[] = [];
  let sourceCount = 0;

  const addUrl = async (url: string) => {
    const content = await fetchUrlContent(url);
    sourceCount++;
    fetchedUrls.push(url);
    parts.push(content ? `--- ${url} ---\n${content}` : `--- ${url} ---\n[Could not fetch this URL]`);
  };

  for (const { name, file } of files) {
    const rawText = await extractFileText(file);
    if (!rawText) {
      parts.push(`--- ${name} ---\n[Could not extract content from this file]`);
      continue;
    }
    if (looksLikeUrlList(rawText)) {
      for (const url of extractUrlsFromText(rawText)) {
        await addUrl(url);
      }
    } else {
      sourceCount++;
      parts.push(`--- ${name} ---\n${rawText}`);
    }
  }

  for (const url of directUrls) {
    await addUrl(url);
  }

  return { text: parts.join("\n\n"), sourceCount, fetchedUrls };
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * The fetch-only expansion frontier (Stage 2): every URL mentioned anywhere in
 * the seed text, one hop out. If the seed has its own "home" URLs (it was
 * built from a URL list), the frontier is restricted to the same domain(s) —
 * don't wander off to an unrelated site just because the seed happened to
 * link to it. A pure-document seed (no home URLs) has no domain to restrict
 * to, so every link the document itself cites is fair game.
 */
export function computeExpansionFrontier(seed: SeedResult): string[] {
  const candidates = extractUrlsFromText(seed.text).filter((url) => !seed.fetchedUrls.includes(url));

  if (seed.fetchedUrls.length === 0) return candidates;

  const homeHosts = new Set(seed.fetchedUrls.map(hostnameOf).filter((host): host is string => !!host));
  return candidates.filter((url) => {
    const host = hostnameOf(url);
    return host !== null && homeHosts.has(host);
  });
}

export class NoResearchInputError extends Error {
  constructor() {
    super("Deep Research needs a topic, an uploaded document/URL list, or both.");
    this.name = "NoResearchInputError";
  }
}

/** Guard: a Deep Research run must have a typed topic, a seed, or both. */
export function validateResearchInput(topic: string | undefined, seed: string | undefined): void {
  if (!topic?.trim() && !seed?.trim()) {
    throw new NoResearchInputError();
  }
}
