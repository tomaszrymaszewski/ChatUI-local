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
      "chatui:projects",
      "chatui:schedules",
      "chatui:workflows",
      "chatui:memory:global",
      "chatui:mcp",
      "chatui:mcp:usage",
      "chatui:skills:custom",
      "chatui:learn-mode",
      "chatui:tavily-key",
    ]) {
      expect(isSyncedKey(k)).toBe(true);
    }
    for (const k of [
      "chatui:onboarding",
      "chatui:sync:meta",
      "chatui:messages:recency",
      "chatui:mcp:migrated",
      "chatui:modelsdev-cache",
      "chatui:avatar-salts",
      "chatui:widgets-hidden-chat",
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

  it("pushDirty upserts only changed keys plus tombstones", async () => {
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
    expect(backend.pushed).toEqual([
      { key: "chatui:settings", value: '{"a":2}', deleted: false },
      { key: "chatui:projects", value: "", deleted: true },
    ]);
  });
});
