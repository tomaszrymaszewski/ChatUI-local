import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { createReadPdf } from "./readPdf";
import { createOpenUrl } from "./openUrl";
import { createFsToolPortState } from "./shared";
import { toSourceId } from "../loop/actions";

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("readPdf: createReadPdf", () => {
  it("invokes research_read_pdf with the url and timeoutMs, and returns the fetched page", async () => {
    mockedInvoke.mockResolvedValue({ title: "doc.pdf", body: "pdf text", date: null });
    const state = createFsToolPortState();
    const readPdf = createReadPdf(state, 5000);

    const result = await readPdf("https://example.com/doc.pdf", new AbortController().signal);

    expect(mockedInvoke).toHaveBeenCalledWith("research_read_pdf", { url: "https://example.com/doc.pdf", timeoutMs: 5000 });
    expect(result).toEqual({ title: "doc.pdf", body: "pdf text", date: null });
  });

  it("rejects promptly when the signal is already aborted, without calling invoke", async () => {
    const state = createFsToolPortState();
    const readPdf = createReadPdf(state, 1000);
    const controller = new AbortController();
    controller.abort();

    await expect(readPdf("https://example.com/doc.pdf", controller.signal)).rejects.toThrow("cancelled");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("shares one ordinal counter with openUrl when constructed against the same state", async () => {
    mockedInvoke.mockResolvedValueOnce({ title: "page", body: "html body", date: null });
    mockedInvoke.mockResolvedValueOnce({ title: "doc.pdf", body: "pdf body", date: null });

    const state = createFsToolPortState();
    const openUrl = createOpenUrl(state, 1000);
    const readPdf = createReadPdf(state, 1000);

    await openUrl("https://example.com/page", new AbortController().signal);
    await readPdf("https://example.com/doc.pdf", new AbortController().signal);

    expect(state.bodies.get(toSourceId("S1"))?.body).toBe("html body");
    expect(state.bodies.get(toSourceId("S2"))?.body).toBe("pdf body");
    expect(state.nextOrdinal).toBe(3);
  });
});
