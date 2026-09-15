// App-owned connector (MCP server) store. Replaces the opencode.json mcp
// section — the app no longer reads or writes opencode's config. Remote
// (HTTP/SSE) servers only: the deep agent connects from the webview, where
// stdio servers cannot run.

import { invoke } from "@tauri-apps/api/core";
import { parse as parseJsonc } from "jsonc-parser";
import { setItemOrThrowFriendly, trySetItem } from "./storage-pressure";

export interface McpServerEntry {
  type: "remote";
  url: string;
  enabled?: boolean;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  /**
   * Bring-your-own-OAuth-client credentials (Google Workspace connectors):
   * the user's own provider OAuth client, pasted in Settings → Connectors.
   * Used at sign-in instead of dynamic registration.
   */
  oauthClientId?: string;
  oauthClientSecret?: string;
  /** Set when the connector was added for one project's sessions. */
  projectDir?: string;
  addedAt: string;
}

const STORAGE_KEY = "chatui:mcp";
const MIGRATED_KEY = "chatui:mcp:migrated";

function readStore(): Record<string, McpServerEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, McpServerEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(entries: Record<string, McpServerEntry>): void {
  setItemOrThrowFriendly(STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new Event("chatui:mcp-changed"));
}

export function loadMcpServers(): Record<string, McpServerEntry> {
  return readStore();
}

export function saveMcpServer(name: string, entry: McpServerEntry): void {
  const entries = readStore();
  entries[name] = entry;
  writeStore(entries);
}

export function removeMcpServer(name: string): void {
  const entries = readStore();
  delete entries[name];
  writeStore(entries);
}

export function getMcpServer(name: string): McpServerEntry | undefined {
  return readStore()[name];
}

/** Entries visible to a run: enabled, global ones plus the active project's. */
export function visibleMcpServers(projectDir?: string | null): Record<string, McpServerEntry> {
  const out: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(readStore())) {
    if (entry.enabled === false) continue;
    if (entry.projectDir && entry.projectDir !== projectDir) continue;
    out[name] = entry;
  }
  return out;
}

export function isConnected(name: string): boolean {
  const entry = readStore()[name];
  return !!entry && entry.enabled !== false;
}

// ─── Connector usage tracking (MRU hot set) ────────────────────────────────
//
// Only the most recently used connected servers are connected eagerly at
// session start (native mcp__ tools with full schemas); everything else is
// reachable on demand through the list_mcp_tools / call_mcp_tool proxy
// tools. Usage is bumped whenever a connector's tools actually run.

const USAGE_KEY = "chatui:mcp:usage";

/** Note that a connector's tools just ran — feeds the eager hot set. */
export function touchMcpUsage(name: string): void {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    const usage = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    usage[name] = Date.now();
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    // ignore quota errors
  }
}

export function readMcpUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * The "hot set": up to `limit` visible servers ordered by most recent use
 * (unused ones keep their store order). These get native mcp__ tools.
 */
export function hotSetMcpServers(
  projectDir?: string | null,
  limit = 3,
): string[] {
  const usage = readMcpUsage();
  return Object.entries(visibleMcpServers(projectDir))
    .map(([name], i) => ({ name, last: usage[name] ?? 0, order: i }))
    .sort((a, b) => b.last - a.last || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map((s) => s.name);
}

async function readLegacyConfig(directory: string | null): Promise<Record<string, unknown>> {
  try {
    const path = await invoke<string>("get_opencode_config_path", { directory });
    const exists = await invoke<boolean>("path_exists", { path });
    if (!exists) return {};
    const content = await invoke<string>("read_text_file", { path });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (parseJsonc(content, [], { allowTrailingComma: true }) ?? {}) as any;
  } catch {
    return {};
  }
}

function importRemoteEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>,
  projectDir: string | undefined,
): number {
  let imported = 0;
  const entries = readStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const [name, raw] of Object.entries((config.mcp ?? {}) as Record<string, any>)) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.type !== "remote" || typeof raw.url !== "string") continue;
    if (entries[name]) continue;
    entries[name] = {
      type: "remote",
      url: raw.url,
      enabled: raw.enabled !== false,
      ...(raw.headers && typeof raw.headers === "object"
        ? { headers: raw.headers }
        : {}),
      ...(projectDir ? { projectDir } : {}),
      addedAt: new Date().toISOString(),
    };
    imported += 1;
  }
  if (imported > 0) writeStore(entries);
  return imported;
}

/**
 * One-time import of connectors the app used to keep in opencode.json
 * (global file plus each project's). Runs once; the original files stay
 * untouched.
 */
export async function ensureMcpMigrated(): Promise<void> {
  if (localStorage.getItem(MIGRATED_KEY)) return;
  try {
    // Best-effort: when the flag can't persist the migration just reruns.
    trySetItem(MIGRATED_KEY, "1");
    if (!("__TAURI_INTERNALS__" in window)) return;
    importRemoteEntries(await readLegacyConfig(null), undefined);
    try {
      const projects = JSON.parse(
        localStorage.getItem("chatui:projects") ?? "[]",
      ) as Array<{ directory?: string | null }>;
      for (const project of projects) {
        if (typeof project?.directory === "string" && project.directory.trim()) {
          await importRemoteEntries(await readLegacyConfig(project.directory), project.directory);
        }
      }
    } catch {
      // project scan is best-effort
    }
  } catch {
    // a failed migration just starts from an empty store
  }
}
