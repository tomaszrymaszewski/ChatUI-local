// Keyless search bootstrap for a bare-topic Deep Research run — no API key,
// no account. Fetches DuckDuckGo's HTML-only search endpoint (works without
// JS) and pulls the actual destination URLs out of its redirect links.
//
// This is NOT a general search API and has no SLA: it depends on DuckDuckGo's
// current HTML markup, which could change and break the parsing. That's why
// it's isolated here as its own small module with a pure, independently
// testable parser (extractDuckDuckGoResultUrls) — if DDG's markup changes,
// the fix is contained to this one file. The failure mode is graceful: an
// empty array, never a thrown error, so a caller can fall back to "couldn't
// find a starting point" rather than crash the whole run.
//
// Deliberately does its own raw fetch() rather than going through the
// existing web_fetch tool (src/lib/tools.ts) — that tool strips all HTML
// tags before returning content, which would strip out exactly the href
// values this needs.

const DUCKDUCKGO_HTML_SEARCH_URL = "https://html.duckduckgo.com/html/";

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

export async function keylessWebSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<string[]> {
  const url = `${DUCKDUCKGO_HTML_SEARCH_URL}?q=${encodeURIComponent(query)}`;

  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DeepResearchBot/1.0)",
        Accept: "text/html",
      },
      signal: signal ?? AbortSignal.timeout(15000),
    });
    if (!response.ok) return [];
    html = await response.text();
  } catch {
    return [];
  }

  return extractDuckDuckGoResultUrls(html, maxResults);
}
