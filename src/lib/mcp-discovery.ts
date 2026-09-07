// Tool-level descriptions for the connector catalog, fetched best-effort from
// the remote MCP servers and cached in localStorage. The knowledge indexer
// embeds these so the vector DB matches user requests against what each
// connector can actually do (e.g. "create a jira ticket" → Atlassian).

import { MCP_CATALOG } from "@/lib/mcp-catalog";
import { getAccessToken } from "@/lib/mcp-auth";
import { listRemoteToolSummaries, type RemoteToolSummary } from "@/lib/agent/mcp";

export type { RemoteToolSummary };

const CACHE_KEY = "chatui:mcp:toolinfo";
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const CONCURRENCY = 3;

interface CacheEntry {
  tools: RemoteToolSummary[];
  fetchedAt: number;
  failed?: boolean;
}

type ToolInfoCache = Record<string, CacheEntry>;

function readCache(): ToolInfoCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ToolInfoCache;
  } catch {
    return {};
  }
}

function writeCache(cache: ToolInfoCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors — the cache is rebuildable
  }
}

function isFresh(entry: CacheEntry): boolean {
  const ttl = entry.failed ? FAILURE_TTL_MS : SUCCESS_TTL_MS;
  return Date.now() - entry.fetchedAt < ttl;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Tool summaries per catalog entry id, refreshing stale entries in the
 * background. OAuth connectors are only fetched when a token exists
 * (unauthenticated listings just fail); servers that refuse the listing fall
 * back to the catalog text in the index.
 */
export async function getConnectorToolInfo(): Promise<Record<string, RemoteToolSummary[]>> {
  const cache = readCache();
  const remote = MCP_CATALOG.filter(
    (entry): entry is typeof entry & { install: { type: "remote"; url: string } } =>
      entry.install.type === "remote",
  );
  const stale: Array<{ id: string; url: string; token: string | null }> = [];
  for (const entry of remote) {
    const cached = cache[entry.id];
    if (cached && isFresh(cached)) continue;
    // apikey servers need a key whose header scheme we don't know — skip
    // fetching and rely on the catalog text. OAuth servers need a token.
    const token =
      entry.auth === "oauth" ? await getAccessToken(entry.id).catch(() => null) : null;
    if (entry.auth === "oauth" && !token) {
      cache[entry.id] = { tools: [], fetchedAt: Date.now(), failed: true };
      continue;
    }
    stale.push({ id: entry.id, url: entry.install.url, token });
  }

  await mapWithConcurrency(stale, CONCURRENCY, async (item) => {
    const tools = await listRemoteToolSummaries(item.url, item.token, FETCH_TIMEOUT_MS);
    cache[item.id] =
      tools && tools.length > 0
        ? { tools, fetchedAt: Date.now() }
        : { tools: [], fetchedAt: Date.now(), failed: true };
  });
  if (stale.length > 0) writeCache(cache);

  const out: Record<string, RemoteToolSummary[]> = {};
  for (const entry of remote) {
    const cached = cache[entry.id];
    if (cached && !cached.failed && cached.tools.length > 0) {
      out[entry.id] = cached.tools;
    }
  }
  return out;
}
