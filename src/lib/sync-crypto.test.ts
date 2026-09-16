import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeRecoveryCode,
  decryptFromSync,
  encryptForSync,
  exportSyncRecoveryCode,
  hasSyncKey,
  importSyncRecoveryCode,
  isRecoveryCodeAcknowledged,
  isSyncEnvelope,
  shouldPromptRecoveryCodeSave,
} from "./sync-crypto";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sync-crypto", () => {
  it("round-trips values, including unicode and empty strings", async () => {
    for (const plain of [
      '{"id":"p1","apiKey":"sk-secret"}',
      "héllo wörld 🔐",
      "",
      "x".repeat(100_000),
    ]) {
      const envelope = await encryptForSync(plain);
      expect(isSyncEnvelope(envelope)).toBe(true);
      expect(envelope).not.toContain("sk-secret");
      expect(await decryptFromSync(envelope)).toBe(plain);
    }
  });

  it("uses a fresh random IV per encryption", async () => {
    const a = await encryptForSync("same");
    const b = await encryptForSync("same");
    expect(a).not.toBe(b);
    expect(await decryptFromSync(a)).toBe("same");
    expect(await decryptFromSync(b)).toBe("same");
  });

  it("rejects envelopes opened with a different key", async () => {
    const envelope = await encryptForSync("precious");
    await importSyncRecoveryCode(
      Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
    );
    await expect(decryptFromSync(envelope)).rejects.toThrow(/different sync key/);
  });

  it("rejects tampered envelopes", async () => {
    const envelope = await encryptForSync("precious");
    const tampered = envelope.slice(0, -5) + (envelope.endsWith("A") ? "BBB\"}" : "AAA\"}");
    expect(isSyncEnvelope(tampered)).toBe(true);
    await expect(decryptFromSync(tampered)).rejects.toThrow(/different sync key/);
  });

  it("detects envelopes but never legacy plaintext", () => {
    expect(isSyncEnvelope('{"a":1}')).toBe(false);
    expect(isSyncEnvelope("[]")).toBe(false);
    expect(isSyncEnvelope("not json")).toBe(false);
    expect(isSyncEnvelope("")).toBe(false);
    expect(isSyncEnvelope('{"v":1,"alg":"A256GCM","iv":"x"}')).toBe(false); // missing ct
  });

  it("exports a recovery code that restores decryption on a fresh device", async () => {
    const envelope = await encryptForSync("precious");
    const code = await exportSyncRecoveryCode();
    expect(code.replace(/\s+/g, "")).toHaveLength(44);
    // A fresh device holds only the code: wipe everything, import, decrypt.
    storage.clear();
    expect(hasSyncKey()).toBe(false);
    await importSyncRecoveryCode(code);
    expect(hasSyncKey()).toBe(true);
    expect(await decryptFromSync(envelope)).toBe("precious");
  });

  it("rejects malformed recovery codes without touching the stored key", async () => {
    await encryptForSync("x"); // generate a key
    const before = storage.get("chatui:sync:key");
    for (const bad of ["", "hello", "AAAA", "x".repeat(44)]) {
      await expect(importSyncRecoveryCode(bad)).rejects.toThrow(/recovery code/);
    }
    expect(storage.get("chatui:sync:key")).toBe(before);
  });

  it("fails closed on a corrupt stored key instead of silently rekeying", async () => {
    storage.set("chatui:sync:key", "definitely-not-base64!!!");
    await expect(encryptForSync("x")).rejects.toThrow(/corrupt/);
  });

  it("reports a full store distinctly so sync can explain the pause", async () => {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
      removeItem: (k: string) => void storage.delete(k),
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size;
      },
    });
    await expect(encryptForSync("x")).rejects.toThrow(/device storage is full/i);
    await expect(
      importSyncRecoveryCode("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
    ).rejects.toThrow(/device storage is full/i);
  });
});

describe("recovery-code save prompt", () => {
  it("importing a code acks it (pasting proves the user holds it)", async () => {
    expect(isRecoveryCodeAcknowledged()).toBe(false);
    await importSyncRecoveryCode("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    expect(isRecoveryCodeAcknowledged()).toBe(true);
  });

  it("rejects malformed codes without acking", async () => {
    await expect(importSyncRecoveryCode("hello")).rejects.toThrow(/recovery code/);
    expect(isRecoveryCodeAcknowledged()).toBe(false);
  });

  it("exporting alone does not ack; explicit confirmation does", async () => {
    await exportSyncRecoveryCode();
    expect(isRecoveryCodeAcknowledged()).toBe(false);
    acknowledgeRecoveryCode();
    expect(isRecoveryCodeAcknowledged()).toBe(true);
  });

  it("prompts only on clean full syncs with an unacked key", async () => {
    await encryptForSync("x"); // generate a key
    const clean = { undecryptable: [] as string[] };
    expect(shouldPromptRecoveryCodeSave(clean)).toBe(true);
    // Push-only results never fetched: their empty list proves nothing.
    expect(shouldPromptRecoveryCodeSave({ ...clean, pushOnly: true })).toBe(false);
    // Errors leave the key state unknown.
    expect(shouldPromptRecoveryCodeSave({ ...clean, error: "boom" })).toBe(false);
    // Undecryptable rows mean this device holds the WRONG key — the
    // enter-the-code banner owns that case, never the save prompt.
    expect(
      shouldPromptRecoveryCodeSave({ undecryptable: ["chatui:settings"] }),
    ).toBe(false);
    acknowledgeRecoveryCode();
    expect(shouldPromptRecoveryCodeSave(clean)).toBe(false);
  });

  it("never prompts before a key exists", () => {
    expect(hasSyncKey()).toBe(false);
    expect(shouldPromptRecoveryCodeSave({ undecryptable: [] })).toBe(false);
  });
});
