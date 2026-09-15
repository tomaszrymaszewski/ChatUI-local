// Storage-pressure relief for localStorage (a single ~5MB store shared by
// every chat, cache, and setting).
//
// Once the store fills up, every setItem throws QuotaExceededError ("The quota
// has been exceeded." in Safari/WebKit). Writers must never let that raw error
// reach the user: trySetItem for best-effort state (evicts rebuildable caches
// and retries once, then reports false) or setItemOrThrowFriendly for user
// data (same relief, then a clear Error the caller's toast can show).

/** Rebuildable caches, safe to drop under quota pressure — every loader below
 * treats a miss as empty and refetches in the background. */
const REBUILDABLE_CACHE_KEYS = [
  "chatui:modelsdev-cache", // models.dev catalog (TTL'd, refetched on miss)
  "chatui:skills:registry", // skill/connector registry file (24h TTL)
  "chatui:knowledge:curated-skills", // fetched SKILL.md bodies (30d TTL)
  "chatui:mcp:toolinfo", // connector tool listings (7d TTL)
];

export function isQuotaError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === "QuotaExceededError";
  return err instanceof Error && /quota/i.test(err.message);
}

/** Drop rebuildable caches to make room. Never throws. True if any existed. */
export function evictRebuildableCaches(): boolean {
  let removed = false;
  for (const key of REBUILDABLE_CACHE_KEYS) {
    try {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        removed = true;
      }
    } catch {
      // Keep trying the rest — a failing store shouldn't stop relief.
    }
  }
  return removed;
}

/**
 * setItem that never throws: on quota pressure it evicts rebuildable caches
 * once and retries. False when the write still didn't land (caller decides:
 * silent for best-effort state, friendly error for user data).
 */
export function trySetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isQuotaError(err)) return false;
    if (!evictRebuildableCaches()) return false;
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

/** Friendly error text for user-data writes that can't land (shown in toasts). */
export const STORAGE_FULL_MESSAGE =
  "Device storage is full — delete old chats or free up space, then try again.";

/**
 * setItem for user data: same cache relief as trySetItem, then a clear Error
 * instead of the raw QuotaExceededError. Any persistent failure surfaces here —
 * a failed provider/key/settings save must never look like it succeeded.
 */
export function setItemOrThrowFriendly(key: string, value: string): void {
  if (!trySetItem(key, value)) throw new Error(STORAGE_FULL_MESSAGE);
}
