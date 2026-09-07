// App-owned connector (MCP server) store. Replaces the opencode.json mcp
// section — the app no longer reads or writes opencode's config. Remote
// (HTTP/SSE) servers only: the deep agent connects from the webview, where
// stdio servers cannot run.

import { invoke } from "@tauri-apps/api/core";
import { parse as parseJsonc } from "jsonc-parser";

export interface McpServerEntry {
  type: "remote";
  url: string;
  enabled?: boolean;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
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
  localStorage.setItem(MIGRATED_KEY, "1");
  try {
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
