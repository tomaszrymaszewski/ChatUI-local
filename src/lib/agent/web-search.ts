// Keyless + optional-Tavily web search for the agent's `web_search` tool.
//
// Backends tried in order:
//   1. Tavily Search API — when a key is configured (Settings → General).
//   2. Bing RSS endpoint (?format=rss) — clean XML, generally not bot-blocked
//      when fetched through the Rust shell's real-UA http_fetch.
//   3. DuckDuckGo HTML endpoint — fallback; intermittently returns a 202
//      "anomaly" interstitial, hence not primary.
//
// Each backend has its own pure, independently testable parser. The failure
// mode is graceful: an empty array, never a thrown error, so the caller can
// try the next backend or report "no results" instead of crashing.

import { httpFetch } from "@/lib/http-fetch";
import { getTavilyApiKey } from "@/lib/llm";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BING_RSS_SEARCH_URL = "https://www.bing.com/search";
const DUCKDUCKGO_HTML_SEARCH_URL = "https://html.duckduckgo.com/html/";
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

// ─── Bing RSS parser ──────────────────────────────────────────────────────

/** Extract result items (title, url, snippet) from Bing's RSS (`?format=rss`) response. */
export function extractBingRssResults(xml: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = item[1];
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    if (!linkMatch) continue;
    const url = linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (!url.startsWith("http") || seen.has(url)) continue;

    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    const title = (titleMatch?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const snippet = (descMatch?.[1] ?? "")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    seen.add(url);
    results.push({ title: title || url, url, snippet: snippet.slice(0, 300) });
    if (results.length >= maxResults) break;
  }

  return results;
}

// ─── DuckDuckGo HTML parser ───────────────────────────────────────────────

/** Extract result items from DuckDuckGo's HTML endpoint via `uddg=` redirect links. */
export function extractDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // DDG wraps results in `<a class="result__a" href="//duckduckgo.com/l/?uddg=<url>">Title</a>`.
  // We match the anchor to get both the URL and the title text.
  for (const match of html.matchAll(
    /<a[^>]*class="result__a"[^>]*href="[^"]*uddg=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
  )) {
    let url: string;
    try {
      url = decodeURIComponent(match[1]);
    } catch {
      continue;
    }
    if (!url.startsWith("http") || seen.has(url)) continue;

    const title = match[2].replace(/<[^>]+>/g, "").trim();
    seen.add(url);
    results.push({ title: title || url, url, snippet: "" });
    if (results.length >= maxResults) break;
  }

  // Fallback: if the class-based regex misses, try raw uddg extraction.
  if (results.length === 0) {
    for (const match of html.matchAll(/uddg=([^&"]+)/g)) {
      let url: string;
      try {
        url = decodeURIComponent(match[1]);
      } catch {
        continue;
      }
      if (!url.startsWith("http") || seen.has(url)) continue;
      seen.add(url);
      results.push({ title: url, url, snippet: "" });
      if (results.length >= maxResults) break;
    }
  }

  return results;
}

// ─── Tavily search ─────────────────────────────────────────────────────────

async function tavilySearch(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const key = getTavilyApiKey();
  if (!key) return [];

  try {
    const resp = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query, max_results: maxResults, topic: "general" }),
      signal,
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      results?: Array<{ url: string; title: string; content?: string }>;
    };
    return (data.results ?? []).map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: (r.content ?? "").slice(0, 300),
    }));
  } catch {
    return [];
  }
}

// ─── Fetch-and-parse helper ────────────────────────────────────────────────

async function fetchAndParse(
  url: string,
  parse: (body: string, maxResults: number) => SearchResult[],
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  let body: string;
  try {
    const response = await httpFetch(url);
    if (response.status < 200 || response.status >= 300) return [];
    body = response.body;
  } catch {
    return [];
  }
  if (signal?.aborted) return [];
  return parse(body, maxResults);
}

// ─── Public entry point ────────────────────────────────────────────────────

export async function webSearch(
  query: string,
  maxResults = 5,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (signal?.aborted) return [];
  const encoded = encodeURIComponent(query);

  // 1. Tavily (if configured).
  const tavily = await tavilySearch(query, maxResults, signal);
  if (signal?.aborted) return [];
  if (tavily.length > 0) return tavily;

  // 2. Bing RSS (primary keyless).
  const bing = await fetchAndParse(
    `${BING_RSS_SEARCH_URL}?q=${encoded}&format=rss`,
    extractBingRssResults,
    maxResults,
    signal,
  );
  if (signal?.aborted) return [];
  if (bing.length > 0) return bing;

  // 3. DuckDuckGo HTML (fallback).
  return fetchAndParse(
    `${DUCKDUCKGO_HTML_SEARCH_URL}?q=${encoded}`,
    extractDuckDuckGoResults,
    maxResults,
    signal,
  );
}
