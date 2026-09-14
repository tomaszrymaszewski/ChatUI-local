import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWidgetsHidden, widgetsStorageKey } from "./widget-visibility";

// The vitest environment is node — stub storage like a browser.
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
});

describe("widgetsStorageKey", () => {
  it("namespaces the flag per tab", () => {
    expect(widgetsStorageKey("chat")).toBe("chatui:widgets-hidden-chat");
    expect(widgetsStorageKey("agent")).toBe("chatui:widgets-hidden-agent");
  });
});

describe("resolveWidgetsHidden", () => {
  it("hides widgets in chat and shows them in agent by default", () => {
    expect(resolveWidgetsHidden("chat")).toBe(true);
    expect(resolveWidgetsHidden("agent")).toBe(false);
  });

  it("prefers the stored per-tab flag over defaults", () => {
    storage.set("chatui:widgets-hidden-chat", "0");
    storage.set("chatui:widgets-hidden-agent", "1");
    expect(resolveWidgetsHidden("chat")).toBe(false);
    expect(resolveWidgetsHidden("agent")).toBe(true);
  });

  it("adopts the legacy global flag when no per-tab flag exists", () => {
    storage.set("chatui:widgets-hidden", "1");
    expect(resolveWidgetsHidden("chat")).toBe(true);
    expect(resolveWidgetsHidden("agent")).toBe(true);
    storage.set("chatui:widgets-hidden", "0");
    expect(resolveWidgetsHidden("chat")).toBe(false);
    expect(resolveWidgetsHidden("agent")).toBe(false);
  });
});
