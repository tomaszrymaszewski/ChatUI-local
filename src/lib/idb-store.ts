// Big-key store: chat sessions + message stores live here, not localStorage.
//
// localStorage caps at ~5MB per origin (WebKit) and the app's chats outgrew
// it. This module persists the big keys through one of two backends:
// - IndexedDB ("chatui-store", browsers + Tauri): gigabytes of room, with a
//   synchronous in-memory mirror so every existing call site stays synchronous
//   (writes are ordered write-behind via a promise chain).
// - localStorage (tests, SSR-ish envs, IndexedDB unavailable): legacy path,
//   byte-identical behavior to before (quota errors propagate to the same
//   callers that already handle them).
// A one-time sweep at boot moves leftover localStorage big keys into
// IndexedDB (verified per key before the original is deleted).
//
// Reads fall back to localStorage on a mirror miss (covers tests that seed
// localStorage directly without preloading, and any straggler key).
//
// Sync dirty-tracking: the localStorage storage hook can't see mirror
// writes, so writers mark keys dirty through a listener sync.ts registers
// (default: dirty, matching today's hook; sync's own applies pass dirty:false
// since their meta already advanced).

const DB_NAME = "chatui-store";
const DB_VERSION = 1;
const STORE = "kv";

export function isBigKey(key: string): boolean {
  // Note: chatui:messages:recency is small bookkeeping that stays in
  // localStorage — its readers use raw localStorage, not this module.
  return (
    key === "chatui:sessions" ||
    (key.startsWith("chatui:messages:") && key !== "chatui:messages:recency")
  );
}

/**
 * Message-store keys with no matching session id — stores orphaned by older
 * versions, which removed the session list entry but never the store. Returns
 * [] unless the sessions value parses to an array (never GC against a missing
 * or corrupt list).
 */
export function findOrphanedMessageKeys(allKeys: string[], sessionsRaw: string | null): string[] {
  if (!sessionsRaw) return [];
  let ids: Set<string>;
  try {
    const parsed = JSON.parse(sessionsRaw) as Array<{ id?: unknown }>;
    if (!Array.isArray(parsed)) return [];
    ids = new Set(
      parsed.map((s) => s?.id).filter((id): id is string => typeof id === "string"),
    );
  } catch {
    return [];
  }
  return allKeys.filter(
    (key) =>
      isBigKey(key) &&
      key !== "chatui:sessions" &&
      !ids.has(key.slice("chatui:messages:".length)),
  );
}

type Backend = "idb" | "local";
let backend: Backend | null = null;

function activeBackend(): Backend {
  return backend ?? "local";
}

// ─── IndexedDB wire protocol (mirrors attachment-store.ts) ────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

/** Write one entry. False when IndexedDB is unavailable or the write failed. */
async function idbSet(key: string, value: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    return await txDone(tx);
  } catch {
    return false;
  }
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    await txDone(tx);
  } catch {
    // ignore — the mirror keeps serving reads
  }
}

async function idbEntries(): Promise<Array<[string, string]>> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const keys = await requestToPromise(store.getAllKeys() as IDBRequest<string[]>);
    const values = await requestToPromise(store.getAll() as IDBRequest<unknown[]>);
    const out: Array<[string, string]> = [];
    for (let i = 0; i < keys.length; i++) {
      const value = values[i];
      if (typeof value === "string") out.push([keys[i], value]);
    }
    return out;
  } catch {
    return [];
  }
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } catch {
    // ignore
  }
}

// ─── Mirror + public API ───────────────────────────────────────────────────

/** In-memory mirror (populated only on the IndexedDB backend). */
const mirror = new Map<string, string>();

type DirtyListener = (key: string) => void;
let dirtyListener: DirtyListener | null = null;

/** Registered by sync.ts so mirror writes schedule cloud pushes. */
export function setBigStoreDirtyListener(fn: DirtyListener | null): void {
  dirtyListener = fn;
}

function notifyDirty(key: string): void {
  try {
    dirtyListener?.(key);
  } catch {
    // A listener must never break writes.
  }
}

