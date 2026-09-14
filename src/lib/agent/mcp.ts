import { z } from "zod";
import { DynamicStructuredTool, type StructuredTool } from "langchain";
import { invoke } from "@tauri-apps/api/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { visibleMcpServers, hotSetMcpServers, touchMcpUsage, type McpServerEntry } from "@/lib/mcp-store";
import { getCatalogEntry } from "@/lib/mcp-catalog";
import { getAccessToken, isMcpAuthError } from "@/lib/mcp-auth";

/**
 * Follow-up instruction for the model when a connector call fails with
 * rejected credentials: surface a one-click re-connect card (the same card
 * as first-time connect — it re-runs the OAuth sign-in and overwrites the
 * stored tokens) and retry once the user connects.
 */
export function mcpAuthFailureHint(serverName: string): string {
  return (
    `The "${serverName}" sign-in looks expired or revoked. Call suggest with ` +
    `kind="connector" and target="${serverName}" to show the user a one-click ` +
    `re-connect card, then retry the call after they connect.`
  );
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

/** Response of the mcp_http_post Tauri command. */
interface McpProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Fetch implementation that routes requests through the Rust mcp_http_post
 * command (CORS-free — same trick as http_post_json for the headroom proxy).
 * Local MCP servers (the Playwright browser server) send no CORS headers, so
 * the webview's fetch() cannot reach them cross-origin. The Rust side
 * collects the full response body, which is fine for Streamable HTTP: a
 * POST's response stream (JSON or SSE) always terminates.
 */
export function corsFreeMcpFetch(): (url: string | URL, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    // The client probes GET /mcp for a server→client SSE stream; a POST-only
    // server answers 405 per spec and the SDK falls back to POST-only mode.
    if (method !== "POST" && method !== "DELETE") {
      return new Response(null, { status: 405 });
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const body = typeof init?.body === "string" ? init.body : "";
    const resp = await invoke<McpProxyResponse>("mcp_http_post", {
      url: String(url),
      body,
      headers,
      timeoutMs: 300_000,
    });
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  };
}

/**
 * Headers derived from a stored API key. API-key connectors (e.g. Exa) collect
 * the key into `environment` at add time, but the remote endpoint expects it
 * on the wire — the catalog's `apiKeyHeader` names the header (raw key),
 * defaulting to `Authorization` with a Bearer prefix.
 */
export function apiKeyHeadersForEntry(
  serverName: string,
  entry: McpServerEntry,
): Record<string, string> {
  const values = Object.values(entry.environment ?? {})
    .map((v) => v.trim())
    .filter(Boolean);
  if (values.length === 0) return {};
  const headerName = getCatalogEntry(serverName)?.apiKeyHeader ?? "Authorization";
  const value = values[0] as string;
  return {
    [headerName]:
      headerName.toLowerCase() === "authorization" && !/^\s*bearer\s/i.test(value)
        ? `Bearer ${value}`
        : value,
  };
}

async function connectClient(
  entry: McpServerEntry,
  headers: Record<string, string>,
  corsFree?: boolean,
): Promise<Client> {
  const client = new Client({ name: "chatui", version: "0.1.0" });
  const url = new URL(entry.url!);
  if (corsFree) {
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
        fetch: corsFreeMcpFetch(),
      }),
    );
    return client;
  }
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
    return client;
  } catch {
    await client.connect(new SSEClientTransport(url, { requestInit: { headers } }));
    return client;
  }
}

/**
 * Auth headers for one server: API-key entries put the collected key on the
 * wire (explicit entry headers win over the derived ones); OAuth servers
 * attach the token from the app's token store (written by the native browser
 * sign-in flow) unless the entry already carries auth.
 */
async function headersForEntry(
  serverName: string,
  entry: McpServerEntry,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    ...apiKeyHeadersForEntry(serverName, entry),
    ...(entry.headers ?? {}),
  };
  const hasAuthHeader = Object.keys(headers).some(
    (k) => k.toLowerCase() === "authorization" || k.toLowerCase() === "x-api-key",
  );
  if (!hasAuthHeader) {
    const token = await getAccessToken(serverName);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Connect one server (with the 10 s timeout race + sidecar warm-up). */
async function connectServer(serverName: string, entry: McpServerEntry): Promise<Client> {
  const corsFree = getCatalogEntry(serverName)?.corsFree === true;
  if (corsFree) {
    // Warm the local sidecar before connecting: an instant port probe
    // when it's already up, a real spawn (up to ~15s) on first use.
    await invoke("browser_mcp_start").catch(() => {});
  }
  const headers = await headersForEntry(serverName, entry);
  return Promise.race([
    connectClient(entry, headers, corsFree),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("MCP connect timeout")), 10000),
    ),
  ]);
}

