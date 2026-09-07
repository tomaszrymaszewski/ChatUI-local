import { z } from "zod";
import { DynamicStructuredTool, type StructuredTool } from "langchain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { visibleMcpServers, type McpServerEntry } from "@/lib/mcp-store";
import { getAccessToken } from "@/lib/mcp-auth";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

async function connectClient(entry: McpServerEntry, headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "chatui", version: "0.1.0" });
  const url = new URL(entry.url!);
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
    return client;
  } catch {
    await client.connect(new SSEClientTransport(url, { requestInit: { headers } }));
    return client;
  }
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
): Promise<McpToolsResult> {
  const tools: StructuredTool[] = [];
  const clients: Client[] = [];
  const entries = visibleMcpServers(projectDir);

  for (const [serverName, entry] of Object.entries(entries)) {
    if (allowedServers && !allowedServers.includes(serverName)) continue;
    if (!entry.url || !/^https?:\/\//.test(entry.url)) continue;
    try {
      // OAuth-enabled servers: attach the Bearer token from the app's token
      // store (written by the native browser sign-in flow) unless the entry
      // already carries an explicit auth header.
      const headers: Record<string, string> = { ...(entry.headers ?? {}) };
      const hasAuthHeader = Object.keys(headers).some(
        (k) => k.toLowerCase() === "authorization",
      );
      if (!hasAuthHeader) {
        const token = await getAccessToken(serverName);
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const client = await Promise.race([
        connectClient(entry, headers),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("MCP connect timeout")), 10000),
        ),
      ]);
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
              try {
                const result = await client.callTool({ name: t.name, arguments: args });
                const content = (result.content as Array<{ type: string; text?: string }> | undefined) ?? [];
                const text = content
                  .filter((c) => c.type === "text" && typeof c.text === "string")
                  .map((c) => c.text)
                  .join("\n");
                return text.slice(0, 12000) || JSON.stringify(result).slice(0, 12000);
              } catch (err) {
                return `Error: MCP tool failed — ${err instanceof Error ? err.message : String(err)}`;
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
): Promise<RemoteToolSummary[] | null> {
  const entry: McpServerEntry = { type: "remote", url, addedAt: "" };
  const headers: Record<string, string> = {};
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
