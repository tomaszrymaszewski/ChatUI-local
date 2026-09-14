// CORS-free web fetching. The webview's own fetch() is blocked by CORS for
// most websites (and DuckDuckGo's HTML search), so under Tauri the request is
// routed through the Rust shell's http_fetch command (src-tauri/src/lib.rs),
// and in vite dev through the dev-server middleware (vite.config.ts). Only a
// non-dev, non-Tauri browser (e.g. `vite preview`) falls back to native fetch,
// which keeps CORS restrictions.
//
// Plain-HTTP fetching increasingly hits bot challenges (search-engine
// interstitials, JS-gated pages), so search and web_fetch prefer the Rust
// shell's browser_fetch command: the user's installed headless Chrome
// (Chromium / Brave / Edge when Chrome is absent) renders the page's JS and
// returns the post-JS DOM. Same result shape as httpFetch.

import { invoke } from "@tauri-apps/api/core";

export interface HttpFetchResult {
  status: number;
  statusText: string;
  contentType: string;
  body: string;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Renders a URL in the user's installed headless Chrome (Chromium / Brave /
 * Edge fallback, resolved by the Rust shell) and returns the post-JS DOM.
 * Only available under Tauri — throws anywhere else so callers can fall back
 * to httpFetch. Throws when no browser is installed.
 */
export async function browserFetch(url: string, timeoutMs = 30000): Promise<HttpFetchResult> {
  if (!isTauri) {
    throw new Error("headless browser fetch is only available in the desktop app");
  }
  return invoke<HttpFetchResult>("browser_fetch", { url, timeoutMs });
}

/** True when a fetched body looks like a bot challenge rather than content. */
export function looksBlocked(status: number, body: string): boolean {
  if (status === 202 || status === 403 || status === 429) return true;
  if (!body || body.trim().length === 0) return true;
  const lower = body.toLowerCase();
  return (
    lower.includes("anomaly-modal") ||
    lower.includes("challenge-platform") ||
    lower.includes("cf-challenge") ||
    lower.includes("enable javascript to see") ||
    (lower.includes("captcha") && lower.includes("are you a human"))
  );
}

/** Strip tags/scripts/chrome from an HTML page down to readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Fetch a URL as agent-readable text. Plain HTTP first; when it is blocked,
 * challenged, or throws, the page is re-rendered in the user's headless
 * Chrome (browser_fetch), which executes the page JS like a real visit.
 * Never throws — failures come back as an "Error: …" string for the model.
 */
export async function fetchPageText(url: string, maxChars = 8000): Promise<string> {
  const viaBrowser = async (plainError: string): Promise<string> => {
    try {
      const rendered = await browserFetch(url);
      if (rendered.body.trim().length === 0) {
        return `Error: Fetch failed (${plainError}) and the browser fallback returned an empty page.`;
      }
      return htmlToText(rendered.body).slice(0, maxChars);
    } catch (browserErr) {
      return `Error: Fetch failed (${plainError}). Browser fallback also failed: ${errMsg(browserErr)}`;
    }
  };

  try {
    const resp = await httpFetch(url);
    const blocked = resp.status < 200 || resp.status >= 300 || looksBlocked(resp.status, resp.body);
    if (!blocked) {
      const text = resp.contentType.includes("text/html") ? htmlToText(resp.body) : resp.body;
      return text.slice(0, maxChars);
    }
    return viaBrowser(`HTTP ${resp.status} ${resp.statusText}`.trim());
  } catch (err) {
    return viaBrowser(`network error: ${errMsg(err)}`);
  }
}

/** Fetches a URL and returns status + content-type + body text. Throws on network-level failure. */
export async function httpFetch(url: string, timeoutMs = 15000): Promise<HttpFetchResult> {
  if (isTauri) {
    return invoke<HttpFetchResult>("http_fetch", { url, timeoutMs });
  }
  // vite dev middleware (skipped under vitest — no dev server, tests stub fetch).
  if (import.meta.env.DEV && import.meta.env.MODE !== "test") {
    const resp = await fetch(
      `/__http-fetch?url=${encodeURIComponent(url)}&timeoutMs=${timeoutMs}`,
      { signal: AbortSignal.timeout(timeoutMs + 5000) },
    );
    if (!resp.ok) {
      throw new Error((await resp.text()) || resp.statusText);
    }
    return (await resp.json()) as HttpFetchResult;
  }
  try {
    const resp = await fetch(url, {
      headers: { Accept: "text/html, text/plain, */*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      status: resp.status,
      statusText: resp.statusText,
      contentType: resp.headers.get("content-type") ?? "",
      body: await resp.text(),
    };
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(
        `${err.message} (browser blocked this cross-origin request; the desktop app and vite dev proxy fetch CORS-free)`,
      );
    }
    throw err;
  }
}
