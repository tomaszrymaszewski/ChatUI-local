import { invoke } from "@tauri-apps/api/core";

/**
 * Read access to opencode's MCP OAuth token store
 * (~/.local/share/opencode/mcp-auth.json). The `opencode mcp auth` browser
 * flow writes tokens here; the langchain agent's own MCP connections (see
 * src/lib/agent/mcp.ts) read them back so connectors work without a running
 * opencode server. Refresh of expired tokens happens in Rust
 * (`refresh_mcp_token`) because token endpoints rarely send CORS headers.
 */

export interface McpAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch seconds. */
  expiresAt?: number;
  scope?: string;
}

export interface McpAuthEntry {
  tokens?: McpAuthTokens;
  clientInfo?: {
    clientId: string;
    clientSecret?: string;
    clientIdIssuedAt?: number;
    clientSecretExpiresAt?: number;
  };
  codeVerifier?: string;
  oauthState?: string;
  serverUrl?: string;
}

export type McpAuthData = Record<string, McpAuthEntry>;

export async function readMcpAuth(): Promise<McpAuthData> {
  try {
    const raw = await invoke<string>("read_mcp_auth");
    if (!raw) return {};
    return JSON.parse(raw) as McpAuthData;
  } catch {
    return {};
  }
}

export function hasToken(data: McpAuthData, name: string): boolean {
  return !!data[name]?.tokens?.accessToken;
}

/**
 * A usable access token for the named MCP server: the stored one when still
 * valid, a refreshed one (via the Rust command) when expired but refreshable,
 * otherwise null (the server needs a fresh sign-in).
 */
export async function getAccessToken(name: string): Promise<string | null> {
  const data = await readMcpAuth();
  const entry = data[name];
  if (!entry?.tokens?.accessToken) return null;
  const { accessToken, refreshToken, expiresAt } = entry.tokens;
  // 60s skew so a token that expires mid-connect gets refreshed up front.
  if (!expiresAt || expiresAt > Date.now() / 1000 + 60) return accessToken;
  if (!refreshToken) return null;
  try {
    return await invoke<string>("refresh_mcp_token", { name });
  } catch {
    return null;
  }
}