/**
 * Load remote (HTTP/SSE) MCP servers from the connectors config and expose
 * their tools as LangChain tools for the chat agent. stdio servers cannot
 * run in the webview and are skipped (they stay agent-half only).
 * Best-effort: unreachable servers are silently skipped.
 *
 * Returns the tools plus a `dispose` function that closes the MCP clients
 * opened by this call. Each call tracks its own clients so concurrent runs
 * in different chats don't interfere with each other.
 */
export interface McpToolsResult {
  tools: StructuredTool[];
  dispose: () => Promise<void>;
}

export async function loadMcpTools(
  projectDir?: string | null,
  /** Restrict to these connector store keys (sandboxed agents). undefined = all enabled; [] = none. */
  allowedServers?: string[],
  /** How many eagerly-connected servers to allow (the MRU hot set). */
  hotSetLimit = 3,
): Promise<McpToolsResult> {
  const tools: StructuredTool[] = [];
  const clients: Client[] = [];
  const entries = visibleMcpServers(projectDir);
  // Only the most recently used servers connect eagerly (native mcp__ tools
  // with full JSON schemas — costly); the rest stay reachable through the
  // call_mcp_tool proxy, so a big connector library can't bloat the prompt
  // or stack connect timeouts onto every send.
  const hot = new Set(hotSetMcpServers(projectDir, hotSetLimit));

  for (const [serverName, entry] of Object.entries(entries)) {
    if (allowedServers && !allowedServers.includes(serverName)) continue;
    if (!hot.has(serverName)) continue;
    if (!entry.url || !/^https?:\/\//.test(entry.url)) continue;
    try {
      const client = await connectServer(serverName, entry);
      clients.push(client);
      const { tools: serverTools } = await client.listTools();
      for (const t of serverTools) {
        const toolName = `mcp__${sanitizeName(serverName)}__${sanitizeName(t.name)}`;
        const schemaHint = t.inputSchema
          ? `\n\nArgs JSON schema: ${JSON.stringify(t.inputSchema)}`
          : "";
        tools.push(
          new DynamicStructuredTool({
            name: toolName.slice(0, 64),
            description: `${t.description ?? t.name} (MCP: ${serverName})${schemaHint}`,
            schema: z.record(z.string(), z.unknown()),
            func: async (args) => {
              touchMcpUsage(serverName);
              try {
                const result = await client.callTool({ name: t.name, arguments: args });
                const content = (result.content as Array<{ type: string; text?: string }> | undefined) ?? [];
                const text = content
                  .filter((c) => c.type === "text" && typeof c.text === "string")
                  .map((c) => c.text)
                  .join("\n");
                return text.slice(0, 12000) || JSON.stringify(result).slice(0, 12000);
              } catch (err) {
                const hint = isMcpAuthError(err) ? ` ${mcpAuthFailureHint(serverName)}` : "";
                return `Error: MCP tool failed — ${err instanceof Error ? err.message : String(err)}.${hint}`;
              }
            },
          }),
        );
      }
    } catch {
      // unreachable / unsupported — skip this server
    }
  }
  return {
    tools,
    dispose: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}

export interface RemoteToolSummary {
  name: string;
  description: string;
}

/**
 * Best-effort tool listing for a remote MCP server — used by the knowledge
 * indexer so the vector DB carries detailed, tool-level connector
 * descriptions. Returns null when the server is unreachable or refuses
 * unauthenticated listing.
 */
export async function listRemoteToolSummaries(
  url: string,
  token: string | null,
  timeoutMs = 8000,
  extraHeaders: Record<string, string> = {},
): Promise<RemoteToolSummary[] | null> {
  const entry: McpServerEntry = { type: "remote", url, addedAt: "" };
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const client = await Promise.race([
      connectClient(entry, headers),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("MCP connect timeout")), timeoutMs),
      ),
    ]);
    try {
      const { tools } = await client.listTools();
      return tools
        .map((t) => ({
          name: t.name,
          description: (t.description ?? t.name).replace(/\s+/g, " ").trim(),
        }))
        .filter((t) => t.name);
    } finally {
      await client.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

// ─── On-demand MCP proxy (connect mid-run, use in the same run) ────────────

export interface McpProxy {
  tools: StructuredTool[];
  dispose: () => Promise<void>;
}

/**
 * Lazy proxy tools for the non-hot connectors: any visible (allowed) server
 * can be connected and used mid-run — including one the user just connected
 * from a suggestion card, which previously only worked from the next
 * message. Clients are cached per proxy instance (one per run) and closed on
 * dispose.
 */
export function createMcpProxy(
  projectDir?: string | null,
  /** Restrict to these connector store keys (sandboxed agents). undefined = all visible. */
  allowedServers?: string[],
): McpProxy {
  const clients = new Map<string, Promise<Client>>();

  const connect = (serverName: string): Promise<Client> => {
    const existing = clients.get(serverName);
    if (existing) return existing;
    const entry = visibleMcpServers(projectDir)[serverName];
    if (!entry?.url || !/^https?:\/\//.test(entry.url)) {
      return Promise.reject(new Error(`No remote MCP server "${serverName}" in the connector store`));
    }
    const pending = connectServer(serverName, entry).catch((err) => {
      clients.delete(serverName); // failed connects must not poison the cache
      throw err;
    });
    clients.set(serverName, pending);
    return pending;
  };

  const checkAllowed = (serverName: string): string | null => {
    if (allowedServers && !allowedServers.includes(serverName)) {
      return `Connector "${serverName}" is not available in this run (not enabled for this agent).`;
    }
    return null;
  };

  const listTools = new DynamicStructuredTool({
    name: "list_mcp_tools",
    description:
      "List the tools an external app connector (MCP server) exposes. Use after search_connectors " +
      "to see what a connector can do, or to discover exact tool names + argument schemas before calling them. " +
      "Works for connectors that are connected/authenticated — including ones the user just connected " +
      "from a suggestion card.",
    schema: z.object({
      server: z.string().describe("Connector id from search_connectors, e.g. 'github' or 'zapier'."),
    }),
    func: async (input: { server: string }) => {
      const denied = checkAllowed(input.server);
      if (denied) return denied;
      try {
        const client = await connect(input.server);
        const { tools } = await client.listTools();
        if (tools.length === 0) return `Connector "${input.server}" exposes no tools.`;
        const lines = tools.map(
          (t) =>
            `- ${t.name}: ${(t.description ?? t.name).replace(/\s+/g, " ").trim()}` +
            (t.inputSchema ? `\n  args schema: ${JSON.stringify(t.inputSchema)}` : ""),
        );
        return `Connector "${input.server}" exposes ${tools.length} tool(s) — call them with call_mcp_tool:\n\n${lines.join("\n")}`;
      } catch (err) {
        const hint = isMcpAuthError(err) ? ` ${mcpAuthFailureHint(input.server)}` : "";
        return `Error: could not connect to "${input.server}" — ${err instanceof Error ? err.message : String(err)}.${hint}`;
      }
    },
  });

  const callTool = new DynamicStructuredTool({
    name: "call_mcp_tool",
    description:
      "Call a tool on an external app connector (MCP server) on demand — no restart needed. " +
      "Use search_connectors to find the connector and list_mcp_tools for exact tool names and " +
      "argument schemas (see the tool's args schema hint in the listing). " +
      "If a call fails with an authorization/401-style error, the user's sign-in likely expired: " +
      "call suggest with kind=\"connector\" for that server so they can re-authenticate, then retry.",
    schema: z.object({
      server: z.string().describe("Connector id from search_connectors, e.g. 'github' or 'zapier'."),
      tool: z.string().describe("Tool name from list_mcp_tools, e.g. 'create_issue'."),
      args: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Tool arguments object, matching the tool's args schema."),
    }),
    func: async (input: { server: string; tool: string; args?: Record<string, unknown> }) => {
      const denied = checkAllowed(input.server);
      if (denied) return denied;
      try {
        const client = await connect(input.server);
        touchMcpUsage(input.server);
        const result = await client.callTool({ name: input.tool, arguments: input.args ?? {} });
        const content = (result.content as Array<{ type: string; text?: string }> | undefined) ?? [];
        const text = content
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("\n");
        return text.slice(0, 12000) || JSON.stringify(result).slice(0, 12000);
      } catch (err) {
        const hint = isMcpAuthError(err) ? ` ${mcpAuthFailureHint(input.server)}` : "";
        return `Error: MCP call failed — ${err instanceof Error ? err.message : String(err)}.${hint}`;
      }
    },
  });

  return {
    tools: [listTools, callTool],
    dispose: async () => {
      await Promise.allSettled(
        [...clients.values()].map((p) => p.then((c) => c.close()).catch(() => {})),
      );
    },
  };
}
