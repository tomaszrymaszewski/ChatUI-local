import { invoke } from "@tauri-apps/api/core";

/**
 * Access to the app's MCP OAuth token store
 * (~/Documents/chatUI/mcp/auth.json, migrated once from opencode's old
 * shared store). The native browser flow — started with beginMcpOauth —
 * writes tokens here; the langchain agent's own MCP connections (see
 * src/lib/agent/mcp.ts) read them back so connectors work without any
 * external tooling. Refresh of expired tokens happens in Rust
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

/**
 * Start a native OAuth sign-in for an MCP server: resolves the authorize URL
 * (the Rust side registers a client, generates PKCE, and binds the callback
 * listener) and returns it — open it in the browser. Completion is observed
 * by polling readMcpAuth.
 */
export async function beginMcpOauth(name: string, serverUrl: string): Promise<string> {
  return invoke<string>("mcp_oauth_begin", { name, serverUrl });
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
