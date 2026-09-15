import { invoke } from "@tauri-apps/api/core";
import { getSupabase } from "@/lib/supabase";
import { chatUiBaseDir } from "@/lib/agent/sandbox";
import { isTauri } from "@/lib/platform";
import { exportChatUiBackup } from "@/lib/data-transfer";

// Cloud sync: local-first mirroring of localStorage to Supabase.
//
// Every tracked `chatui:*` key is mirrored verbatim to one row in the
// `user_data` table (see supabase/schema.sql). The local copy is always the
// live one — the app works fully offline and anonymous; the cloud copy only
// exists while signed in. Sync is per-key last-write-wins with tombstones,
// except sessions and message stores, which union-merge by record id so chats
// from two devices combine instead of clobbering each other.
//
// Timestamps mix device time (local writes) and server time (row updated_at),
// so LWW across devices assumes roughly-correct clocks; ties go to the local
// device (the active user's data wins).

// ─── Key scope ─────────────────────────────────────────────────────────────

const SYNCED_PREFIXES = [
  "chatui:sessions",
  "chatui:messages:",
  "chatui:providers",
  "chatui:settings",
  "chatui:agents",
  "chatui:projects",
  "chatui:schedules",
  "chatui:workflows",
  "chatui:memory",
  "chatui:mcp",
  "chatui:mcp-disabled",
  "chatui:skills:usage",
  "chatui:skills:custom",
  "chatui:learn-mode",
  "chatui:agent-usage",
  "chatui:session-usage",
  "chatui:compaction",
  "chatui:context-overrides",
  "chatui:vision-overrides",
  "chatui:tavily-key",
];

// Local-only bookkeeping that must never travel, even though the prefixes
// above would otherwise catch some of it.
const SYNC_EXCLUDED = new Set([
  "chatui:sync:meta", // this file's own bookkeeping (also matches no prefix)
  "chatui:messages:recency", // quota-eviction index, meaningless elsewhere
  "chatui:mcp:migrated", // one-time migration flag
]);

export function isSyncedKey(key: string): boolean {
  if (SYNC_EXCLUDED.has(key)) return false;
  return SYNCED_PREFIXES.some((p) => key === p || key.startsWith(p));
}

// Sessions and message stores deep-merge (union by record id); every other
// tracked key syncs wholesale (last-write-wins).
function isDeepMergeKey(key: string): boolean {
  return key === "chatui:sessions" || key.startsWith("chatui:messages:");
}

// ─── Hash + meta ───────────────────────────────────────────────────────────

/** FNV-1a hex — tiny, synchronous change detection for stored strings. */
export function hashValue(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const META_KEY = "chatui:sync:meta";
/** Meta hash marker for "key was absent locally at last sync". */
const MISSING = "";

export interface KeyMeta {
  /** hashValue() of the local value at last sync, or "" when absent. */
  hash: string;
  /** Server updated_at the local state was reconciled against. */
  syncedAt: string;
  /** Device time of the last observed local write ("" when unknown). */
  localChangedAt: string;
  /** Whether the remote row was a tombstone at last sync. */
  remoteDeleted: boolean;
}

export type SyncMeta = Record<string, KeyMeta>;

function loadMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as SyncMeta;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // Non-fatal: the next sync just re-detects changes by hash.
  }
}

function readLocal(): Map<string, string> {
  const out = new Map<string, string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isSyncedKey(key)) {
        const value = localStorage.getItem(key);
        if (value !== null) out.set(key, value);
      }
    }
  } catch {
    // Storage unreadable — sync with whatever was collected.
  }
  return out;
}

// ─── Deep merge (sessions + message stores) ────────────────────────────────

export interface MergeSpec {
  idKey: string;
  timeKey: string;
}

function recordTime(record: Record<string, unknown>, timeKey: string): number {
  const t = record[timeKey];
  if (typeof t === "string") {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof t === "number" && Number.isFinite(t)) return t;
  return 0;
}

