import { afterEach, describe, expect, it } from "vitest";
import {
  putFileBlob,
  getFileBlob,
  getFileText,
  setFileText,
  deleteFileBlob,
  isFileStorePersistent,
} from "@/lib/attachment-store";

// The vitest environment is node — no IndexedDB — so the store transparently
// uses its in-memory fallback, which exercises the API surface.

afterEach(() => {
  // Best-effort cleanup between tests.
  void deleteFileBlob("a1");
  void deleteFileBlob("a2");
});

describe("attachment-store", () => {
  it("reports the in-memory fallback in node", () => {
    expect(isFileStorePersistent()).toBe(false);
  });

  it("round-trips bytes", async () => {
    const blob = new Blob(["hello world"], { type: "text/plain" });
    await putFileBlob("a1", blob);
    const stored = await getFileBlob("a1");
    expect(stored).not.toBeNull();
    expect(await stored!.text()).toBe("hello world");
    expect(stored!.type).toBe("text/plain");
  });

  it("stores and updates cached extracted text", async () => {
    const blob = new Blob(["doc bytes"], { type: "application/pdf" });
    await putFileBlob("a2", blob, { extractedText: "first" });
    expect(await getFileText("a2")).toBe("first");

    await setFileText("a2", "second");
    expect(await getFileText("a2")).toBe("second");
    // The bytes survive a text-only update.
    const stored = await getFileBlob("a2");
    expect(await stored!.text()).toBe("doc bytes");
  });

  it("returns null/empty for unknown ids", async () => {
    expect(await getFileBlob("missing")).toBeNull();
    expect(await getFileText("missing")).toBe("");
  });

  it("deletes stored files safely", async () => {
    await putFileBlob("a1", new Blob(["x"]));
    await deleteFileBlob("a1");
    expect(await getFileBlob("a1")).toBeNull();
    // Deleting again is a no-op, not an error.
    await expect(deleteFileBlob("a1")).resolves.toBeUndefined();
  });
});
