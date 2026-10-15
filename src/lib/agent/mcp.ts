import { z } from "zod";
import { DynamicStructuredTool, type StructuredTool } from "langchain";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
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

function browserActivityLabel(toolName: string, args: Record<string, unknown>): { label: string; detail?: string } {
  const name = toolName.toLowerCase();
  if (name.includes("navigate")) {
    let detail: string | undefined;
    if (typeof args.url === "string") {
      try {
        const url = new URL(args.url);
        detail = `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
      } catch {
        detail = undefined;
      }
    }
    return { label: "Opening a page", detail };
  }
  if (name.includes("snapshot") || name.includes("inspect")) return { label: "Inspecting page controls" };
  if (name.includes("screenshot")) return { label: "Capturing a browser view" };
  if (name.includes("click") || name.includes("select_option")) return { label: "Using a page control" };
  if (name.includes("type") || name.includes("fill")) return { label: "Entering text in the browser" };
  if (name.includes("press_key")) return { label: "Pressing a browser key" };
  if (name.includes("scroll")) return { label: "Scrolling a page" };
  if (name.includes("tabs") || name.includes("tab")) return { label: "Selecting a browser tab" };
  if (name.includes("hover")) return { label: "Inspecting a page control" };
  return { label: "Using browser controls" };
}

async function publishBrowserActivity(payload: { id?: string; active: boolean; label: string; detail?: string }): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  await emit("agent-computer-activity", payload).catch(() => {});
}

function mcpToolOutput(result: Awaited<ReturnType<Client["callTool"]>>): string | Array<Record<string, unknown>> {
  const blocks = (result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string } | undefined>) ?? [];
  const text = blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block?.text ?? "")
    .join("\n");
  const images = blocks
    .filter((block) => block?.type === "image" && typeof block.data === "string")
    .map((block) => ({ type: "image", data: block?.data as string, mimeType: block?.mimeType ?? "image/png" }));
  if (images.length > 0) {
    return [{ type: "text", text: text || "Screenshot captured." }, ...images];
  }
  return text.slice(0, 12000) || JSON.stringify(result).slice(0, 12000);
}

function addSharedBrowserControls(tools: StructuredTool[], getClient: () => Promise<Client>): void {
  const available = new Set([
    "browser_tabs",
    "browser_navigate",
    "browser_take_screenshot",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_press_key",
    "browser_evaluate",
  ]);
  const call = async (
    mcpName: string,
    args: Record<string, unknown>,
    activity: { label: string; detail?: string },
  ) => {
    const id = crypto.randomUUID();
    await publishBrowserActivity({ id, active: true, ...activity });
    try {
      const client = await getClient();
      return mcpToolOutput(await client.callTool({ name: mcpName, arguments: args }));
    } catch (error) {
      return `Browser action failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      await publishBrowserActivity({ id, active: false, ...activity });
    }
  };
  const add = (
    name: string,
    description: string,
    schema: ReturnType<typeof z.object>,
    mcpName: string,
    activity: { label: string; detail?: string },
    args: (input: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    if (!available.has(mcpName)) return;
    tools.push(new DynamicStructuredTool({
      name,
      description,
      schema,
      func: (input) => call(mcpName, args(input as Record<string, unknown>), activity),
    }));
  };

  add(
    "computer_select_window",
    "Select a browser tab in the isolated Playwright browser session. Call with action='list' first to see tab indexes.",
    z.object({ action: z.enum(["list", "select", "new", "close"]), index: z.number().optional(), url: z.string().optional() }),
    "browser_tabs",
    { label: "Selecting a browser tab" },
    (input) => input,
  );
  add(
    "computer_navigate",
    "Navigate the isolated Playwright browser to a website. Use this for browser tasks; it does not change the user's visible browser.",
    z.object({ url: z.string().url() }),
    "browser_navigate",
    { label: "Opening a page" },
    (input) => input,
  );
  add(
    "computer_screenshot",
    "Capture the current Playwright browser page. The returned image is available to inspect; use computer_accessibility_tree to locate controls.",
    z.object({ target: z.string().optional(), fullPage: z.boolean().optional(), type: z.enum(["png", "jpeg", "webp"]).optional() }),
    "browser_take_screenshot",
    { label: "Capturing a browser view" },
    (input) => input,
  );
  add(
    "computer_accessibility_tree",
    "Inspect the current browser page's accessibility tree. Use this before interacting with page controls.",
    z.object({ depth: z.number().optional(), boxes: z.boolean().optional() }),
    "browser_snapshot",
    { label: "Inspecting page controls" },
    (input) => input,
  );
  add(
    "computer_click",
    "Click an element in the isolated browser, identified by a reference from the accessibility snapshot or a unique selector.",
    z.object({ target: z.string(), element: z.string().optional(), doubleClick: z.boolean().optional(), button: z.string().optional() }),
    "browser_click",
    { label: "Using a page control" },
    (input) => input,
  );
  add(
    "computer_type",
    "Type or fill text into an editable browser element identified by the accessibility snapshot or a unique selector.",
    z.object({ target: z.string(), text: z.string(), element: z.string().optional(), submit: z.boolean().optional(), slowly: z.boolean().optional() }),
    "browser_type",
    { label: "Entering text in the browser" },
    (input) => input,
  );
  add(
    "computer_keypress",
    "Press a key in the isolated browser page (for example Enter, Tab, Escape, ArrowDown, or PageDown).",
    z.object({ key: z.string() }),
    "browser_press_key",
    { label: "Pressing a browser key" },
    (input) => input,
  );
  if (available.has("browser_evaluate")) {
    tools.push(new DynamicStructuredTool({
      name: "computer_scroll",
      description: "Scroll the current isolated browser page by a bounded amount. This scrolls only the Playwright page, not the user's desktop.",
      schema: z.object({ direction: z.enum(["up", "down"]), amount: z.number().min(50).max(2000).default(640) }),
      func: ({ direction, amount }: { direction: "up" | "down"; amount: number }) => {
        const delta = (direction === "down" ? 1 : -1) * Math.max(50, Math.min(2000, amount ?? 640));
        return call("browser_evaluate", {
          function: `() => { window.scrollBy({ top: ${delta}, behavior: "smooth" }); return "Scrolled ${direction} ${Math.abs(delta)} pixels."; }`,
        }, { label: direction === "down" ? "Scrolling down a page" : "Scrolling up a page" });
      },
    }));
    tools.push(new DynamicStructuredTool({
      name: "computer_clipboard_read",
      description: "Read text from the clipboard available to the isolated browser session. Clipboard permissions vary, and the browser may use the operating system clipboard; read only when the task needs it.",
      schema: z.object({}),
      func: () => call("browser_evaluate", {
        function: "async () => await navigator.clipboard.readText()",
      }, { label: "Reading browser clipboard" }),
    }));
    tools.push(new DynamicStructuredTool({
      name: "computer_clipboard_write",
      description: "Write text to the clipboard available to the isolated browser session. This may use the operating system clipboard, so only write when the task needs it.",
      schema: z.object({ text: z.string() }),
      func: ({ text }: { text: string }) => call("browser_evaluate", {
        function: `async () => { await navigator.clipboard.writeText(${JSON.stringify(text)}); return "Clipboard updated."; }`,
      }, { label: "Writing browser clipboard" }),
    }));
  }
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
  /** Agentic runs always get the isolated built-in Playwright browser. */
  includeBuiltInBrowser = false,
): Promise<McpToolsResult> {
  const tools: StructuredTool[] = [];
  const clients: Client[] = [];
  const entries = visibleMcpServers(projectDir);
  const browserEntry: McpServerEntry | undefined = includeBuiltInBrowser
    ? {
      type: "remote",
      url: "http://localhost:8931/mcp",
      enabled: true,
      addedAt: "built-in",
    }
    : undefined;
  // Only the most recently used servers connect eagerly (native mcp__ tools
  // with full JSON schemas — costly); the rest stay reachable through the
  // call_mcp_tool proxy, so a big connector library can't bloat the prompt
  // or stack connect timeouts onto every send.
  const hot = new Set(hotSetMcpServers(projectDir, hotSetLimit));

  for (const [serverName, entry] of Object.entries(entries)) {
    // The built-in browser is connected lazily by its wrapper tools, keeping
    // agent startup responsive while retaining reliable retries on first use.
    if (includeBuiltInBrowser && serverName === "playwright-browser") continue;
    if (
      allowedServers &&
      !allowedServers.includes(serverName) &&
      !(includeBuiltInBrowser && serverName === "playwright-browser")
    ) continue;
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
              const isBrowserAction = includeBuiltInBrowser && serverName === "playwright-browser";
              const browserActivity = isBrowserAction ? browserActivityLabel(t.name, args) : null;
              const browserActivityId = browserActivity ? crypto.randomUUID() : undefined;
              if (browserActivity && browserActivityId) {
                await publishBrowserActivity({ id: browserActivityId, active: true, ...browserActivity });
              }
              try {
                const result = await client.callTool({ name: t.name, arguments: args });
                return mcpToolOutput(result);
              } catch (err) {
                const hint = isMcpAuthError(err) ? ` ${mcpAuthFailureHint(serverName)}` : "";
                return `Error: MCP tool failed — ${err instanceof Error ? err.message : String(err)}.${hint}`;
              } finally {
                if (browserActivity && browserActivityId) {
                  await publishBrowserActivity({ id: browserActivityId, active: false, ...browserActivity });
                }
              }
            },
          }),
        );
      }
    } catch {
      // unreachable / unsupported — skip this server
    }
  }
  if (browserEntry) {
    let browserClient: Promise<Client> | null = null;
    const getBrowserClient = () => {
      if (!browserClient) {
        browserClient = connectServer("playwright-browser", browserEntry)
          .then((client) => {
            clients.push(client);
            return client;
          })
          .catch((error) => {
            browserClient = null;
            throw error;
          });
      }
      return browserClient;
    };
    addSharedBrowserControls(tools, getBrowserClient);
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