/**
 * Union-merge two JSON arrays of records by id, per-record last-write-wins
 * (ties go local). Sessions merge by updatedAt, messages by timestamp, so a
 * chat created on device A and one created on device B both survive linking.
 * Either side being unparseable keeps the local string (fail closed: never
 * delete local data on corrupt input).
 */
export function mergeRecordLists(localJson: string, remoteJson: string, spec: MergeSpec): string {
  let local: unknown;
  let remote: unknown;
  try {
    local = JSON.parse(localJson);
  } catch {
    return localJson;
  }
  try {
    remote = JSON.parse(remoteJson);
  } catch {
    return localJson;
  }
  if (!Array.isArray(local) || !Array.isArray(remote)) return localJson;
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const remoteById = new Map<string, Record<string, unknown>>();
  for (const r of remote) {
    if (r && typeof r === "object" && typeof (r as Record<string, unknown>)[spec.idKey] === "string") {
      remoteById.set((r as Record<string, unknown>)[spec.idKey] as string, r as Record<string, unknown>);
    }
  }
  for (const r of local) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const id = rec[spec.idKey];
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    const other = remoteById.get(id);
    merged.push(
      other && recordTime(other, spec.timeKey) > recordTime(rec, spec.timeKey) ? other : rec,
    );
  }
  for (const r of remote) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const id = rec[spec.idKey];
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    merged.push(rec);
  }
  return JSON.stringify(merged);
}

function mergeSpecFor(key: string): MergeSpec {
  return key === "chatui:sessions"
    ? { idKey: "id", timeKey: "updatedAt" }
    : { idKey: "id", timeKey: "timestamp" };
}

// ─── Sync planning (pure — the unit-tested core) ───────────────────────────

export interface RemoteRow {
  key: string;
  value: string;
  updated_at: string;
  deleted: boolean;
}

/**
 * Compare ISO timestamps numerically. ISO strings with different fractional
 * precision or timezone spellings (Z vs +00:00) do NOT sort lexicographically,
 * so every LWW decision goes through here. Unparseable/empty counts as oldest.
 */
export function cmpTime(a: string, b: string): number {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  const na = Number.isFinite(ta) ? (ta as number) : -Infinity;
  const nb = Number.isFinite(tb) ? (tb as number) : -Infinity;
  return na === nb ? 0 : na < nb ? -1 : 1;
}

export interface SyncPlan {
  /** Remote values to write locally. */
  toLocal: Array<{ key: string; value: string }>;
  /** Local keys to delete (remote tombstone won). */
  deleteLocal: string[];
  /** Local values to push (deleted=true pushes a tombstone). */
  toRemote: Array<{ key: string; value: string; deleted: boolean }>;
  /** Meta after the plan is applied (pushed keys get syncedAt=now; the IO
   * layer replaces those with the authoritative server timestamps). */
  meta: SyncMeta;
}

/**
 * Reconcile local state with remote rows. Rules:
 * - deep-merge keys (sessions, messages:*): union by record id, always —
 *   chats from both sides survive every sync, not just the first.
 * - other keys: per-key last-write-wins; unknown local timestamps and exact
 *   ties go to the local device (the active user's data wins).
 * - deletions travel as tombstones in both directions.
 */
