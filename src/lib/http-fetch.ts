// CORS-free web fetching. The webview's own fetch() is blocked by CORS for
// most websites (and DuckDuckGo's HTML search), so under Tauri the request is
// routed through the Rust shell's http_fetch command (src-tauri/src/lib.rs),
// and in vite dev through the dev-server middleware (vite.config.ts). Only a
// non-dev, non-Tauri browser (e.g. `vite preview`) falls back to native fetch,
// which keeps CORS restrictions.

import { invoke } from "@tauri-apps/api/core";

export interface HttpFetchResult {
  status: number;
  statusText: string;
  contentType: string;
  body: string;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
