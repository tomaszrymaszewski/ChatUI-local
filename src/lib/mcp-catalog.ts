/**
 * Curated catalog of official, first-party MCP servers.
 *
 * Rules (per product requirements):
 *  - Only official / first-party servers are listed. No community forks.
 *  - One entry per app. If an app has no official MCP (e.g. Overleaf), it's absent.
 *  - Remote (hosted) servers are preferred — they need no terminal, just a sign-in.
 *  - Each entry carries a plain-English tagline a non-technical user can understand.
 *
 * Verified against the official MCP registry (registry.modelcontextprotocol.io)
 * and each vendor's published MCP endpoint.
 */

import type { CustomOAuthArgs } from "./mcp-auth";

export type McpAuthType = "oauth" | "apikey" | "none";
export type McpCategory =
  | "Productivity"
  | "Design"
  | "Developer"
  | "Data & AI"
  | "Business"
  | "Search & Research";

export interface McpCatalogEntry {
  /** Config key in the app's connector store (chatui:mcp). */
  id: string;
  /** Friendly display name. */
  name: string;
  /** One-line, non-technical description of what connecting enables. */
  tagline: string;
  category: McpCategory;
  /** "Official" badge source label. */
  vendor: string;
  auth: McpAuthType;              // "oauth" | "apikey" | "none"
  /** Environment variable keys the user must provide (when auth === "apikey"). */
  envKeys?: string[];
  /**
   * Header the API key is sent in (when auth === "apikey"). Defaults to
   * "Authorization" (with a Bearer prefix). Exa expects the raw key in
   * "x-api-key".
   */
  apiKeyHeader?: string;
  /** Extra search keywords that the agent's search_connectors tool matches against. */
  keywords?: string[];
  /**
   * Local servers send no CORS headers, so the webview cannot reach them with
   * plain fetch — this connector's traffic is routed through the Rust
   * mcp_http_post command instead (CORS-free, like the headroom proxy).
   */
  corsFree?: boolean;
  install: { type: "remote"; url: string };
  /** Optional registry namespace for validation/lookup. */
  registryName?: string;
  /**
   * Bring-your-own-OAuth-client config. Present when the provider publishes
   * no dynamic-registration endpoint (Google's Workspace MCP servers): the
   * user creates the OAuth client themselves and pastes its credentials in
   * Settings, and sign-in uses these fixed endpoints + scopes instead of
   * discovery. The Rust shell's mcp_oauth_begin takes the same fields.
   */
  customOAuth?: CustomOAuthConfig;
}

/** Fixed-endpoint OAuth config for bring-your-own-client connectors. */
export interface CustomOAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  /** Space-separated scopes requested at sign-in for this connector. */
  scopes: string;
  /** Extra authorize-URL params (e.g. access_type=offline for refresh tokens). */
  extraParams?: Record<string, string>;
  /** Where the user creates the OAuth client. */
  setupUrl: string;
  /** One-line setup guidance shown next to the credential fields. */
  setupHint: string;
}

/**
 * NOTE: Google Workspace entries (Gmail, Drive, Docs, Sheets, Slides,
 * Calendar, Chat, Contacts) were removed until a Google OAuth client ID is
 * available. To re-add them, restore one entry per product with
 * `customOAuth` (Google endpoints, per-product scopes, offline-access extra
 * params) — the sign-in, refresh, panel, and card plumbing below already
 * supports it. Official endpoints: https://gmailmcp.googleapis.com/mcp/v1,
 * https://drivemcp.googleapis.com/mcp/v1, https://docsmcp.googleapis.com/mcp/v1,
 * https://sheetsmcp.googleapis.com/mcp/v1, https://slidesmcp.googleapis.com/mcp/v1,
 * https://calendarmcp.googleapis.com/mcp/v1, https://chatmcp.googleapis.com/mcp/v1,
 * https://people.googleapis.com/mcp/v1 (all verified live, HTTP 200).
 */

/**
 * Build the sign-in args for a bring-your-own-client connector — or undefined
 * when the entry has no customOAuth config or no client credentials were
 * stored yet. Shared by Settings and the in-session suggestion card so both
 * build identical args.
 */
