// End-to-end encryption for cloud sync.
//
// Every value pushed to Supabase is an AES-256-GCM envelope (JSON text, so the
// `user_data.value` column needs no schema change). The 256-bit device key is
// generated on first sync and lives ONLY in local-only localStorage
// (`chatui:sync:key`, explicitly excluded from sync) — the server, its admins,
// and anyone reading the database see opaque ciphertext. A second device joins
// by importing the recovery code (Account → Data); rows it cannot decrypt are
// skipped fail-closed (never pulled, never overwritten) until then.
//
// Rows written before encryption shipped are legacy plaintext: pulls accept
// them as-is and the next sync re-pushes them encrypted (see sync.ts).
import { trySetItem } from "./storage-pressure";

const SYNC_KEY_STORAGE = "chatui:sync:key";
/** Local-only flag (excluded from sync): the user confirmed saving the code. */
const SYNC_CODE_ACK = "chatui:sync:code-acknowledged";

const ENVELOPE_VERSION = 1;
const ENVELOPE_ALG = "A256GCM";

interface SyncEnvelope {
  v: 1;
  alg: "A256GCM";
  iv: string;
  ct: string;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) {
    throw new Error("Sync encryption needs WebCrypto (crypto.subtle), which is unavailable here");
  }
  return s;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The stored key, or null when none was ever created. A present-but-corrupt
 * key throws (fail closed: silently generating a fresh key would orphan every
 * encrypted cloud row instead of surfacing the recovery-code fix).
 */
function readStoredKey(): string | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SYNC_KEY_STORAGE);
  } catch {
    throw new Error("The sync key is unreadable (storage unavailable)");
  }
  if (!raw) return null;
  try {
    if (base64ToBytes(raw).length !== 32) throw new Error("bad length");
  } catch {
    throw new Error("The sync key on this device is corrupt — re-enter your recovery code in Settings → Account → Data");
  }
  return raw;
}

let cachedRaw: string | null = null;
let cachedKey: CryptoKey | null = null;

/** Load the device key, generating + persisting it on first use. */
export async function getSyncKey(): Promise<CryptoKey> {
  let raw = readStoredKey();
  if (!raw) {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    raw = bytesToBase64(bytes);
    // Local-only key (excluded from sync, so this write never uploads itself
    // or schedules a push). Included in local file backups + data exports so
    // a restore keeps the cloud rows decryptable.
    if (!trySetItem(SYNC_KEY_STORAGE, raw)) {
      throw new Error(
        "Device storage is full — the sync encryption key couldn't be saved, so cloud sync is paused.",
      );
    }
  }
  if (cachedKey && cachedRaw === raw) return cachedKey;
  const key = await subtle().importKey("raw", base64ToBytes(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  cachedRaw = raw;
  cachedKey = key;
  return key;
}

export function isSyncEnvelope(value: string): boolean {
  if (value.length < 40 || value[0] !== "{") return false;
  try {
    const parsed = JSON.parse(value) as Partial<SyncEnvelope> | null;
    return (
      parsed?.v === ENVELOPE_VERSION &&
      parsed?.alg === ENVELOPE_ALG &&
      typeof parsed?.iv === "string" &&
      typeof parsed?.ct === "string"
    );
  } catch {
    return false;
  }
}

/** Encrypt one localStorage value into a JSON envelope for upload. */
export async function encryptForSync(plaintext: string): Promise<string> {
  const key = await getSyncKey();
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const envelope: SyncEnvelope = {
    v: ENVELOPE_VERSION,
    alg: ENVELOPE_ALG,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ct)),
  };
  return JSON.stringify(envelope);
}

/** Decrypt a pulled envelope back to the localStorage string. Throws when the
 * value isn't an envelope or this device's key can't open it. */
export async function decryptFromSync(envelope: string): Promise<string> {
  let parsed: Partial<SyncEnvelope> | null = null;
  try {
    parsed = JSON.parse(envelope) as Partial<SyncEnvelope>;
  } catch {
    parsed = null;
  }
  if (
    !parsed ||
    parsed.v !== ENVELOPE_VERSION ||
    parsed.alg !== ENVELOPE_ALG ||
    typeof parsed.iv !== "string" ||
    typeof parsed.ct !== "string"
  ) {
    throw new Error("Not a sync envelope");
  }
  const key = await getSyncKey();
  try {
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
      key,
      base64ToBytes(parsed.ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("Couldn't decrypt a synced value — this device has a different sync key");
  }
}

/** Raw (unstyled) presence check for UI gating; use export/import for the rest. */
export function hasSyncKey(): boolean {
  try {
    return localStorage.getItem(SYNC_KEY_STORAGE) !== null;
  } catch {
    return false;
  }
}

/** The recovery code for this device's key (grouped for readability). */
export async function exportSyncRecoveryCode(): Promise<string> {
  // getSyncKey would also work, but the export needs the raw bytes, not the
  // CryptoKey handle (imported non-extractable on purpose).
  const raw = readStoredKey();
  if (raw) return raw.replace(/(.{4})/g, "$1 ").trim();
  await getSyncKey(); // first use: generate, then export what was stored
  const created = readStoredKey();
  if (!created) throw new Error("Couldn't persist the sync key (storage unavailable)");
  return created.replace(/(.{4})/g, "$1 ").trim();
}

/** Whether the user confirmed saving this device's recovery code. */
export function isRecoveryCodeAcknowledged(): boolean {
  try {
    return localStorage.getItem(SYNC_CODE_ACK) === "1";
  } catch {
    return false;
  }
}

/** Persist the "I've saved it" confirmation. Never throws. */
export function acknowledgeRecoveryCode(): void {
  trySetItem(SYNC_CODE_ACK, "1");
}

/**
 * Whether a sync result should pop the "save your recovery code" dialog.
 * Structural param (not SyncResult) so this module stays importable from
 * sync.ts without a cycle.
 *
 * Three suppressions, all load-bearing:
 * - push-only results never fetched, so their empty undecryptable list proves
 *   nothing — prompting on them would bless a key the cloud can't open.
 * - errors leave the key state unknown.
 * - any undecryptable row means this device holds the WRONG key: the banner
 *   (enter the other device's code) owns that case, and prompting to save
 *   this key could orphan the cloud rows if the user applies it backwards.
 */
export function shouldPromptRecoveryCodeSave(result: {
  pushOnly?: boolean;
  error?: string;
  undecryptable: readonly string[];
}): boolean {
  if (result.pushOnly || result.error || result.undecryptable.length > 0) {
    return false;
  }
  if (!hasSyncKey()) return false;
  return !isRecoveryCodeAcknowledged();
}

/** Adopt another device's key from its recovery code (whitespace ignored). */
export async function importSyncRecoveryCode(code: string): Promise<void> {
  const compact = code.replace(/\s+/g, "");
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(compact);
  } catch {
    throw new Error("That doesn't look like a sync recovery code");
  }
  if (bytes.length !== 32 || compact.length === 0) {
    throw new Error("That doesn't look like a sync recovery code");
  }
  if (!trySetItem(SYNC_KEY_STORAGE, bytesToBase64(bytes))) {
    throw new Error("Device storage is full — free up space, then enter the recovery code again.");
  }
  cachedRaw = null;
  cachedKey = null;
  // Pasting a code proves the user holds it — no "save your code" prompt.
  // Best-effort: if this write fails the prompt just shows the (correct) code again.
  trySetItem(SYNC_CODE_ACK, "1");
}
