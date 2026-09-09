// CORS-free client for the local Headroom proxy (context compression).
//
// Headroom is a small local proxy (`pip install "headroom-ai[proxy]"` + `headroom
// proxy --port 8787`) that compresses chat messages — tool outputs, logs, JSON,
// history — before they reach the LLM. The npm `headroom-ai` SDK is just an HTTP
// client for the same proxy, but it hardcodes global fetch(), which the webview's
// tauri://localhost origin loses to CORS. So we talk to the proxy directly:
// under Tauri via the Rust `http_post_json` command (CORS-free), and in browser
// dev via native fetch (the proxy's default CORS allows http://localhost:*).
//
// A down or slow proxy must never stall a run, so compression is non-fatal:
// on any failure the caller gets the input back unchanged and the proxy is
// marked unavailable for a cooldown window (circuit breaker).

import { invoke } from "@tauri-apps/api/core";

export const HEADROOM_URL = "http://localhost:8787";

export interface HeadroomCompressResult {
  /* Compressed messages in the same format as the input. */
  messages: unknown[];
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  compressionRatio: number;
  /** false = passthrough (proxy unreachable or compression made nothing). */
  compressed: boolean;
}

export interface HeadroomStatus {
  installed: boolean;
  serving: boolean;
  url: string;
}

// Evaluated lazily so it reflects the environment at call time (and so tests
// can simulate either side by stubbing `window`).
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Circuit breaker: once the proxy proves unreachable, skip calls for a cooldown
// so a down proxy never stalls every tool result waiting on a timeout.
let unavailableUntil = 0;
const UNAVAILABLE_WINDOW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface WireResponse {
  status: number;
  body: string;
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<WireResponse> {
  if (inTauri()) {
    const resp = await invoke<{ status: number; body: string }>("http_post_json", {
      url,
      body: JSON.stringify(body),
      timeoutMs,
    });
    return { status: resp.status, body: resp.body };
  }
  // Browser dev / fallback. The proxy's CORS allow_origin_regex covers
  // http://localhost:* (the vite dev origin), so this works without config.
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: resp.status, body: await resp.text() };
}

/** Whether a compress call is worth attempting right now (breaker closed). */
export function headroomAvailable(): boolean {
  return Date.now() >= unavailableUntil;
}

function markUnavailable() {
  unavailableUntil = Date.now() + UNAVAILABLE_WINDOW_MS;
}

/** @internal Test seam: clear the circuit-breaker cooldown. */
export function __resetBreakerForTests(): void {
  unavailableUntil = 0;
}

function passthrough(messages: unknown[]): HeadroomCompressResult {
  return {
    messages,
    tokensBefore: 0,
    tokensAfter: 0,
    tokensSaved: 0,
    compressionRatio: 0,
    compressed: false,
  };
}

/**
 * Compress an OpenAI-style chat message array against the local proxy. Returns
 * the (possibly unchanged) messages plus token accounting. Never throws for a
 * broken proxy — that path returns `compressed: false`.
 */
export async function compressMessages(
  messages: unknown[],
  model: string,
): Promise<HeadroomCompressResult> {
  if (!headroomAvailable() || messages.length === 0) return passthrough(messages);
  try {
    const { status, body } = await postJson(
      `${HEADROOM_URL}/v1/compress`,
      { messages, model },
      REQUEST_TIMEOUT_MS,
    );
    if (status >= 400) {
      markUnavailable();
      return passthrough(messages);
    }
    const data = (await JSON.parse(body)) as Record<string, unknown>;
    // The proxy returns snake_case (the npm SDK maps it to camelCase). Accept
    // either defensively so a proxy version bump can't silently break us.
    const num =
      (k: string) =>
      (data[k] as number) ?? (data[camel(k)] as number) ?? 0;
    const out = (data.messages as unknown[]) ?? messages;
    // The proxy answered — heal the breaker even if this payload compressed
    // nothing, so a transient blip doesn't keep compression off.
    unavailableUntil = 0;
    return {
      messages: out,
      tokensBefore: num("tokens_before"),
      tokensAfter: num("tokens_after"),
      tokensSaved: num("tokens_saved"),
      compressionRatio: num("compression_ratio"),
      compressed: (data.compressed as boolean) ?? false,
    };
  } catch {
    markUnavailable();
    return passthrough(messages);
  }
}

function camel(k: string): string {
  return k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Report whether the proxy is installed/serving, adopting it if running. */
export async function headroomStatus(): Promise<HeadroomStatus> {
  if (inTauri()) {
    try {
      return await invoke<HeadroomStatus>("headroom_status");
    } catch {
      return { installed: false, serving: false, url: HEADROOM_URL };
    }
  }
  // Browser dev has no Rust lifecycle; report the proxy as ready so the client
  // probes it. A down proxy just silently disables compression.
  return { installed: true, serving: true, url: HEADROOM_URL };
}

/** Ensure the proxy is running (no-op in browser dev). Returns an error string when it can't start. */
export async function headroomStart(): Promise<string | null> {
  if (!inTauri()) return null;
  try {
    await invoke("headroom_start");
    return null;
  } catch (err) {
    return typeof err === "string" ? err : String(err);
  }
}

/** Stop the proxy we spawned (adopting the opencode lifecycle). */
export async function headroomStop(): Promise<void> {
  if (!inTauri()) return;
  try {
    await invoke("headroom_stop");
  } catch {
    // Best effort on shutdown.
  }
}
