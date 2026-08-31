import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { readLocalFile, writeLocalFile, type LocalFileRead } from "./local-file";

const mockedInvoke = vi.mocked(invoke);

const SAMPLE_READ: LocalFileRead = {
  path: "/Users/me/paper.pdf",
  kind: "pdf-text",
  size: 12345,
  truncated: false,
  content: "extracted text",
  note: "Text extracted from the PDF with pdftotext…",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Simulate the Tauri webview so the isTauri guard lets invoke through.
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readLocalFile", () => {
  it("invokes read_local_file with the path", async () => {
    mockedInvoke.mockResolvedValueOnce(SAMPLE_READ);
    await expect(readLocalFile("~/Documents/paper.pdf")).resolves.toEqual(SAMPLE_READ);
    expect(mockedInvoke).toHaveBeenCalledWith("read_local_file", {
      path: "~/Documents/paper.pdf",
    });
  });

  it("propagates command errors", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("nope: not found"));
    await expect(readLocalFile("/nope")).rejects.toThrow("nope: not found");
  });
});

describe("writeLocalFile", () => {
  it("invokes write_local_file with path and content", async () => {
    mockedInvoke.mockResolvedValueOnce({ path: "/tmp/x.md", bytes: 3, created: true });
    await expect(writeLocalFile("/tmp/x.md", "abc")).resolves.toEqual({
      path: "/tmp/x.md",
      bytes: 3,
      created: true,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("write_local_file", {
      path: "/tmp/x.md",
      content: "abc",
    });
  });
});

describe("outside the desktop app", () => {
  it("rejects both wrappers without invoking", async () => {
    vi.stubGlobal("window", {});
    await expect(readLocalFile("/tmp/x")).rejects.toThrow("only available in the desktop app");
    await expect(writeLocalFile("/tmp/x", "y")).rejects.toThrow("only available in the desktop app");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
