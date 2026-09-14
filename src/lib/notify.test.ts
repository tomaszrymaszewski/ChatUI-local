import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifyTaskFinished } from "./notify";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  onAction: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

const storage = new Map<string, string>();

function stubStorage(settings: Record<string, unknown> = {}) {
  storage.clear();
  storage.set("chatui:settings", JSON.stringify(settings));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
}

async function freshNotify() {
  vi.resetModules();
  return import("./notify");
}

beforeEach(() => {
  stubStorage({ taskFinishNotifications: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("notifyTaskFinished", () => {
  it("no-ops outside the desktop app", async () => {
    await notifyTaskFinished("Done", "body");
    expect(sendNotification).not.toHaveBeenCalled();
    expect(isPermissionGranted).not.toHaveBeenCalled();
  });

  it("sends when permission is granted and focuses the app on click", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const mod = await freshNotify();
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    const setFocus = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getCurrentWindow).mockReturnValue({ setFocus } as never);
    let actionCb: (() => void) | null = null;
    vi.mocked(onAction).mockImplementation(async (cb) => {
      actionCb = cb as () => void;
      return {} as never;
    });
    await mod.notifyTaskFinished("Task finished", "All done.");
    expect(sendNotification).toHaveBeenCalledWith({ title: "Task finished", body: "All done." });
    actionCb!();
    expect(setFocus).toHaveBeenCalled();
  });

  it("requests permission when unknown and stays silent when denied", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const mod = await freshNotify();
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue("denied" as never);
    await mod.notifyTaskFinished("Task finished", "All done.");
    expect(requestPermission).toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never rejects, even when the plugin throws", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const mod = await freshNotify();
    vi.mocked(isPermissionGranted).mockRejectedValue(new Error("nope"));
    await expect(mod.notifyTaskFinished("Task finished", "x")).resolves.toBeUndefined();
  });
});

describe("notifyIfBackground", () => {
  it("skips visible windows and opted-out users", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const mod = await freshNotify();
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    vi.stubGlobal("document", { hidden: false });
    await mod.notifyIfBackground("Task finished", "x");
    expect(sendNotification).not.toHaveBeenCalled();
    vi.stubGlobal("document", { hidden: true });
    stubStorage({ taskFinishNotifications: false });
    await mod.notifyIfBackground("Task finished", "x");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends when hidden and enabled", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const mod = await freshNotify();
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    vi.stubGlobal("document", { hidden: true });
    await mod.notifyIfBackground("Task finished", "All done.");
    expect(sendNotification).toHaveBeenCalledWith({ title: "Task finished", body: "All done." });
  });
});
