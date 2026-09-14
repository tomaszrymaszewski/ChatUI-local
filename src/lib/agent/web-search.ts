// Keyless + optional-Tavily web search for the agent's `web_search` tool.
//
// Backends tried in order:
//   1. Tavily Search API — when a key is configured (Settings → General).
//   2. DuckDuckGo HTML endpoint, rendered in the user's headless Chrome via
//      the Rust shell's browser_fetch — a real browser engine executes the
//      page JS and sails past the bot interstitials that block plain HTTP.
//   3. Bing HTML endpoint, same headless-Chrome rendering.
//   4. Bing RSS endpoint (?format=rss) via plain http_fetch — clean XML when
//      it isn't bot-blocked.
//   5. DuckDuckGo HTML endpoint via plain http_fetch — last resort;
//      intermittently returns a 202 "anomaly" interstitial.
//
// Each backend has its own pure, independently testable parser. The failure
// mode is graceful: an empty array, never a thrown error, so the caller can
// try the next backend or report "no results" instead of crashing.

import { browserFetch, httpFetch, looksBlocked } from "@/lib/http-fetch";
import { getTavilyApiKey } from "@/lib/llm";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BING_RSS_SEARCH_URL = "https://www.bing.com/search";
const DUCKDUCKGO_HTML_SEARCH_URL = "https://html.duckduckgo.com/html/";
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

// ─── Market-pinned search URLs ────────────────────────────────────────────
//
// Without an explicit market, both keyless backends localize results to the
// requester's IP region — mixed-language and "nearby" noise for English
// queries. Pinning the market keeps results stable regardless of network.

/** Bing RSS search URL pinned to the en-US market. */
export function bingRssUrl(query: string): string {
  return `${BING_RSS_SEARCH_URL}?q=${encodeURIComponent(query)}&format=rss&mkt=en-US&setlang=en&cc=US`;
}

/** DuckDuckGo HTML search URL with the region set to "no region" (`wt-wt`). */
export function ddgHtmlUrl(query: string): string {
  return `${DUCKDUCKGO_HTML_SEARCH_URL}?q=${encodeURIComponent(query)}&kl=wt-wt`;
}

/** Bing HTML search URL pinned to the en-US market. */
export function bingHtmlUrl(query: string): string {
  return `${BING_RSS_SEARCH_URL}?q=${encodeURIComponent(query)}&mkt=en-US&setlang=en&cc=US`;
}

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

// ─── Bing HTML parser ─────────────────────────────────────────────────────

/**
 * Unwrap Bing's `/ck/a` redirect links (`?u=<base64 target>`) to the real
 * result URL. Absolute non-Bing URLs pass through; an unwrappable redirect
 * yields "" so the caller skips it instead of handing the model a bing.com
 * tracking link.
 */
export function unwrapBingRedirect(href: string): string {
  try {
    const parsed = new URL(href);
    if (parsed.hostname.endsWith("bing.com") && parsed.pathname === "/ck/a") {
      const encoded = parsed.searchParams.get("u") ?? "";
      for (const candidate of [encoded, encoded.slice(2)]) {
        try {
          const decoded = atob(candidate).trim();
          if (!decoded.startsWith("http")) continue;
          try {
            return decodeURIComponent(decoded);
          } catch {
            return decoded;
          }
        } catch {
          // try the next candidate shape
        }
      }
      return "";
    }
  } catch {
    // Not an absolute URL — return it for the caller to reject.
  }
  return href;
}

/**
 * Extract result items from Bing's HTML results page. Organic results live in
 * `<li class="b_algo">` blocks whose `<h2>` heading anchor carries the target
 * URL (usually a `/ck/a` redirect — see unwrapBingRedirect); the first `<p>`
 * in the block is the snippet. The favicon anchor earlier in the block is
 * deliberately ignored by scoping to `<h2>`. Works on both the raw page and
 * a headless-Chrome `--dump-dom` serialization of it.
 */
export function extractBingHtmlResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const item of html.matchAll(/<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/g)) {
    const block = item[1];
    const h2Match = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/);
    const linkMatch =
      h2Match ?? block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    let url = linkMatch[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    try {
      url = decodeURIComponent(url);
    } catch {
      // keep the raw URL
    }
    url = unwrapBingRedirect(url);
    if (!url.startsWith("http") || seen.has(url)) continue;

    const title = linkMatch[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = (snippetMatch?.[1] ?? "")
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

// ─── Headless-browser fetch-and-parse helper ───────────────────────────────

async function fetchViaBrowser(
  url: string,
  parse: (body: string, maxResults: number) => SearchResult[],
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  let body: string;
  try {
    const response = await browserFetch(url);
    body = response.body;
    if (looksBlocked(response.status, body)) return [];
  } catch {
    // No desktop shell / no browser installed — the plain-HTTP backends below
    // still get their chance.
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

  // 1. Tavily (if configured).
  const tavily = await tavilySearch(query, maxResults, signal);
  if (signal?.aborted) return [];
  if (tavily.length > 0) return tavily;

  // 2. DuckDuckGo HTML rendered in headless Chrome.
  const ddgBrowser = await fetchViaBrowser(ddgHtmlUrl(query), extractDuckDuckGoResults, maxResults, signal);
  if (signal?.aborted) return [];
  if (ddgBrowser.length > 0) return ddgBrowser;

  // 3. Bing HTML rendered in headless Chrome.
  const bingBrowser = await fetchViaBrowser(bingHtmlUrl(query), extractBingHtmlResults, maxResults, signal);
  if (signal?.aborted) return [];
  if (bingBrowser.length > 0) return bingBrowser;

  // 4. Bing RSS over plain HTTP (primary keyless before the browser existed).
  const bing = await fetchAndParse(bingRssUrl(query), extractBingRssResults, maxResults, signal);
  if (signal?.aborted) return [];
  if (bing.length > 0) return bing;

  // 5. DuckDuckGo HTML over plain HTTP (last resort).
  return fetchAndParse(ddgHtmlUrl(query), extractDuckDuckGoResults, maxResults, signal);
}