export function customOAuthArgsFor(
  entry: McpCatalogEntry,
  clientId: string | undefined,
  clientSecret: string | undefined,
): CustomOAuthArgs | undefined {
  if (!entry.customOAuth || !clientId) return undefined;
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    authorizeUrl: entry.customOAuth.authorizeUrl,
    tokenUrl: entry.customOAuth.tokenUrl,
    scopes: entry.customOAuth.scopes,
    ...(entry.customOAuth.extraParams ? { extraParams: entry.customOAuth.extraParams } : {}),
  };
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  // ─── Productivity ────────────────────────────────────────────────────────
  {
    id: "notion",
    name: "Notion",
    tagline: "Let the AI read, search, and update your Notion pages and databases.",
    category: "Productivity",
    vendor: "Notion",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.notion.com/mcp" },
    registryName: "com.notion/mcp",
  },
  {
    id: "todoist",
    name: "Todoist",
    tagline: "Manage your to-do lists, tasks, and projects from your chats.",
    category: "Productivity",
    vendor: "Todoist",
    auth: "oauth",
    install: { type: "remote", url: "https://ai.todoist.net/mcp" },
    registryName: "net.todoist/mcp",
  },
  {
    id: "linear",
    name: "Linear",
    tagline: "Create, search, and update issues in your Linear project tracker.",
    category: "Productivity",
    vendor: "Linear",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.linear.app/mcp" },
    registryName: "app.linear/linear",
  },
  {
    id: "atlassian",
    name: "Jira & Confluence",
    tagline: "Work with Jira tickets and Confluence pages from your Atlassian cloud.",
    category: "Productivity",
    vendor: "Atlassian",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.atlassian.com/v1/mcp" },
    registryName: "com.atlassian/atlassian-mcp-server",
  },
  {
    id: "zapier",
    name: "Zapier",
    tagline: "Connect the AI to 9,000+ apps — including Gmail, Google Calendar, Google Docs, Drive, Outlook, Microsoft 365, and Slack — through your Zapier automations.",
    category: "Productivity",
    vendor: "Zapier",
    auth: "oauth",
    keywords: ["gmail", "google", "google calendar", "google docs", "drive", "sheets", "outlook", "office", "microsoft 365", "microsoft", "excel", "word", "teams", "slack", "email", "calendar"],
    install: { type: "remote", url: "https://mcp.zapier.com/api/v1/connect" },
    registryName: "com.zapier/mcp",
  },
  {
    id: "airtable",
    name: "Airtable",
    tagline: "Read and update records in your Airtable bases.",
    category: "Productivity",
    vendor: "Airtable",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.airtable.com/mcp" },
    registryName: "com.airtable/mcp",
  },

  // ─── Design ───────────────────────────────────────────────────────────────
  {
    id: "figma",
    name: "Figma",
    tagline: "Pull design files and frames from Figma so the AI can build from them.",
    category: "Design",
    vendor: "Figma",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.figma.com/mcp" },
    registryName: "com.figma.mcp/mcp",
  },
  {
    id: "webflow",
    name: "Webflow",
    tagline: "Design and manage Webflow sites with AI assistance.",
    category: "Design",
    vendor: "Webflow",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.webflow.com/mcp" },
    registryName: "com.webflow/mcp",
  },

  // ─── Developer ─────────────────────────────────────────────────────────────
  {
    id: "github",
    name: "GitHub",
    tagline: "Manage repos, issues, and pull requests on GitHub.",
    category: "Developer",
    vendor: "GitHub",
    auth: "oauth",
    install: { type: "remote", url: "https://api.githubcopilot.com/mcp/" },
  },
  {
    id: "vercel",
    name: "Vercel",
    tagline: "Inspect and manage your Vercel deployments and projects.",
    category: "Developer",
    vendor: "Vercel",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.vercel.com" },
    registryName: "com.vercel/vercel-mcp",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    tagline: "Manage Cloudflare services — DNS, Workers, KV, R2, and more.",
    category: "Developer",
    vendor: "Cloudflare",
    auth: "oauth",
    install: { type: "remote", url: "https://bindings.mcp.cloudflare.com/mcp" },
    registryName: "com.cloudflare.mcp/mcp",
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    tagline: "Search Cloudflare's official documentation — free, no sign-in needed.",
    category: "Search & Research",
    vendor: "Cloudflare",
    auth: "none",
    install: { type: "remote", url: "https://docs.mcp.cloudflare.com/mcp" },
  },
  {
    id: "postman",
    name: "Postman",
    tagline: "Run and explore your Postman API collections from chat.",
    category: "Developer",
    vendor: "Postman",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.postman.com/mcp" },
    registryName: "com.postman/postman-mcp-server",
  },

  // ─── Data & AI ─────────────────────────────────────────────────────────────
  {
    id: "supabase",
    name: "Supabase",
    tagline: "Run SQL, manage migrations, and work with your Supabase project.",
    category: "Data & AI",
    vendor: "Supabase",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.supabase.com/mcp" },
    registryName: "com.supabase/mcp",
  },
  {
    id: "prisma",
    name: "Prisma Postgres",
    tagline: "Manage Prisma Postgres databases and run migrations.",
    category: "Data & AI",
    vendor: "Prisma",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.prisma.io/sse" },
    registryName: "io.prisma/mcp",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    tagline: "Browse models, datasets, and AI apps on the Hugging Face Hub.",
    category: "Data & AI",
    vendor: "Hugging Face",
    auth: "oauth",
    install: { type: "remote", url: "https://huggingface.co/mcp" },
    registryName: "co.huggingface/hf-mcp-server",
  },

  // ─── Business ──────────────────────────────────────────────────────────────
  {
    id: "stripe",
    name: "Stripe",
    tagline: "Look up customers, charges, and subscriptions in your Stripe account.",
    category: "Business",
    vendor: "Stripe",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.stripe.com" },
    registryName: "com.stripe/mcp",
  },
  {
    id: "paypal",
    name: "PayPal",
    tagline: "Access PayPal orders, payments, and account info.",
    category: "Business",
    vendor: "PayPal",
    auth: "oauth",
    install: { type: "remote", url: "https://mcp.paypal.com/mcp" },
    registryName: "com.paypal.mcp/mcp",
  },

  // ─── Search & Research ─────────────────────────────────────────────────────
  {
    id: "exa",
    name: "Exa",
    tagline: "Smart web search and crawling to find and read the best sources.",
    category: "Search & Research",
    vendor: "Exa",
    auth: "apikey",
    envKeys: ["EXA_API_KEY"],
    apiKeyHeader: "x-api-key",
    install: { type: "remote", url: "https://mcp.exa.ai/mcp" },
    registryName: "ai.exa/exa",
  },
  {
    id: "microsoft-learn",
    name: "Microsoft Learn",
    tagline: "Search official Microsoft documentation — free, no sign-in needed.",
    category: "Search & Research",
    vendor: "Microsoft",
    auth: "none",
    install: { type: "remote", url: "https://learn.microsoft.com/api/mcp" },
    registryName: "com.microsoft/microsoft-learn-mcp",
  },
  {
    id: "playwright-browser",
    name: "Browser (Playwright)",
    tagline: "Let the AI browse in a real browser — read JavaScript-heavy pages, follow links, click, and fill forms. Runs locally on your machine.",
    category: "Search & Research",
    vendor: "Microsoft",
    auth: "none",
    corsFree: true,
    keywords: ["browser", "web browsing", "headless", "playwright", "chrome", "navigate", "click", "scrape", "webpage", "javascript-rendered", "registry"],
    install: { type: "remote", url: "http://localhost:8931/mcp" },
    registryName: "io.github.microsoft/playwright-mcp",
  },
];

