// Keyless search bootstrap for a bare-topic Deep Research run — no API key,
// no account. Two engines are tried in order, both via httpFetch (the Rust
// shell under Tauri — a webview fetch() is CORS-blocked and these endpoints
// send no Access-Control-Allow-Origin):
//
//   1. Bing's RSS endpoint (?format=rss) — returns clean XML and, as of
//      writing, does NOT bot-challenge the Rust fetcher. Primary.
//   2. DuckDuckGo's HTML-only endpoint — kept as a fallback, but it now
//      intermittently answers with a 202 "anomaly" interstitial instead of
//      results, so it is no longer the primary.
//
// This is NOT a general search API and has no SLA: it depends on each
// engine's current response shape, which could change and break the parsing.
// That's why each engine has its own pure, independently testable parser
// (extractBingRssResultUrls / extractDuckDuckGoResultUrls) — if a markup
// changes, the fix is contained to this one file. The failure mode is
// graceful: an empty array, never a thrown error, so a caller can fall back
// to "couldn't find a starting point" rather than crash the whole run.
//
// Deliberately fetches the raw markup itself rather than going through the
// existing web_fetch tool (src/lib/tools.ts) — that tool strips all HTML
// tags before returning content, which would strip out exactly the link
// values this needs.

import { httpFetch } from "@/lib/http-fetch";

const BING_RSS_SEARCH_URL = "https://www.bing.com/search";
const DUCKDUCKGO_HTML_SEARCH_URL = "https://html.duckduckgo.com/html/";

/** Pull result URLs out of Bing's RSS (`?format=rss`) response. Only links inside `<item>` blocks count — the channel-level `<link>` is the search page itself. */
export function extractBingRssResultUrls(xml: string, maxResults: number): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const linkMatch = item[1].match(/<link>([\s\S]*?)<\/link>/);
    if (!linkMatch) continue;
    // Some feeds wrap the URL in CDATA; tolerate it.
    const url = linkMatch[1]
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .trim();
    if (!url.startsWith("http")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= maxResults) break;
  }

  return urls;
}

export function extractDuckDuckGoResultUrls(html: string, maxResults: number): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/uddg=([^&"]+)/g)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(match[1]);
    } catch {
      continue;
    }
    if (!decoded.startsWith("http")) continue;
    if (seen.has(decoded)) continue;
    seen.add(decoded);
    urls.push(decoded);
    if (urls.length >= maxResults) break;
  }

  return urls;
}

async function fetchAndParse(
  url: string,
  parse: (body: string, maxResults: number) => string[],
  maxResults: number,
): Promise<string[]> {
  let body: string;
  try {
    const response = await httpFetch(url);
    if (response.status < 200 || response.status >= 300) return [];
    body = response.body;
  } catch {
    return [];
  }

  return parse(body, maxResults);
}

export async function keylessWebSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<string[]> {
  if (signal?.aborted) return [];
  const encoded = encodeURIComponent(query);

  // Primary: Bing RSS.
  const bingUrls = await fetchAndParse(
    `${BING_RSS_SEARCH_URL}?q=${encoded}&format=rss`,
    extractBingRssResultUrls,
    maxResults,
  );
  if (signal?.aborted) return [];
  if (bingUrls.length > 0) return bingUrls;

  // Fallback: DuckDuckGo HTML.
  return fetchAndParse(
    `${DUCKDUCKGO_HTML_SEARCH_URL}?q=${encoded}`,
    extractDuckDuckGoResultUrls,
    maxResults,
  );
}
