import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmpTime,
  hashValue,
  isSyncedKey,
  mergeRecordLists,
  planSync,
  pushDirty,
  syncNow,
  type RemoteRow,
  type SyncBackend,
  type SyncMeta,
} from "./sync";
import { decryptFromSync, encryptForSync, importSyncRecoveryCode, isSyncEnvelope } from "./sync-crypto";

// The vitest environment is node — stub storage and window like a browser.
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
  vi.stubGlobal("window", { dispatchEvent: () => true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function row(key: string, value: string, updated_at: string, deleted = false): RemoteRow {
  return { key, value, updated_at, deleted };
}

function metaFor(entries: Record<string, Partial<{ hash: string; syncedAt: string; localChangedAt: string; remoteDeleted: boolean }>>): SyncMeta {
  return Object.fromEntries(
    Object.entries(entries).map(([k, v]) => [
      k,
      { hash: "", syncedAt: "", localChangedAt: "", remoteDeleted: false, ...v },
    ]),
  );
}

describe("isSyncedKey", () => {
  it("syncs user data, never local bookkeeping", () => {
    for (const k of [
      "chatui:sessions",
      "chatui:messages:abc",
      "chatui:providers",
      "chatui:settings",
      "chatui:agents",
      "chatui:avatar-salts",
      "chatui:projects",
      "chatui:schedules",
      "chatui:workflows",
      "chatui:memory:global",
      "chatui:mcp",
      "chatui:mcp:usage",
      "chatui:skills:custom",
      "chatui:learn-mode",
      "chatui:tavily-key",
      "chatui:council-models",
      "chatui:update-settings",
      "chatui:skills:registry-url",
      "chatui:knowledge:sweeps",
      "chatui:knowledge:captions",
      "chatui:widgets-hidden-chat",
      "chatui:widgets-hidden",
    ]) {
      expect(isSyncedKey(k)).toBe(true);
    }
    for (const k of [
      "chatui:onboarding",
      "chatui:sync:meta",
      "chatui:sync:key",
      "chatui:messages:recency",
      "chatui:mcp:migrated",
      "chatui:agents:paths-remapped",
      "chatui:modelsdev-cache",
      "chatui:skills:registry",
      "chatui:skills:auto-install-skipped",
      "unrelated",
    ]) {
      expect(isSyncedKey(k)).toBe(false);
    }
  });
});

describe("cmpTime", () => {
  it("compares across ISO spellings; empty is oldest", () => {
    expect(cmpTime("2026-09-15T12:00:00.000Z", "2026-09-15T12:00:00.000000+00:00")).toBe(0);
    expect(cmpTime("2026-09-15T12:00:01Z", "2026-09-15T12:00:00.999999+00:00")).toBe(1);
    expect(cmpTime("", "2026-09-15T12:00:00Z")).toBe(-1);
    expect(cmpTime("not-a-date", "")).toBe(0);
  });
});

describe("mergeRecordLists", () => {
  const spec = { idKey: "id", timeKey: "updatedAt" };

  it("unions by id with per-record last-write-wins", () => {
    const local = JSON.stringify([
      { id: "a", title: "A local", updatedAt: "2026-09-15T12:00:00Z" },
      { id: "b", title: "B local", updatedAt: "2026-09-15T10:00:00Z" },
    ]);
    const remote = JSON.stringify([
      { id: "b", title: "B remote", updatedAt: "2026-09-15T11:00:00Z" },
      { id: "c", title: "C remote", updatedAt: "2026-09-15T09:00:00Z" },
    ]);
    expect(JSON.parse(mergeRecordLists(local, remote, spec))).toEqual([
      { id: "a", title: "A local", updatedAt: "2026-09-15T12:00:00Z" },
      { id: "b", title: "B remote", updatedAt: "2026-09-15T11:00:00Z" },
      { id: "c", title: "C remote", updatedAt: "2026-09-15T09:00:00Z" },
    ]);
  });

  it("breaks ties toward local and keeps local on corrupt input", () => {
    const rec = { id: "a", title: "same", updatedAt: "2026-09-15T12:00:00Z" };
    expect(mergeRecordLists(JSON.stringify([rec]), JSON.stringify([rec]), spec)).toBe(
      JSON.stringify([rec]),
    );
    expect(mergeRecordLists("local-string", "{bad json", spec)).toBe("local-string");
    expect(mergeRecordLists("{bad json", JSON.stringify([rec]), spec)).toBe("{bad json");
  });
});

describe("planSync", () => {
  const NOW = "2026-09-15T12:00:00.000Z";

  it("is empty when everything matches", () => {
    const local = new Map([["chatui:settings", '{"a":1}']]);
    const remote = [row("chatui:settings", '{"a":1}', "2026-09-15T11:00:00Z")];
    const plan = planSync(local, remote, {}, NOW);
    expect(plan.toLocal).toEqual([]);
    expect(plan.toRemote).toEqual([]);
    expect(plan.deleteLocal).toEqual([]);
    expect(plan.meta["chatui:settings"].syncedAt).toBe("2026-09-15T11:00:00Z");
  });

  it("pushes new local keys and pulls new remote keys", () => {
    const local = new Map([["chatui:settings", '{"a":1}']]);
    const remote = [row("chatui:projects", "[]", "2026-09-15T11:00:00Z")];
    const plan = planSync(local, remote, {}, NOW);
    expect(plan.toRemote).toEqual([{ key: "chatui:settings", value: '{"a":1}', deleted: false }]);
    expect(plan.toLocal).toEqual([{ key: "chatui:projects", value: "[]" }]);
  });

  it("pushes locally-touched keys and pulls remotely-touched keys", () => {
    const local = new Map([
      ["chatui:settings", '{"a":2}'],
      ["chatui:projects", "[]"],
    ]);
    const remote = [
      row("chatui:settings", '{"a":1}', "2026-09-15T10:00:00Z"),
      row("chatui:projects", '[{"id":"p"}]', "2026-09-15T11:00:00Z"),
    ];
    const meta = metaFor({
      "chatui:settings": { hash: hashValue('{"a":1}'), syncedAt: "2026-09-15T10:00:00Z" },
      "chatui:projects": { hash: hashValue("[]"), syncedAt: "2026-09-15T10:00:00Z" },
    });
    const plan = planSync(local, remote, meta, NOW);
    expect(plan.toRemote.map((t) => t.key)).toEqual(["chatui:settings"]);
    expect(plan.toLocal.map((t) => t.key)).toEqual(["chatui:projects"]);
  });

  it("resolves double-touched keys by last-write-wins (unknown ties go local)", () => {
    const mk = (changedAt: Map<string, string>) =>
      planSync(
        new Map([["chatui:settings", '{"a":2}']]),
        [row("chatui:settings", '{"a":3}', "2026-09-15T11:00:00Z")],
        metaFor({ "chatui:settings": { hash: hashValue('{"a":1}'), syncedAt: "2026-09-15T10:00:00Z" } }),
        NOW,
        changedAt,
      );
    // Local write newer → push.
    const pushPlan = mk(new Map([["chatui:settings", "2026-09-15T11:30:00Z"]]));
    expect(pushPlan.toRemote).toHaveLength(1);
    expect(pushPlan.toLocal).toHaveLength(0);
    // Remote write newer → pull.
    const pullPlan = mk(new Map([["chatui:settings", "2026-09-15T10:30:00Z"]]));
    expect(pullPlan.toLocal).toHaveLength(1);
    expect(pullPlan.toRemote).toHaveLength(0);
    // Unknown local time → local wins.
    const unknownPlan = mk(new Map());
    expect(unknownPlan.toRemote).toHaveLength(1);
  });

  it("first link with a scalar conflict keeps local", () => {
    const plan = planSync(
      new Map([["chatui:settings", '{"local":true}']]),
      [row("chatui:settings", '{"remote":true}', "2026-09-15T11:00:00Z")],
      {},
      NOW,
    );
    expect(plan.toRemote).toEqual([{ key: "chatui:settings", value: '{"local":true}', deleted: false }]);
    expect(plan.toLocal).toEqual([]);
  });

  it("never pulls a blank remote value over populated local data", () => {
    // A newer but blank cloud row (e.g. a stale `[]` for providers) with
    // untouched-looking local data: local still wins — a blank row is never
    // authoritative. Explicit deletes travel as tombstones instead.
    const localVal = '[{"id":"p1","apiKey":"sk-x"}]';
    for (const blank of ["[]", "{}", "null", ""]) {
      const plan = planSync(
        new Map([["chatui:providers", localVal]]),
        [row("chatui:providers", blank, "2026-09-15T11:00:00Z")],
        metaFor({ "chatui:providers": { hash: hashValue(localVal), syncedAt: "2026-09-15T10:00:00Z" } }),
        NOW,
      );
      expect(plan.toLocal).toEqual([]);
      expect(plan.deleteLocal).toEqual([]);
      expect(plan.toRemote).toEqual([{ key: "chatui:providers", value: localVal, deleted: false }]);
    }
  });

  it("still pulls remote data when the local copy is blank", () => {
    // The guard only protects populated local data — a blank local copy is
    // hydrated from the cloud as usual.
    const remoteVal = '[{"id":"p1"}]';
    const plan = planSync(
      new Map([["chatui:providers", "[]"]]),
      [row("chatui:providers", remoteVal, "2026-09-15T11:00:00Z")],
      metaFor({ "chatui:providers": { hash: hashValue("[]"), syncedAt: "2026-09-15T10:00:00Z" } }),
      NOW,
    );
    expect(plan.toLocal).toEqual([{ key: "chatui:providers", value: remoteVal }]);
    expect(plan.toRemote).toEqual([]);
  });

  it("keeps local when neither side moved but values differ", () => {
    // Stale meta (syncedAt ahead of the row) with divergent values: the live
    // local data wins instead of being silently replaced.
    const plan = planSync(
      new Map([["chatui:settings", '{"a":2}']]),
      [row("chatui:settings", '{"a":1}', "2026-09-15T10:00:00Z")],
      metaFor({ "chatui:settings": { hash: hashValue('{"a":2}'), syncedAt: "2026-09-15T11:00:00Z" } }),
      NOW,
    );
    expect(plan.toLocal).toEqual([]);
    expect(plan.toRemote).toEqual([{ key: "chatui:settings", value: '{"a":2}', deleted: false }]);
  });

  it("propagates deletions as tombstones and honors remote deletes", () => {
    // Locally deleted, delete newer than the row → push tombstone.
    const tomb = planSync(
      new Map(),
      [row("chatui:projects", "[]", "2026-09-15T10:00:00Z")],
      metaFor({ "chatui:projects": { hash: hashValue("[]"), syncedAt: "2026-09-15T10:00:00Z" } }),
      NOW,
      new Map([["chatui:projects", "2026-09-15T11:00:00Z"]]),
    );
    expect(tomb.toRemote).toEqual([{ key: "chatui:projects", value: "", deleted: true }]);

    // Remote row newer than the local delete → resurrect locally.
    const resurrect = planSync(
      new Map(),
      [row("chatui:projects", '[{"id":"p"}]', "2026-09-15T12:00:00Z")],
      metaFor({ "chatui:projects": { hash: hashValue("[]"), syncedAt: "2026-09-15T10:00:00Z" } }),
      "2026-09-15T13:00:00.000Z",
      new Map([["chatui:projects", "2026-09-15T11:00:00Z"]]),
    );
    expect(resurrect.toLocal).toEqual([{ key: "chatui:projects", value: '[{"id":"p"}]' }]);

    // Remote tombstone, local untouched → delete locally.
    const honor = planSync(
      new Map([["chatui:projects", "[]"]]),
      [row("chatui:projects", "", "2026-09-15T11:00:00Z", true)],
      metaFor({ "chatui:projects": { hash: hashValue("[]"), syncedAt: "2026-09-15T10:00:00Z" } }),
      NOW,
    );
    expect(honor.deleteLocal).toEqual(["chatui:projects"]);

    // Remote tombstone but local edited after it → resurrect remotely.
    const undelete = planSync(
      new Map([["chatui:projects", '[{"id":"p"}]']]),
      [row("chatui:projects", "", "2026-09-15T10:30:00Z", true)],
      metaFor({ "chatui:projects": { hash: hashValue("[]"), syncedAt: "2026-09-15T10:00:00Z" } }),
      NOW,
      new Map([["chatui:projects", "2026-09-15T11:00:00Z"]]),
    );
    expect(undelete.toRemote).toEqual([
      { key: "chatui:projects", value: '[{"id":"p"}]', deleted: false },
    ]);
  });

  it("deep-merges sessions so chats from both sides survive", () => {
    const localSessions = JSON.stringify([
      { id: "a", title: "A", updatedAt: "2026-09-15T12:00:00Z" },
    ]);
    const remoteSessions = JSON.stringify([
      { id: "b", title: "B", updatedAt: "2026-09-15T11:00:00Z" },
    ]);
    const plan = planSync(
      new Map([["chatui:sessions", localSessions]]),
      [row("chatui:sessions", remoteSessions, "2026-09-15T11:00:00Z")],
      {},
      NOW,
    );
    expect(plan.toLocal).toHaveLength(1);
    expect(plan.toRemote).toHaveLength(1);
    const merged = JSON.parse(plan.toLocal[0].value) as Array<{ id: string }>;
    expect(merged.map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(plan.toRemote[0].value).toBe(plan.toLocal[0].value);
  });

  it("drops meta for keys that left the sync scope", () => {
    const plan = planSync(new Map(), [], { "chatui:onboarding": { hash: "x", syncedAt: "", localChangedAt: "", remoteDeleted: false } }, NOW);
    expect(plan.meta).toEqual({});
  });
});

describe("syncNow with a fake backend", () => {
  function fakeBackend(rows: RemoteRow[], opts?: { failPush?: boolean }): SyncBackend & { pushed: Array<{ key: string; value: string; deleted: boolean }> } {
    const pushed: Array<{ key: string; value: string; deleted: boolean }> = [];
    return {
      pushed,
      fetchRows: async () => rows,
      upsertRows: async (upserts) => {
        if (opts?.failPush) throw new Error("offline");
        pushed.push(...upserts);
        return upserts.map((u, i) => row(u.key, u.value, `2026-09-15T12:00:0${i}Z`, u.deleted));
      },
    };
  }

  it("pushes everything to an empty cloud on first link", async () => {
    storage.set("chatui:settings", '{"a":1}');
    storage.set("chatui:onboarding", '{"x":1}'); // not synced
    const backend = fakeBackend([]);
    const result = await syncNow(backend);
    expect(result.error).toBeUndefined();
    expect(result.pushed).toBe(1);
    expect(backend.pushed[0].key).toBe("chatui:settings");
    const meta = JSON.parse(storage.get("chatui:sync:meta") ?? "{}") as SyncMeta;
    expect(meta["chatui:settings"].syncedAt).toBe("2026-09-15T12:00:00Z"); // server time, not device
    expect(meta["chatui:onboarding"]).toBeUndefined();
  });

  it("pulls remote keys and fires change events", async () => {
    const seen: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event) => {
        seen.push(e.type);
        return true;
      },
    });
    const backend = fakeBackend([row("chatui:projects", "[]", "2026-09-15T11:00:00Z")]);
    const result = await syncNow(backend);
    expect(result.pulled).toBe(1);
    expect(storage.get("chatui:projects")).toBe("[]");
    expect(seen).toContain("chatui:projects-changed");
  });

  it("pulls agent avatar salts and notifies agent lists", async () => {
    const seen: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event) => {
        seen.push(e.type);
        return true;
      },
    });
    const backend = fakeBackend([row("chatui:avatar-salts", '{"a1":2}', "2026-09-15T11:00:00Z")]);
    const result = await syncNow(backend);
    expect(result.pulled).toBe(1);
    expect(storage.get("chatui:avatar-salts")).toBe('{"a1":2}');
    expect(seen).toContain("chatui:agents-changed");
  });

  it("merges sessions on first link instead of picking a side", async () => {
    storage.set(
      "chatui:sessions",
      JSON.stringify([{ id: "a", title: "A", updatedAt: "2026-09-15T12:00:00Z" }]),
    );
    const backend = fakeBackend([
      row(
        "chatui:sessions",
        JSON.stringify([{ id: "b", title: "B", updatedAt: "2026-09-15T11:00:00Z" }]),
        "2026-09-15T11:00:00Z",
      ),
    ]);
    const result = await syncNow(backend);
    expect(result.error).toBeUndefined();
    expect(result.merged).toEqual(["chatui:sessions"]);
    const stored = JSON.parse(storage.get("chatui:sessions") ?? "[]") as Array<{ id: string }>;
    expect(stored.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps local applies but reports push failures for retry", async () => {
    storage.set("chatui:settings", '{"a":2}');
    const backend = fakeBackend([row("chatui:projects", "[]", "2026-09-15T11:00:00Z")], { failPush: true });
    const result = await syncNow(backend);
    expect(result.error).toBe("offline");
    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(1);
    expect(storage.get("chatui:projects")).toBe("[]");
    const meta = JSON.parse(storage.get("chatui:sync:meta") ?? "{}") as SyncMeta;
    expect(meta["chatui:settings"]).toBeUndefined(); // retries next round
    expect(meta["chatui:projects"]).toBeDefined();
  });

  it("pushDirty upserts only changed keys plus tombstones, encrypted", async () => {
    storage.set("chatui:settings", '{"a":2}');
    storage.set(
      "chatui:sync:meta",
      JSON.stringify(
        metaFor({
          "chatui:settings": { hash: hashValue('{"a":1}'), syncedAt: "2026-09-15T10:00:00Z" },
          "chatui:projects": { hash: hashValue("[]"), syncedAt: "2026-09-15T10:00:00Z" },
        }),
      ),
    );
    const backend = fakeBackend([]);
    const result = await pushDirty(backend);
    expect(result).toEqual({ pushed: 2 });
    expect(backend.pushed.map((p) => [p.key, p.deleted])).toEqual([
      ["chatui:settings", false],
      ["chatui:projects", true],
    ]);
    // Values upload encrypted; tombstones stay empty.
    expect(isSyncEnvelope(backend.pushed[0].value)).toBe(true);
    expect(await decryptFromSync(backend.pushed[0].value)).toBe('{"a":2}');
    expect(backend.pushed[1].value).toBe("");
  });

  it("encrypts pushed values and decrypts pulled ones", async () => {
    storage.set("chatui:providers", '[{"id":"p1","apiKey":"sk-secret"}]');
    const backend = fakeBackend([]);
    const result = await syncNow(backend);
    expect(result.error).toBeUndefined();
    expect(result.pushed).toBe(1);
    const uploaded = backend.pushed[0];
    expect(uploaded.key).toBe("chatui:providers");
    expect(isSyncEnvelope(uploaded.value)).toBe(true);
    expect(uploaded.value).not.toContain("sk-secret");
    expect(await decryptFromSync(uploaded.value)).toBe('[{"id":"p1","apiKey":"sk-secret"}]');

    // Pulling that same row back lands as plaintext.
    storage.delete("chatui:providers");
    storage.delete("chatui:sync:meta");
    const pull = await syncNow(fakeBackend([row("chatui:providers", uploaded.value, "2026-09-15T11:00:00Z")]));
    expect(pull.error).toBeUndefined();
    expect(pull.pulled).toBe(1);
    expect(pull.undecryptable).toEqual([]);
    expect(storage.get("chatui:providers")).toBe('[{"id":"p1","apiKey":"sk-secret"}]');
  });

  it("skips undecryptable rows without touching either side", async () => {
    const envelope = await encryptForSync('{"a":1}'); // sealed under key A…
    await importSyncRecoveryCode( // …but this device now holds key B.
      Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
    );
    storage.set("chatui:settings", '{"local":true}');
    storage.set("chatui:projects", "[]");
    const backend = fakeBackend([
      row("chatui:settings", envelope, "2026-09-15T11:00:00Z"),
      row("chatui:projects", "[]", "2026-09-15T11:00:00Z"), // legacy plaintext, agrees
    ]);
    const result = await syncNow(backend);
    expect(result.error).toBeUndefined();
    expect(result.undecryptable).toEqual(["chatui:settings"]);
    expect(storage.get("chatui:settings")).toBe('{"local":true}'); // local kept
    // The undecryptable key is never pushed either (that would destroy the
    // other device's copy); only the legacy plaintext upgrade goes up.
    expect(backend.pushed.map((p) => p.key)).toEqual(["chatui:projects"]);
    expect(isSyncEnvelope(backend.pushed[0].value)).toBe(true);
  });

  it("re-pushes legacy plaintext rows encrypted once they agree", async () => {
    storage.set("chatui:settings", '{"a":1}');
    const backend = fakeBackend([row("chatui:settings", '{"a":1}', "2026-09-15T11:00:00Z")]);
    const result = await syncNow(backend);
    expect(result.error).toBeUndefined();
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    expect(isSyncEnvelope(backend.pushed[0].value)).toBe(true);
    expect(await decryptFromSync(backend.pushed[0].value)).toBe('{"a":1}');
  });
});
