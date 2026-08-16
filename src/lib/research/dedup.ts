// Query dedup: normalize queries so near-identical phrasing collapses to one
// key, then hash to keep the seen-set small.

export function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// FNV-1a 32-bit — deterministic, dependency-free, plenty for a seen-set key.
export function hashQuery(query: string): string {
  const normalized = normalizeQuery(query);
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export class QueryDedup {
  private seen = new Set<string>();

  /** Returns the subset of `queries` not yet seen, deduped against each other too. */
  filterNew(queries: string[]): string[] {
    const result: string[] = [];
    const localSeen = new Set<string>();
    for (const query of queries) {
      const key = hashQuery(query);
      if (!this.seen.has(key) && !localSeen.has(key)) {
        result.push(query);
        localSeen.add(key);
      }
    }
    return result;
  }

  markSeen(queries: string[]): void {
    for (const query of queries) {
      this.seen.add(hashQuery(query));
    }
  }
}
