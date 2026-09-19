import { invoke } from "@tauri-apps/api/core";
import { getSupabase } from "@/lib/supabase";
import { trySetItem } from "./storage-pressure";
import {
  isBigKey,
  listBigKeys,
  readBigKey,
  removeBigKey,
  setBigStoreDirtyListener,
  writeBigKey,
} from "./idb-store";
import { chatUiBaseDir } from "@/lib/agent/sandbox";
import { isTauri } from "@/lib/platform";
import { exportChatUiBackup } from "@/lib/data-transfer";

// Cloud sync: local-first mirroring of localStorage to Supabase.
//
// Every tracked `chatui:*` key is mirrored to one row in the `user_data`
// table (see supabase/schema.sql), stored as plaintext. The local copy is
// always the live one — the app works fully offline and anonymous; the cloud
// copy only exists while signed in. Sync is per-key last-write-wins with
// tombstones, except sessions, message stores, and agents, which union-merge
// by record id so chats and agents from two devices combine instead of
// clobbering each other. (An earlier end-to-end-encrypted variant of this
// sync broke down whenever devices held different keys — rows were skipped
// as undecryptable and data silently stopped merging — so values now travel
// as plaintext; see isLegacyEnvelope for how old encrypted rows are handled.)
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
  "chatui:avatar-salts", // per-agent avatar salts — part of the agents' data
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
  "chatui:council-models",
  "chatui:update-settings",
  "chatui:skills:registry-url",
  "chatui:knowledge",
  "chatui:widgets-hidden",
];

// Local-only bookkeeping that must never travel, even though the prefixes
// above would otherwise catch some of it.
const SYNC_EXCLUDED = new Set([
  "chatui:sync:meta", // this file's own bookkeeping (also matches no prefix)
  "chatui:sync:key", // legacy E2E device key from the old encrypted sync — local-only, never travels
  "chatui:messages:recency", // quota-eviction index, meaningless elsewhere
  "chatui:mcp:migrated", // one-time migration flag
  "chatui:agents:paths-remapped", // one-time migration flag
  "chatui:sync:code-acknowledged", // legacy recovery-code ack flag
]);

export function isSyncedKey(key: string): boolean {
  if (SYNC_EXCLUDED.has(key)) return false;
  return SYNCED_PREFIXES.some((p) => key === p || key.startsWith(p));
}

// Sessions, message stores, and agents deep-merge (union by record id);
// every other tracked key syncs wholesale (last-write-wins).
function isDeepMergeKey(key: string): boolean {
  return (
    key === "chatui:sessions" ||
    key === "chatui:agents" ||
    key.startsWith("chatui:messages:")
  );
}

/**
 * "Blank" stored values: an empty string or an empty JSON literal. Feeds the
 * no-wipe guard in planSync — a blank cloud row never overwrites live data.
 */
function isEmptyValue(value: string): boolean {
  const t = value.trim();
  return t === "" || t === "[]" || t === "{}" || t === "null";
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

/**
 * Rows written by the old end-to-end encrypted sync (AES-256-GCM JSON
 * envelopes). Encryption has been removed, so these can never be read again —
 * they are dropped on pull (ciphertext must never land in local storage) and
 * this device's live plaintext overwrites them on push.
 */
function isLegacyEnvelope(value: string): boolean {
  if (!value.startsWith("{")) return false;
  try {
    const p = JSON.parse(value) as Partial<Record<"v" | "alg" | "iv" | "ct", unknown>>;
    return p.v === 1 && p.alg === "A256GCM" && typeof p.iv === "string" && typeof p.ct === "string";
  } catch {
    return false;
  }
}

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
  // Best-effort (evicts rebuildable caches under quota pressure): when the
  // write can't land, the next sync just re-detects changes by hash.
  trySetItem(META_KEY, JSON.stringify(meta));
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
  // Big keys (sessions, message stores) live in the IDB mirror — read them
  // last so the mirror wins over any localStorage straggler.
  for (const prefix of ["chatui:sessions", "chatui:messages:"]) {
    for (const key of listBigKeys(prefix)) {
      if (!isSyncedKey(key)) continue;
      const value = readBigKey(key);
      if (value !== null) out.set(key, value);
    }
  }
  return out;
}