export const MCP_CATEGORIES: McpCategory[] = [
  "Productivity",
  "Design",
  "Developer",
  "Data & AI",
  "Business",
  "Search & Research",
];

export function getCatalogEntry(id: string): McpCatalogEntry | undefined {
  return listCachedConnectors().find((e) => e.id === id);
}

// ─── Registry-driven catalog (same system as skills) ────────────────────────
//
// The registry.json in the app's repo can carry a "connectors" section with
// the same entry shape; new connectors ship without an app release. The
// in-bundle list above is the offline fallback. The registry cache (written
// by fetchRegistryFile during knowledge sweeps) is read synchronously for
// UI renders.

function cachedRegistryConnectors(): McpCatalogEntry[] {
  try {
    const raw = localStorage.getItem("chatui:skills:registry");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { file?: { connectors?: unknown[] } };
    return ((parsed?.file?.connectors ?? []) as McpCatalogEntry[]).filter(
      (e) => e && typeof e.id === "string" && typeof e.install?.url === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Synchronous unified view: bundled list + last cached registry entries
 * (bundled wins on id conflicts). For UI rendering; the async
 * listAllConnectors() is the authoritative version for sweeps/tools.
 */
export function listCachedConnectors(): McpCatalogEntry[] {
  const byId = new Map<string, McpCatalogEntry>();
  for (const entry of cachedRegistryConnectors()) byId.set(entry.id, entry);
  for (const entry of MCP_CATALOG) byId.set(entry.id, entry);
  return [...byId.values()];
}

/**
 * The unified connector catalog: in-bundle curated list + registry
 * entries (bundled wins on id conflicts). Consumers: knowledge index and
 * the search_connectors tool.
 */
export async function listAllConnectors(): Promise<McpCatalogEntry[]> {
  const { fetchRegistryFile } = await import("@/lib/skill-registry");
  const file = await fetchRegistryFile().catch(() => null);
  const byId = new Map<string, McpCatalogEntry>();
  for (const entry of (file?.connectors ?? []) as McpCatalogEntry[]) {
    if (
      entry &&
      typeof entry.id === "string" &&
      typeof entry.name === "string" &&
      typeof entry.install?.url === "string"
    ) {
      byId.set(entry.id, entry);
    }
  }
  for (const entry of MCP_CATALOG) byId.set(entry.id, entry);
  return [...byId.values()];
}