export function planSync(
  local: Map<string, string>,
  remote: RemoteRow[],
  meta: SyncMeta,
  now: string,
  localChangedAt: Map<string, string> = new Map(),
): SyncPlan {
  const plan: SyncPlan = { toLocal: [], deleteLocal: [], toRemote: [], meta: { ...meta } };
  const remoteByKey = new Map(remote.map((r) => [r.key, r]));
  const keys = new Set<string>([...local.keys(), ...remoteByKey.keys(), ...Object.keys(meta)]);

  const changedAt = (key: string, m: KeyMeta | undefined): string =>
    localChangedAt.get(key) ?? m?.localChangedAt ?? "";

  const setMeta = (key: string, m: KeyMeta) => {
    plan.meta[key] = m;
  };
  const dropMeta = (key: string) => {
    delete plan.meta[key];
  };

  for (const key of keys) {
    if (!isSyncedKey(key)) {
      dropMeta(key);
      continue;
    }
    const localVal = local.get(key) ?? null;
    const row = remoteByKey.get(key);
    const m = meta[key];

    // Deep-merge keys: union by record id whenever both sides hold data.
    if (isDeepMergeKey(key) && localVal !== null && row && !row.deleted) {
      const merged = mergeRecordLists(localVal, row.value, mergeSpecFor(key));
      const localHash = hashValue(merged);
      if (merged !== localVal) plan.toLocal.push({ key, value: merged });
      if (merged !== row.value) plan.toRemote.push({ key, value: merged, deleted: false });
      setMeta(key, { hash: localHash, syncedAt: row.updated_at, localChangedAt: changedAt(key, m), remoteDeleted: false });
      continue;
    }

    if (localVal === null && !row) {
      dropMeta(key); // clean: absent everywhere
      continue;
    }
    if (localVal === null && row?.deleted) {
      dropMeta(key); // clean: deleted everywhere
      continue;
    }
    if (localVal === null && row && !row.deleted) {
      if (!m || m.hash === MISSING) {
        plan.toLocal.push({ key, value: row.value }); // new remote key
        setMeta(key, { hash: hashValue(row.value), syncedAt: row.updated_at, localChangedAt: "", remoteDeleted: false });
      } else if (changedAt(key, m) !== "" && cmpTime(changedAt(key, m), row.updated_at) >= 0) {
        plan.toRemote.push({ key, value: "", deleted: true }); // local delete wins
        setMeta(key, { hash: MISSING, syncedAt: now, localChangedAt: changedAt(key, m), remoteDeleted: true });
      } else {
        plan.toLocal.push({ key, value: row.value }); // remote resurrect wins
        setMeta(key, { hash: hashValue(row.value), syncedAt: row.updated_at, localChangedAt: "", remoteDeleted: false });
      }
      continue;
    }
    if (localVal !== null && !row) {
      plan.toRemote.push({ key, value: localVal, deleted: false }); // new local key
      setMeta(key, { hash: hashValue(localVal), syncedAt: now, localChangedAt: changedAt(key, m), remoteDeleted: false });
      continue;
    }
    if (localVal !== null && row?.deleted) {
      const localHash = hashValue(localVal);
      if (!m || localHash !== m.hash || !m.remoteDeleted) {
        const localWon =
          !m || localHash !== m.hash
            ? changedAt(key, m) === "" || cmpTime(changedAt(key, m), row.updated_at) >= 0
            : false;
        if (localWon) {
          plan.toRemote.push({ key, value: localVal, deleted: false }); // resurrect
          setMeta(key, { hash: localHash, syncedAt: now, localChangedAt: changedAt(key, m), remoteDeleted: false });
        } else {
          plan.deleteLocal.push(key); // remote delete wins
          dropMeta(key);
        }
      }
      // else: already in sync (tombstone acknowledged) — nothing to do.
      continue;
    }
    if (localVal !== null && row && !row.deleted) {
      const localHash = hashValue(localVal);
      if (localHash === hashValue(row.value)) {
        setMeta(key, { hash: localHash, syncedAt: row.updated_at, localChangedAt: "", remoteDeleted: false });
        continue;
      }
      if (!m) {
        plan.toRemote.push({ key, value: localVal, deleted: false }); // first link: local wins
        setMeta(key, { hash: localHash, syncedAt: now, localChangedAt: changedAt(key, m), remoteDeleted: false });
        continue;
      }
      const localTouched = localHash !== m.hash;
      const remoteTouched = cmpTime(row.updated_at, m.syncedAt) > 0;
      if (localTouched && !remoteTouched) {
        plan.toRemote.push({ key, value: localVal, deleted: false });
        setMeta(key, { hash: localHash, syncedAt: now, localChangedAt: changedAt(key, m), remoteDeleted: false });
      } else if (remoteTouched && !localTouched) {
        plan.toLocal.push({ key, value: row.value });
        setMeta(key, { hash: hashValue(row.value), syncedAt: row.updated_at, localChangedAt: "", remoteDeleted: false });
      } else if (localTouched && remoteTouched) {
        if (changedAt(key, m) === "" || cmpTime(changedAt(key, m), row.updated_at) >= 0) {
          plan.toRemote.push({ key, value: localVal, deleted: false }); // tie/unknown: local wins
          setMeta(key, { hash: localHash, syncedAt: now, localChangedAt: changedAt(key, m), remoteDeleted: false });
        } else {
          plan.toLocal.push({ key, value: row.value });
          setMeta(key, { hash: hashValue(row.value), syncedAt: row.updated_at, localChangedAt: "", remoteDeleted: false });
        }
      } else {
        // Neither side moved yet values differ (reverted row?) — converge remote-ward.
        plan.toLocal.push({ key, value: row.value });
        setMeta(key, { hash: hashValue(row.value), syncedAt: row.updated_at, localChangedAt: "", remoteDeleted: false });
      }
      continue;
    }
  }
  return plan;
}