/** Sync-apply one big key. Never throws — false keeps today's stale-key path. */
function tryWriteBigKey(key: string, value: string): boolean {
  try {
    writeBigKey(key, value, { dirty: false });
    return true;
  } catch {
    return false;
  }
}

// ─── Deep merge (sessions + message stores) ────────────────────────────────

export interface MergeSpec {
  idKey: string;
  timeKey: string;
  /** Fallback stamp when the primary is missing (legacy agents predate updatedAt). */
  fallbackTimeKey?: string;
}

function timeValue(t: unknown): number {
  if (typeof t === "string") {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof t === "number" && Number.isFinite(t)) return t;
  return 0;
}

function recordTime(record: Record<string, unknown>, spec: MergeSpec): number {
  const primary = timeValue(record[spec.timeKey]);
  if (primary > 0) return primary;
  if (spec.fallbackTimeKey) return timeValue(record[spec.fallbackTimeKey]);
  return 0;
}

/**
 * Union-merge two JSON arrays of records by id, per-record last-write-wins
 * (ties go local). Sessions merge by updatedAt, messages by timestamp,
 * agents by updatedAt (createdAt fallback for legacy records), so a chat or
 * agent created on device A and one created on device B both survive linking.
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
      other && recordTime(other, spec) > recordTime(rec, spec) ? other : rec,
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
  if (key === "chatui:agents") {
    return { idKey: "id", timeKey: "updatedAt", fallbackTimeKey: "createdAt" };
  }
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
 * - deep-merge keys (sessions, messages:*, agents): union by record id,
 *   always — chats and agents from both sides survive every sync, not just
 *   the first.
 * - other keys: per-key last-write-wins; unknown local timestamps and exact
 *   ties go to the local device (the active user's data wins). Ambiguous
 *   states fail closed toward local too: when neither side moved yet the
 *   values differ (stale meta), and whenever the remote value is blank but
 *   the local one isn't, the local value is pushed — a blank cloud row can
 *   never wipe providers or settings on connect.
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
      // No-wipe guard: a blank remote value never overwrites populated local
      // data. Explicit deletes travel as tombstones, so a blank row is
      // suspicious rather than authoritative — push the live local value.
      if (isEmptyValue(row.value) && !isEmptyValue(localVal)) {
        plan.toRemote.push({ key, value: localVal, deleted: false });
        setMeta(key, { hash: localHash, syncedAt: now, localChangedAt: changedAt(key, m), remoteDeleted: false });
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
        // Neither side moved yet values differ (stale meta or a reverted
        // row?) — the live local data wins; it is never silently replaced.
        plan.toRemote.push({ key, value: localVal, deleted: false });
        setMeta(key, { hash: localHash, syncedAt: now, localChangedAt: changedAt(key, m), remoteDeleted: false });
      }
      continue;
    }
  }
  return plan;
}

// ─── Backend (Supabase IO — injected for tests) ────────────────────────────

/** Row bookkeeping without the value — cheap enough to poll every interval. */
export interface ManifestRow {
  key: string;
  updated_at: string;
  deleted: boolean;
}

export interface SyncBackend {
  /** Every row's bookkeeping (no values) — the per-sync manifest. */
  fetchManifest: () => Promise<ManifestRow[]>;
  /** Values for the given keys only — never the whole table. */
  fetchRows: (keys: string[]) => Promise<RemoteRow[]>;
  /** Upsert rows; returns the authoritative rows (server timestamps). */
  upsertRows: (rows: Array<{ key: string; value: string; deleted: boolean }>) => Promise<RemoteRow[]>;
}

/** PostgREST `in` filters are part of the URL — keep batches URL-safe. */
const FETCH_BATCH = 50;

