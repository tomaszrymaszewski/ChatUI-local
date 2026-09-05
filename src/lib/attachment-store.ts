// Persistent blob store for uploaded files (chat attachments, project
// files/images). localStorage only carries metadata — the bytes live here in
// IndexedDB, which survives restarts and has a much larger quota. Falls back
// to an in-memory Map when IndexedDB is unavailable (tests, SSR-ish envs).

interface StoredFileRecord {
  blob: Blob;
  /** Cached extracted text for documents, so history replay never re-parses. */
  extractedText?: string;
  createdAt: number;
}

const DB_NAME = "chatui-files";
const DB_VERSION = 1;
const STORE = "blobs";

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

/** In-memory fallback (also used when IndexedDB is missing/unavailable). */
const memoryStore = new Map<string, StoredFileRecord>();

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface PutFileOptions {
  /** Pre-extracted document text to cache alongside the blob. */
  extractedText?: string;
}

/** Persist a file's bytes (and optional cached text) under an id. */
export async function putFileBlob(
  id: string,
  blob: Blob,
  opts?: PutFileOptions,
): Promise<void> {
  const record: StoredFileRecord = {
    blob,
    extractedText: opts?.extractedText,
    createdAt: Date.now(),
  };
  const db = await openDb();
  if (!db) {
    memoryStore.set(id, record);
    return;
  }
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record, id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    memoryStore.set(id, record);
  }
}

/** Update just the cached extracted text for a stored file. */
export async function setFileText(id: string, extractedText: string): Promise<void> {
  const existing = await getFileRecord(id);
  if (!existing) return;
  await putFileBlob(id, existing.blob, { extractedText });
}

async function getFileRecord(id: string): Promise<StoredFileRecord | null> {
  const db = await openDb();
  if (!db) return memoryStore.get(id) ?? null;
  try {
    const tx = db.transaction(STORE, "readonly");
    const record = await requestToPromise(
      tx.objectStore(STORE).get(id) as IDBRequest<StoredFileRecord | undefined>,
    );
    return record ?? memoryStore.get(id) ?? null;
  } catch {
    return memoryStore.get(id) ?? null;
  }
}

/** Get a stored file's bytes, or null when absent. */
export async function getFileBlob(id: string): Promise<Blob | null> {
  return (await getFileRecord(id))?.blob ?? null;
}

/** Get a stored file's cached extracted text ("" when none). */
export async function getFileText(id: string): Promise<string> {
  return (await getFileRecord(id))?.extractedText ?? "";
}

/** Remove a stored file. Safe to call for unknown ids. */
export async function deleteFileBlob(id: string): Promise<void> {
  memoryStore.delete(id);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // ignore
  }
}

/** True when the store is the in-memory fallback (IndexedDB unavailable). */
export function isFileStorePersistent(): boolean {
  return typeof indexedDB !== "undefined";
}