// ─── Backend (Supabase IO — injected for tests) ────────────────────────────

export interface SyncBackend {
  fetchRows: () => Promise<RemoteRow[]>;
  /** Upsert rows; returns the authoritative rows (server timestamps). */
  upsertRows: (rows: Array<{ key: string; value: string; deleted: boolean }>) => Promise<RemoteRow[]>;
}

export function createSupabaseBackend(): SyncBackend {
  return {
    fetchRows: async () => {
      const client = getSupabase();
      const { data, error } = await client
        .from("user_data")
        .select("key,value,updated_at,deleted");
      if (error) throw new Error(error.message);
      return (data ?? []) as RemoteRow[];
    },
    upsertRows: async (rows) => {
      if (rows.length === 0) return [];
      const client = getSupabase();
      const { data: session } = await client.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error("Not signed in");
      const stamped = new Date().toISOString();
      const { data, error } = await client
        .from("user_data")
        .upsert(
          rows.map((r) => ({
            user_id: userId,
            key: r.key,
            value: r.value,
            updated_at: stamped,
            deleted: r.deleted,
          })),
          { onConflict: "user_id,key" },
        )
        .select("key,value,updated_at,deleted");
      if (error) throw new Error(error.message);
      return (data ?? []) as RemoteRow[];
    },
  };
}

// ─── Applying plans ────────────────────────────────────────────────────────

function eventForKey(key: string): string | null {
  if (key === "chatui:sessions") return "chatui:sessions-changed";
  if (key.startsWith("chatui:messages:")) return "chatui:messages-changed";
  if (key === "chatui:providers") return "chatui:providers-changed";
  if (key === "chatui:settings") return "chatui:settings-changed";
  if (key === "chatui:agents") return "chatui:agents-changed";
  if (key === "chatui:projects") return "chatui:projects-changed";
  if (key === "chatui:schedules") return "chatui:schedules-changed";
  if (key === "chatui:workflows") return "chatui:workflows-changed";
  if (key.startsWith("chatui:mcp")) return "chatui:mcp-changed";
  return null;
}

function dispatchForKeys(keys: Iterable<string>): void {
  const events = new Set<string>();
  for (const key of keys) {
    const event = eventForKey(key);
    if (event) events.add(event);
  }
  for (const event of events) {
    try {
      window.dispatchEvent(new Event(event));
    } catch {
      // Headless/test runtimes without window.
    }
  }
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  deletedLocal: number;
  /** Deep-merged session/message keys (both sides contributed). */
  merged: string[];
}

/**
 * Full sync: pull everything, reconcile, apply locally, push the remainder.
 * Runs on sign-in (initial merge), on focus, and every minute while signed in.
 * Never throws — failures resolve as { error } so callers can toast and retry.
 */