export function createSupabaseBackend(): SyncBackend {
  return {
    fetchManifest: async () => {
      const client = getSupabase();
      const { data, error } = await client
        .from("user_data")
        .select("key,updated_at,deleted");
      if (error) throw new Error(error.message);
      return (data ?? []) as ManifestRow[];
    },
    fetchRows: async (keys) => {
      if (keys.length === 0) return [];
      const client = getSupabase();
      const out: RemoteRow[] = [];
      for (let i = 0; i < keys.length; i += FETCH_BATCH) {
        const batch = keys.slice(i, i + FETCH_BATCH);
        const { data, error } = await client
          .from("user_data")
          .select("key,value,updated_at,deleted")
          .in("key", batch);
        if (error) throw new Error(error.message);
        out.push(...((data ?? []) as RemoteRow[]));
      }
      return out;
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

// ─── Realtime (Supabase postgres_changes) ──────────────────────────────────

/**
 * Subscribe to realtime `user_data` changes for the signed-in user. Every
 * changed row arrives WITH its value — applies need no fetch. Returns an
 * unsubscribe function. Requires the table to be in the supabase_realtime
 * publication (see supabase/schema.sql); when Realtime is unavailable this
 * resolves to a no-op unsubscribe and the interval poll stays the fallback.
 */
export function createRealtimeSubscription(
  onRow: (row: RemoteRow) => void,
): () => void {
  let closed = false;
  let channel: { unsubscribe: () => Promise<unknown> } | null = null;
  void (async () => {
    let client: ReturnType<typeof getSupabase>;
    try {
      client = getSupabase();
    } catch {
      return; // not configured — interval poll only
    }
    try {
      const { data } = await client.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid || closed) return;
      channel = client
        .channel(`user-data-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_data", filter: `user_id=eq.${uid}` },
          (payload: { eventType: string; new: Record<string, unknown> | null }) => {
            // Upserts fire INSERT (new row) or UPDATE; deletes travel as
            // UPDATE tombstones. Plain DELETE events carry no new row.
            if (payload.eventType === "DELETE") return;
            const next = payload.new;
            if (
              !next ||
              typeof next.key !== "string" ||
              typeof next.value !== "string" ||
              typeof next.updated_at !== "string"
            ) {
              return;
            }
            onRow({
              key: next.key,
              value: next.value,
              updated_at: next.updated_at,
              deleted: next.deleted === true,
            });
          },
        )
        .subscribe();
    } catch {
      // Realtime unavailable — interval poll covers it.
    }
  })();
  return () => {
    closed = true;
    if (channel) void channel.unsubscribe();
  };
}

// ─── Applying plans ────────────────────────────────────────────────────────

function eventForKey(key: string): string | null {
  if (key === "chatui:sessions") return "chatui:sessions-changed";
  if (key.startsWith("chatui:messages:")) return "chatui:messages-changed";
  if (key === "chatui:providers") return "chatui:providers-changed";
  if (key === "chatui:settings") return "chatui:settings-changed";
  if (key === "chatui:agents") return "chatui:agents-changed";
  // Avatars render wherever agents render, so salt pulls re-render those lists.
  if (key === "chatui:avatar-salts") return "chatui:agents-changed";
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
  /** Deep-merged keys (sessions, messages, agents — both sides contributed). */
  merged: string[];
  /** Keys whose cloud rows are still old encrypted envelopes: never pulled;
   * this device's local data overwrites them on push. */
  legacyEncrypted: string[];
}

/**
 * Full sync: pull everything, reconcile, apply locally, push the remainder.
 * Runs on sign-in (initial merge), on focus, and every few minutes while
 * signed in (realtime covers instant updates between polls). Egress-frugal:
 * the poll first fetches a value-less manifest, then downloads values only
 * for rows that moved since the last reconcile — unchanged data is neither
 * downloaded nor re-uploaded. Never throws — failures resolve as { error }
 * so callers can toast and retry.
 */
export async function syncNow(
  backend: SyncBackend,
  localChangedAt: Map<string, string> = new Map(),
): Promise<SyncResult & { error?: string }> {
  const empty: SyncResult = { pushed: 0, pulled: 0, deletedLocal: 0, merged: [], legacyEncrypted: [] };
  let manifest: ManifestRow[];
  try {
    manifest = await backend.fetchManifest();
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : "Sync failed" };
  }
  const local = readLocal();
  const meta = loadMeta();

  // Keys whose remote row moved since we last reconciled it (or that we have
  // never reconciled). Tombstones need no value fetch; everything else does.
  // Locally-deleted keys with un-acked tombstones count as moved too — their
  // rows must reach planSync so the delete wins (or the row resurrects).
  const pendingLocalDeletes = new Set(
    Object.entries(meta)
      .filter(([key, m]) => !local.has(key) && m.hash !== MISSING && !m.remoteDeleted && isSyncedKey(key))
      .map(([key]) => key),
  );
  const moved = manifest.filter((r) => {
    if (!isSyncedKey(r.key)) return false;
    if (r.deleted) return true;
    const m = meta[r.key];
    return !m || cmpTime(r.updated_at, m.syncedAt) > 0 || pendingLocalDeletes.has(r.key);
  });
  let valueRows: RemoteRow[];
  try {
    valueRows = await backend.fetchRows(moved.filter((r) => !r.deleted).map((r) => r.key));
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : "Sync failed" };
  }
  const byKey = new Map(valueRows.map((r) => [r.key, r]));
  // Drop legacy encrypted rows from the pull: the old E2E envelopes are
  // unreadable, and planning against them would write ciphertext into local
  // storage. planSync then sees no remote row for those keys and pushes this
  // device's live plaintext over the envelope (when local data exists).
  const remote: RemoteRow[] = [];
  const legacyEncrypted: string[] = [];
  for (const r of moved) {
    if (r.deleted) {
      remote.push({ key: r.key, value: "", updated_at: r.updated_at, deleted: true });
      continue;
    }
    const full = byKey.get(r.key);
    if (!full) continue; // vanished between manifest and fetch — next round
    if (isLegacyEnvelope(full.value)) {
      legacyEncrypted.push(r.key);
      continue;
    }
    remote.push(full);
  }

  // Plan only over keys that can act: moved remote keys ∪ locally-dirty keys.
  // Unchanged keys stay out entirely — their values are never downloaded and
  // never re-uploaded.
  const include = new Set<string>(remote.map((r) => r.key));
  for (const [key, val] of local) {
    const m = meta[key];
    if (!m || hashValue(val) !== m.hash) include.add(key);
  }
  for (const [key, m] of Object.entries(meta)) {
    if (!local.has(key) && (m.hash !== MISSING || m.remoteDeleted)) include.add(key);
  }
  const now = new Date().toISOString();
  return reconcile(backend, remote, local, meta, now, localChangedAt, include, legacyEncrypted);
}

/**
 * Apply a batch of realtime rows through the same reconcile path as a full
 * sync (values ride in the events — no fetch), so merges propagate: device A
 * merges and pushes the union, device B merges that and pushes back its own
 * unique records.
 */
export async function syncRows(
  backend: SyncBackend,
  rows: RemoteRow[],
  localChangedAt: Map<string, string> = new Map(),
): Promise<SyncResult & { error?: string }> {
  const empty: SyncResult = { pushed: 0, pulled: 0, deletedLocal: 0, merged: [], legacyEncrypted: [] };
  const usable = rows.filter((r) => isSyncedKey(r.key) && !(r.deleted === false && isLegacyEnvelope(r.value)));
  if (usable.length === 0) return empty;
  const local = readLocal();
  const meta = loadMeta();
  const include = new Set<string>(usable.map((r) => r.key));
  // Only locally-changed keys join the plan (deletions ride pushDirty) —
  // concurrent local edits reconcile by LWW instead of being clobbered.
  for (const [key, val] of local) {
    const m = meta[key];
    if (!m || hashValue(val) !== m.hash) include.add(key);
  }
  return reconcile(backend, usable, local, meta, new Date().toISOString(), localChangedAt, include, []);
}

/**
 * Reconcile the given remote rows against the local subset (remote keys +
 * locally-dirty keys), apply locally, push the remainder. `include` bounds
 * the plan: keys outside it keep their meta untouched — that's what makes
 * unchanged data free.
 */
async function reconcile(
  backend: SyncBackend,
  remote: RemoteRow[],
  local: Map<string, string>,
  meta: SyncMeta,
  now: string,
  localChangedAt: Map<string, string>,
  include: Set<string>,
  legacyEncrypted: string[],
): Promise<SyncResult & { error?: string }> {
  const localSub = new Map([...local].filter(([k]) => include.has(k)));
  const metaSub: SyncMeta = {};
  for (const key of include) {
    if (meta[key]) metaSub[key] = meta[key];
  }
  const plan = planSync(localSub, remote, metaSub, now, localChangedAt);

  for (const { key, value } of plan.toLocal) {
    // trySetItem evicts rebuildable caches under quota pressure first.
    const ok = isBigKey(key) ? tryWriteBigKey(key, value) : trySetItem(key, value);
    if (!ok) {
      // Quota pressure — the key stays stale locally; meta still advances so
      // we don't flap. The next successful write re-syncs by hash.
    }
  }
  for (const key of plan.deleteLocal) {
    try {
      if (isBigKey(key)) removeBigKey(key, { dirty: false });
      else localStorage.removeItem(key);
    } catch {
      // Ignore; same reasoning as above.
    }
  }

  // plan.meta only covers the subset — overlay it on the untouched rest.
  const fullMeta: SyncMeta = { ...meta };
  for (const key of include) {
    if (plan.meta[key]) fullMeta[key] = plan.meta[key];
    else delete fullMeta[key];
  }

  const pushed = plan.toRemote;
  if (pushed.length > 0) {
    try {
      const authoritative = await backend.upsertRows(pushed);
      const serverTime = new Map(authoritative.map((r) => [r.key, r.updated_at]));
      for (const { key } of pushed) {
        const at = serverTime.get(key);
        if (at && fullMeta[key]) fullMeta[key].syncedAt = at;
      }
    } catch (err) {
      // Local applies above are already valid; report the push failure and
      // keep meta un-advanced for pushed keys so they retry next round.
      for (const { key } of pushed) delete fullMeta[key];
      saveMeta(fullMeta);
      dispatchForKeys([...plan.toLocal.map((t) => t.key), ...plan.deleteLocal]);
      return {
        pushed: 0,
        pulled: plan.toLocal.length,
        deletedLocal: plan.deleteLocal.length,
        merged: [],
        legacyEncrypted,
        error: err instanceof Error ? err.message : "Sync failed",
      };
    }
  }
  saveMeta(fullMeta);
  dispatchForKeys([...plan.toLocal.map((t) => t.key), ...plan.deleteLocal]);

  const remoteKeys = new Set(remote.map((r) => r.key));
  const merged = plan.toRemote
    .filter((t) => isDeepMergeKey(t.key) && remoteKeys.has(t.key))
    .map((t) => t.key);
  void writeFileBackup();
  return {
    pushed: pushed.length,
    pulled: plan.toLocal.length,
    deletedLocal: plan.deleteLocal.length,
    merged,
    legacyEncrypted,
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
/** Fallback poll — realtime events make instant sync; this catches gaps. */
const PULL_INTERVAL_MS = 300_000;
/** Batch burst of realtime events (one send touches several keys) into one reconcile. */
const REALTIME_BATCH_MS = 300;
/** Minimum gap between focus-triggered full syncs. */
const FOCUS_SYNC_THROTTLE_MS = 60_000;

let storageHookInstalled = false;
const dirtySince = new Map<string, string>();
/** The live manager's push scheduler (replaced on every start/stop). */
let currentSchedulePush: (() => void) | null = null;
/**
 * Suspended during local-data reset wipes: cleared keys must pass through to
 * raw storage WITHOUT dirty-marking or scheduling pushes, or the wipe would
 * upload tombstones and delete the cloud copy too.
 */
let hookSuspended = false;

/** Suspend/resume sync dirty-tracking (see hookSuspended). */
export function setStorageHookSuspended(suspended: boolean): void {
  hookSuspended = suspended;
}

/**
 * Mark a key locally-dirty from anywhere — the storage hook below and the
 * IDB mirror, which the hook can't see. Honors suspension (local reset).
 */
export function markSyncedKeyDirty(key: string): void {
  if (hookSuspended || !isSyncedKey(key)) return;
  dirtySince.set(key, new Date().toISOString());
  currentSchedulePush?.();
}

setBigStoreDirtyListener(markSyncedKeyDirty);

function installStorageHook(): void {
  if (storageHookInstalled) return;
  storageHookInstalled = true;
  const rawSet = localStorage.setItem.bind(localStorage);
  const rawRemove = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = (key: string, value: string) => {
    rawSet(key, value);
    markSyncedKeyDirty(key);
  };
  localStorage.removeItem = (key: string) => {
    rawRemove(key);
    markSyncedKeyDirty(key);
  };
}

/**
 * Start background sync for a signed-in user. Returns a stop function.
 * Local writes push (debounced 2s); realtime events apply as they arrive
 * (batched 300ms); a manifest-based pull-merge-push runs every few minutes
 * and on window focus as the fallback. Safe to call once per signed-in
 * session only — the caller stops the previous manager on sign-out.
 */
export function startSyncManager(
  backend: SyncBackend,
  opts?: {
    onSync?: (result: SyncResult & { error?: string; pushOnly?: boolean }) => void;
    /** Realtime row feed (e.g. createRealtimeSubscription). Rows already
     * carry their values — applied through the reconcile path directly. */
    subscribeChanges?: (onRow: (row: RemoteRow) => void) => () => void;
  },
): () => void {
  let stopped = false;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;
  let lastFullSyncAt = 0;

  const fullSync = async (force = false) => {
    if (stopped || syncing) return;
    // Focus can fire in bursts (cmd-tab round-trips) — the manifest fetch is
    // small, but there's no reason to repeat it more than once a minute.
    if (!force && Date.now() - lastFullSyncAt < FOCUS_SYNC_THROTTLE_MS) return;
    lastFullSyncAt = Date.now();
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
            opts?.onSync?.({ pushed: 0, pulled: 0, deletedLocal: 0, merged: [], legacyEncrypted: [], error, pushOnly: true });
          }
        } finally {
          syncing = false;
        }
      })();
    }, PUSH_DEBOUNCE_MS);
  };

  // Realtime feed: batch incoming rows for a moment (one send touches
  // several keys), skip own echoes (already-recorded server timestamps),
  // then reconcile the batch — pull AND push, so merges propagate.
  const pendingRealtime = new Map<string, RemoteRow>();
  let realtimeTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe =
    opts?.subscribeChanges?.((row) => {
      if (stopped || !isSyncedKey(row.key)) return;
      const m = loadMeta()[row.key];
      if (!row.deleted && m && cmpTime(row.updated_at, m.syncedAt) === 0) return;
      pendingRealtime.set(row.key, row);
      if (realtimeTimer) clearTimeout(realtimeTimer);
      realtimeTimer = setTimeout(() => {
        realtimeTimer = null;
        const rows = [...pendingRealtime.values()];
        pendingRealtime.clear();
        void (async () => {
          if (stopped || syncing) return;
          syncing = true;
          try {
            const result = await syncRows(backend, rows, dirtySince);
            if (!stopped) opts?.onSync?.(result);
          } finally {
            syncing = false;
          }
        })();
      }, REALTIME_BATCH_MS);
    }) ?? null;

  installStorageHook();
  currentSchedulePush = schedulePush;
  const interval = setInterval(() => void fullSync(true), PULL_INTERVAL_MS);
  const onFocus = () => void fullSync();
  window.addEventListener("focus", onFocus);
  void fullSync(true); // initial pull-merge-push on start

  return () => {
    stopped = true;
    unsubscribe?.();
    if (realtimeTimer) clearTimeout(realtimeTimer);
    if (currentSchedulePush === schedulePush) currentSchedulePush = null;
    if (pushTimer) clearTimeout(pushTimer);
    clearInterval(interval);
    window.removeEventListener("focus", onFocus);
  };
}
