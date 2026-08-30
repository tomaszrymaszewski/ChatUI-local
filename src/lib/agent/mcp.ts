import { z } from "zod";
import { DynamicStructuredTool, type StructuredTool } from "langchain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { readOpencodeConfig, getMcpEntries, type McpEntry } from "@/lib/opencode-config";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

async function connectClient(entry: McpEntry): Promise<Client> {
  const client = new Client({ name: "chatui", version: "0.1.0" });
  const url = new URL(entry.url!);
  const headers = entry.headers ?? {};
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
): Promise<McpToolsResult> {
  const tools: StructuredTool[] = [];
  const clients: Client[] = [];
  let config;
  try {
    config = await readOpencodeConfig(projectDir);
  } catch {
    return { tools, dispose: async () => {} };
  }
  const entries = Object.entries(getMcpEntries(config));

  for (const [serverName, entry] of entries) {
    if (entry.enabled === false) continue;
    if (!entry.url || !/^https?:\/\//.test(entry.url)) continue;
    try {
      const client = await Promise.race([
        connectClient(entry),
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