export async function syncNow(
  backend: SyncBackend,
  localChangedAt: Map<string, string> = new Map(),
): Promise<SyncResult & { error?: string }> {
  const empty: SyncResult = { pushed: 0, pulled: 0, deletedLocal: 0, merged: [] };
  let rows: RemoteRow[];
  try {
    rows = await backend.fetchRows();
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : "Sync failed" };
  }
  const now = new Date().toISOString();
  const plan = planSync(readLocal(), rows, loadMeta(), now, localChangedAt);

  for (const { key, value } of plan.toLocal) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota pressure — the key stays stale locally; meta still advances so
      // we don't flap. The next successful write re-syncs by hash.
    }
  }
  for (const key of plan.deleteLocal) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore; same reasoning as above.
    }
  }

  const pushed = plan.toRemote;
  if (pushed.length > 0) {
    try {
      const authoritative = await backend.upsertRows(pushed);
      const serverTime = new Map(authoritative.map((r) => [r.key, r.updated_at]));
      for (const { key } of pushed) {
        const at = serverTime.get(key);
        if (at && plan.meta[key]) plan.meta[key].syncedAt = at;
      }
    } catch (err) {
      // Local applies above are already valid; report the push failure and
      // keep meta un-advanced for pushed keys so they retry next round.
      for (const { key } of pushed) delete plan.meta[key];
      saveMeta(plan.meta);
      dispatchForKeys([...plan.toLocal.map((t) => t.key), ...plan.deleteLocal]);
      return {
        pushed: 0,
        pulled: plan.toLocal.length,
        deletedLocal: plan.deleteLocal.length,
        merged: [],
        error: err instanceof Error ? err.message : "Sync failed",
      };
    }
  }
  saveMeta(plan.meta);
  dispatchForKeys([...plan.toLocal.map((t) => t.key), ...plan.deleteLocal]);

  const remoteKeys = new Set(rows.map((r) => r.key));
  const merged = plan.toRemote
    .filter((t) => isDeepMergeKey(t.key) && remoteKeys.has(t.key))
    .map((t) => t.key);
  void writeFileBackup();
  return {
    pushed: pushed.length,
    pulled: plan.toLocal.length,
    deletedLocal: plan.deleteLocal.length,
    merged,
  };
}

/**
 * Push-only fast path for the debounced "local changed" trigger: no fetch,
 * just upsert locally-dirty keys (and tombstones for locally-deleted ones).
 */
export async function pushDirty(
  backend: SyncBackend,
  localChangedAt: Map<string, string> = new Map(),
): Promise<{ pushed: number; error?: string }> {
  const local = readLocal();
  const meta = loadMeta();
  const dirty: Array<{ key: string; value: string; deleted: boolean }> = [];
  const keys = new Set<string>([...local.keys(), ...Object.keys(meta)]);
  for (const key of keys) {
    if (!isSyncedKey(key)) continue;
    const val = local.get(key) ?? null;
    const m = meta[key];
    if (val !== null) {
      if (!m || hashValue(val) !== m.hash) dirty.push({ key, value: val, deleted: false });
    } else if (m && m.hash !== MISSING && !m.remoteDeleted) {
      dirty.push({ key, value: "", deleted: true }); // locally deleted: tombstone
    }
  }
  if (dirty.length === 0) return { pushed: 0 };
  try {
    const authoritative = await backend.upsertRows(dirty);
    const serverTime = new Map(authoritative.map((r) => [r.key, r.updated_at]));
    const now = new Date().toISOString();
    for (const { key, value, deleted } of dirty) {
      meta[key] = {
        hash: deleted ? MISSING : hashValue(value),
        syncedAt: serverTime.get(key) ?? now,
        localChangedAt: localChangedAt.get(key) ?? meta[key]?.localChangedAt ?? "",
        remoteDeleted: deleted,
      };
    }
    saveMeta(meta);
    void writeFileBackup();
    return { pushed: dirty.length };
  } catch (err) {
    return { pushed: 0, error: err instanceof Error ? err.message : "Sync failed" };
  }
}