export function readBigKey(key: string): string | null {
  const hit = mirror.get(key);
  if (hit !== undefined) return hit;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function listBigKeys(prefix: string): string[] {
  const out = new Set<string>();
  for (const key of mirror.keys()) {
    if (key.startsWith(prefix)) out.add(key);
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) out.add(key);
    }
  } catch {
    // ignore — mirror keys still returned
  }
  return [...out];
}

// Ordered write-behind queue (IndexedDB backend): same-tab writes land in
// call order. Each op swallows its own errors so the chain never stalls.
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(op: () => Promise<unknown>): void {
  writeQueue = writeQueue.then(async () => {
    try {
      await op();
    } catch {
      // The mirror keeps serving reads; the next write retries persistence.
    }
  });
}

export function writeBigKey(key: string, value: string, opts?: { dirty?: boolean }): void {
  if (opts?.dirty !== false) notifyDirty(key);
  if (activeBackend() === "local") {
    // Legacy path: synchronous, quota errors propagate (callers already
    // handle them exactly as they did for raw localStorage writes).
    localStorage.setItem(key, value);
    return;
  }
  mirror.set(key, value);
  enqueueWrite(() => idbSet(key, value));
}

export function removeBigKey(key: string, opts?: { dirty?: boolean }): void {
  if (opts?.dirty !== false) notifyDirty(key);
  if (activeBackend() === "local") {
    localStorage.removeItem(key);
    return;
  }
  mirror.delete(key);
  enqueueWrite(() => idbDelete(key));
}

/**
 * Move leftover localStorage big keys into IndexedDB (verified per key
 * before the original is deleted, so a crash just reruns the leftovers).
 * Runs on every boot while any stragglers remain — including keys an older
 * app version wrote after migrating (the localStorage copy always wins, as
 * the latest write). Orphaned message stores (no matching session) are
 * dropped instead of migrated.
 */
async function migrateLocalStorageToIdb(): Promise<void> {
  let keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isBigKey(key)) keys.push(key);
    }
  } catch {
    return;
  }
  const orphans = new Set(findOrphanedMessageKeys(keys, readBigKey("chatui:sessions")));
  let dropped = 0;
  for (const key of keys) {
    if (orphans.has(key)) {
      try {
        localStorage.removeItem(key);
        dropped++;
      } catch {
        // keep going — next boot retries
      }
      continue;
    }
    let value: string | null = null;
    try {
      value = localStorage.getItem(key);
    } catch {
      continue;
    }
    if (value === null) continue;
    if (await idbSet(key, value)) {
      mirror.set(key, value);
      try {
        localStorage.removeItem(key);
      } catch {
        // Straggler stays; reads prefer the mirror, next boot retries.
      }
    }
    // else: IDB write failed — leave the original for next boot.
  }
  if (dropped > 0) {
    console.warn(`[chatui] dropped ${dropped} orphaned chat store(s) during migration`);
  }
}

/**
 * Boot gate (called from main.tsx before first render): picks the backend,
 * loads the mirror, and sweeps localStorage leftovers into IndexedDB.
 * Idempotent — safe to call again. Never throws.
 */
export async function preloadStores(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) {
      // LocalStorage backend: the mirror stays empty and every read/write
      // goes straight to localStorage (byte-identical to before).
      backend = "local";
      mirror.clear();
      return;
    }
    backend = "idb";
    for (const [key, value] of await idbEntries()) {
      if (isBigKey(key)) mirror.set(key, value);
    }
    await migrateLocalStorageToIdb();
  } catch {
    backend = "local";
    mirror.clear();
    // Reads fall back to localStorage.
  }
}

/**
 * Wipe every big key from the mirror, localStorage, and IndexedDB
 * (local-data reset). Callers must suspend the sync hook first. Never throws.
 */
export async function clearBigStores(): Promise<void> {
  mirror.clear();
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isBigKey(key)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // keep going
  }
  await idbClear();
}
