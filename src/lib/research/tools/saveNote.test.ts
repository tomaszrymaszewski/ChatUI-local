import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { saveNote } from "./saveNote";
import { toSourceId } from "../loop/actions";

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("saveNote", () => {
  it("rejects empty text without touching invoke", async () => {
    const result = await saveNote(
      { text: "   ", sourceIds: [], tags: [], targetsSubQ: null },
      "session-1",
      new Set(),
    );

    expect(result).toEqual({ ok: false, error: "save_note requires non-empty text" });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("rejects an unknown source id without touching invoke", async () => {
    const s1 = toSourceId("S1");
    const result = await saveNote(
      { text: "a finding", sourceIds: [toSourceId("S99")], tags: [], targetsSubQ: null },
      "session-1",
      new Set([s1]),
    );

    expect(result).toEqual({ ok: false, error: "unknown source id: S99" });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("persists a valid finding via ensure_chat_ui_directory + write_text_file", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_chat_ui_directory") return Promise.resolve("/Users/x/Documents/chatUI");
      if (cmd === "write_text_file") return Promise.resolve(undefined);
      throw new Error(`unexpected command: ${cmd}`);
    });
    const s1 = toSourceId("S1");

    const result = await saveNote(
      { text: "a finding", sourceIds: [s1], tags: ["tag1"], targetsSubQ: null },
      "session-1",
      new Set([s1]),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe(`/Users/x/Documents/chatUI/research/session-1/findings/${result.value.findingId}.json`);
    }
    expect(mockedInvoke).toHaveBeenCalledWith("ensure_chat_ui_directory");
    const writeCall = mockedInvoke.mock.calls.find(([cmd]) => cmd === "write_text_file");
    expect(writeCall).toBeDefined();
    const content = JSON.parse((writeCall?.[1] as { content: string }).content);
    expect(content.text).toBe("a finding");
    expect(content.sourceIds).toEqual([s1]);
  });

  it("returns an error result (does not throw) when persistence fails", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_chat_ui_directory") return Promise.resolve("/Users/x/Documents/chatUI");
      if (cmd === "write_text_file") return Promise.reject(new Error("disk full"));
      throw new Error(`unexpected command: ${cmd}`);
    });

    const result = await saveNote({ text: "a finding", sourceIds: [], tags: [], targetsSubQ: null }, "session-1", new Set());

    expect(result).toEqual({ ok: false, error: "disk full" });
  });
});
