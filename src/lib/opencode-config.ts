import { invoke } from "@tauri-apps/api/core";
import { parse as parseJsonc } from "jsonc-parser";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpencodeConfig = Record<string, any>;

export interface McpEntry {
  type?: "local" | "remote";
  command?: string[];
  url?: string;
  enabled?: boolean;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oauth?: any;
  [key: string]: unknown;
}

export interface LspEntry {
  command?: string[];
  extensions?: string[];
  disabled?: boolean;
  env?: Record<string, string>;
  [key: string]: unknown;
}

export async function getConfigPath(directory?: string | null): Promise<string> {
  return invoke<string>("get_opencode_config_path", { directory: directory ?? null });
}

export async function readOpencodeConfig(directory?: string | null): Promise<OpencodeConfig> {
  try {
    const path = await getConfigPath(directory);
    const exists = await invoke<boolean>("path_exists", { path });
    if (!exists) return {};
    const content = await invoke<string>("read_text_file", { path });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors: any[] = [];
    const config = parseJsonc(content, errors, { allowTrailingComma: true }) as OpencodeConfig;
    return config ?? {};
  } catch {
    return {};
  }
}

export async function writeOpencodeConfig(config: OpencodeConfig, directory?: string | null): Promise<void> {
  const path = await getConfigPath(directory);
  const content = JSON.stringify(config, null, 2);
  await invoke("write_text_file", { path, content });
}

export function getMcpEntries(config: OpencodeConfig): Record<string, McpEntry> {
  return (config.mcp ?? {}) as Record<string, McpEntry>;
}

export async function setMcpEntry(directory: string | null | undefined, name: string, entry: McpEntry): Promise<OpencodeConfig> {
  const config = await readOpencodeConfig(directory);
  if (!config.mcp) config.mcp = {};
  config.mcp[name] = entry;
  await writeOpencodeConfig(config, directory);
  return config;
}

export async function removeMcpEntry(directory: string | null | undefined, name: string): Promise<void> {
  const config = await readOpencodeConfig(directory);
  if (config.mcp) {
    delete config.mcp[name];
    await writeOpencodeConfig(config, directory);
  }
}

export function getLspEntries(config: OpencodeConfig): Record<string, LspEntry> {
  const lsp = config.lsp;
  if (!lsp || lsp === false) return {};
  return lsp as Record<string, LspEntry>;
}

export async function setLspEntry(directory: string | null | undefined, name: string, entry: LspEntry): Promise<void> {
  const config = await readOpencodeConfig(directory);
  if (!config.lsp || config.lsp === false) config.lsp = {};
  config.lsp[name] = entry;
  await writeOpencodeConfig(config, directory);
}

export async function removeLspEntry(directory: string | null | undefined, name: string): Promise<void> {
  const config = await readOpencodeConfig(directory);
  if (config.lsp && config.lsp !== false) {
    delete config.lsp[name];
    await writeOpencodeConfig(config, directory);
  }
}

/**
 * Enable OpenCode's built-in LSP servers (for ~30 languages) by setting
 * `lsp: {}` in the config. OpenCode ships these built-ins but leaves LSP
 * disabled by default. We turn it on automatically so language diagnostics
 * work with zero setup. No-op if the user has explicitly set `lsp: false`.
 */
export async function ensureLspEnabled(directory: string | null | undefined): Promise<void> {
  try {
    const config = await readOpencodeConfig(directory);
    if (config.lsp === false) return; // respect an explicit opt-out
    if (config.lsp === undefined || config.lsp === null) {
      config.lsp = {};
      await writeOpencodeConfig(config, directory);
    }
  } catch {
    // ignore — LSP is a nice-to-have, not a hard requirement
  }
}