// ─── File backup ───────────────────────────────────────────────────────────

let lastBackupAt = 0;

/**
 * Mirror the full local dataset to JSON files under the app-data dir
 * (backups/latest.json + a daily snapshot). Best-effort and Tauri-only: on
 * web localStorage itself is the copy. Runs after every successful push/full
 * sync, at most once every 30s.
 */
export async function writeFileBackup(force = false): Promise<void> {
  if (!isTauri) return;
  const now = Date.now();
  if (!force && now - lastBackupAt < 30_000) return;
  lastBackupAt = now;
  try {
    const base = await chatUiBaseDir();
    if (!base) return;
    const payload = exportChatUiBackup();
    const day = new Date().toISOString().slice(0, 10);
    await invoke("write_text_file", { path: `${base}/backups/latest.json`, content: payload });
    await invoke("write_text_file", { path: `${base}/backups/backup-${day}.json`, content: payload });
  } catch {
    // Backup must never break sync or the UI.
  }
}

// ─── Manager (storage hook + timers) ───────────────────────────────────────

const PUSH_DEBOUNCE_MS = 2000;
const PULL_INTERVAL_MS = 60_000;

let storageHookInstalled = false;
const dirtySince = new Map<string, string>();
/** The live manager's push scheduler (replaced on every start/stop). */
let currentSchedulePush: (() => void) | null = null;

function installStorageHook(): void {
  if (storageHookInstalled) return;
  storageHookInstalled = true;
  const rawSet = localStorage.setItem.bind(localStorage);
  const rawRemove = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = (key: string, value: string) => {
    rawSet(key, value);
    if (isSyncedKey(key)) {
      dirtySince.set(key, new Date().toISOString());
      currentSchedulePush?.();
    }
  };
  localStorage.removeItem = (key: string) => {
    rawRemove(key);
    if (isSyncedKey(key)) {
      dirtySince.set(key, new Date().toISOString());
      currentSchedulePush?.();
    }
  };
}

/**
 * Start background sync for a signed-in user. Returns a stop function.
 * Local writes push (debounced 2s); a full pull-merge-push runs every minute
 * and on window focus. Safe to call once per signed-in session only — the
 * caller stops the previous manager on sign-out.
 */
export function startSyncManager(
  backend: SyncBackend,
  opts?: { onSync?: (result: SyncResult & { error?: string }) => void },
): () => void {
  let stopped = false;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;

  const fullSync = async () => {
    if (stopped || syncing) return;
    syncing = true;
    try {
      const result = await syncNow(backend, dirtySince);
      if (!stopped) {
        dirtySince.clear();
        opts?.onSync?.(result);
      }
    } finally {
      syncing = false;
    }
  };
  const schedulePush = () => {
    if (stopped) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      void (async () => {
        if (stopped || syncing) return;
        syncing = true;
        try {
          const { error } = await pushDirty(backend, dirtySince);
          if (!stopped) {
            if (!error) dirtySince.clear();
            opts?.onSync?.({ pushed: 0, pulled: 0, deletedLocal: 0, merged: [], error });
          }
        } finally {
          syncing = false;
        }
      })();
    }, PUSH_DEBOUNCE_MS);
  };

  installStorageHook();
  currentSchedulePush = schedulePush;
  const interval = setInterval(fullSync, PULL_INTERVAL_MS);
  const onFocus = () => void fullSync();
  window.addEventListener("focus", onFocus);
  void fullSync(); // initial pull-merge-push on start

  return () => {
    stopped = true;
    if (currentSchedulePush === schedulePush) currentSchedulePush = null;
    if (pushTimer) clearTimeout(pushTimer);
    clearInterval(interval);
    window.removeEventListener("focus", onFocus);
  };
}
