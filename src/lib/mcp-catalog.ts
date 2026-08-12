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

export type McpAuthType = "oauth" | "apikey" | "none";
export type McpCategory =
  | "Productivity"
  | "Design"
  | "Developer"
  | "Data & AI"
  | "Business"
  | "Search & Research";

export interface McpCatalogEntry {
  /** Config key used in opencode.json (`mcp.<id>`). */
  id: string;
  /** Friendly display name. */
  name: string;
  /** One-line, non-technical description of what connecting enables. */
  tagline: string;
  category: McpCategory;
  /** "Official" badge source label. */
  vendor: string;
  auth: McpAuthType;
  /** Environment variable keys the user must provide (when auth === "apikey"). */
  envKeys?: string[];
  install:
    | { type: "remote"; url: string }
    | { type: "local"; command: string[] };
  /** Optional registry namespace for validation/lookup. */
  registryName?: string;
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
    tagline: "Connect the AI to 9,000+ apps through your Zapier automations.",
    category: "Productivity",
    vendor: "Zapier",
    auth: "oauth",
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
    install: { type: "remote", url: "https://docs.mcp.cloudflare.com/mcp" },
    registryName: "com.cloudflare.mcp/mcp",
  },
  {
    id: "sentry",
    name: "Sentry",
    tagline: "Pull errors and issues from Sentry so the AI can help debug them.",
    category: "Developer",
    vendor: "Sentry",
    auth: "apikey",
    envKeys: ["SENTRY_AUTH_TOKEN"],
    install: { type: "local", command: ["npx", "-y", "@sentry/mcp-server"] },
    registryName: "io.github.getsentry/sentry-mcp",
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
  {
    id: "context7",
    name: "Context7",
    tagline: "Get up-to-date, version-accurate docs for any library while coding.",
    category: "Developer",
    vendor: "Upstash",
    auth: "none",
    install: { type: "local", command: ["npx", "-y", "@upstash/context7-mcp"] },
    registryName: "io.github.upstash/context7",
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
    id: "mongodb",
    name: "MongoDB",
    tagline: "Query and explore your MongoDB databases.",
    category: "Data & AI",
    vendor: "MongoDB",
    auth: "apikey",
    envKeys: ["MONGODB_URI"],
    install: { type: "local", command: ["npx", "-y", "mongodb-mcp-server"] },
    registryName: "io.github.mongodb-js/mongodb-mcp-server",
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
    install: { type: "remote", url: "https://mcp.exa.ai/mcp" },
    registryName: "ai.exa/exa",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    tagline: "Turn any website into clean text the AI can read and search.",
    category: "Search & Research",
    vendor: "Firecrawl",
    auth: "apikey",
    envKeys: ["FIRECRAWL_API_KEY"],
    install: { type: "local", command: ["npx", "-y", "firecrawl-mcp"] },
    registryName: "io.github.firecrawl/firecrawl-mcp-server",
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

  // ─── Reference utilities (official MCP-org reference servers) ───────────────
  {
    id: "fetch",
    name: "Web Fetch",
    tagline: "Let the AI read a specific web page when you paste a link.",
    category: "Search & Research",
    vendor: "Model Context Protocol",
    auth: "none",
    install: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-fetch"] },
  },
  {
    id: "memory",
    name: "Memory",
    tagline: "A persistent knowledge graph so the AI remembers things across chats.",
    category: "Productivity",
    vendor: "Model Context Protocol",
    auth: "none",
    install: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"] },
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    tagline: "Helps the AI break hard problems into step-by-step reasoning.",
    category: "Data & AI",
    vendor: "Model Context Protocol",
    auth: "none",
    install: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"] },
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
  return MCP_CATALOG.find((e) => e.id === id);
}
