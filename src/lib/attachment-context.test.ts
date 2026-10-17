import { describe, it, expect, vi, beforeEach } from "vitest";

// Heavy collaborators (pdf.js rendering, embeddings, the knowledge index,
// the attachment store, the Rust bridge) are stubbed so the scanned-PDF
// fallback logic runs hermetically in node.
const mocks = vi.hoisted(() => ({
  ocrAvailable: vi.fn(() => true),
  ocrImageDataUrl: vi.fn(async () => "Recognized scanned text"),
  setFileText: vi.fn(async () => {}),
  vision: { value: false },
}));

vi.mock("@/lib/model-capabilities", () => ({
  getModelCapabilities: async () => ({
    vision: mocks.vision.value,
    source: "catalog",
    inputModalities: ["text"],
  }),
}));
vi.mock("@/lib/ocr", () => ({
  ocrAvailable: mocks.ocrAvailable,
  ocrImageDataUrl: mocks.ocrImageDataUrl,
}));
vi.mock("@/lib/attachment-store", () => ({
  getFileBlob: async () => new Blob(["fake pdf bytes"], { type: "application/pdf" }),
  getFileText: async () => "",
  setFileText: mocks.setFileText,
}));
vi.mock("@/lib/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/files")>();
  return {
    ...actual,
    extractFileText: async () => "",
    pdfPagesToDataUrls: async () => [
      "data:image/jpeg;base64,AAAA",
      "data:image/jpeg;base64,BBBB",
    ],
  };
});
vi.mock("@/lib/embeddings", () => ({
  embed: async (texts: string[]) => texts.map(() => [1, 0]),
  embedQuery: async () => [1, 0],
  cosineSimilarity: () => 1,
}));
vi.mock("@/lib/knowledge-index", () => ({ searchKnowledgeIndex: async () => [] }));
vi.mock("@/lib/deliverables", () => ({ writeBinaryFile: async () => true }));

import { rebuildAttachmentContent } from "@/lib/attachment-context";

const provider = {
  id: "p",
  name: "P",
  baseUrl: "https://api.example.com/v1",
  models: [],
  hasKey: true,
};

const scannedPdfMessage = {
  content: "look at this",
  attachments: [
    { id: "a1", name: "scan.pdf", size: 10, type: "application/pdf", storageId: "s1" },
  ],
};

describe("scanned-PDF OCR fallback (history replay)", () => {
  beforeEach(() => {
    mocks.ocrAvailable.mockReturnValue(true);
    mocks.vision.value = false;
    mocks.ocrImageDataUrl.mockClear();
    mocks.setFileText.mockClear();
  });

  it("OCRs the rendered pages when the model has no vision and caches the text", async () => {
    const result = await rebuildAttachmentContent(scannedPdfMessage, provider, "text-model");
    const text = typeof result === "string" ? result : "";
    expect(text).toContain("--- scan.pdf ---");
    expect(text).toContain("Recognized scanned text");
    expect(mocks.ocrImageDataUrl).toHaveBeenCalledTimes(2);
    expect(mocks.setFileText).toHaveBeenCalledWith(
      "s1",
      "Recognized scanned text\n\nRecognized scanned text",
    );
  });

  it("sends page images to vision models without OCR", async () => {
    mocks.vision.value = true;
    const result = await rebuildAttachmentContent(scannedPdfMessage, provider, "vision-model");
    expect(Array.isArray(result)).toBe(true);
    const parts = result as Array<{ type: string }>;
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(2);
    expect(mocks.ocrImageDataUrl).not.toHaveBeenCalled();
  });

  it("skips the document quietly when neither vision nor OCR is available", async () => {
    mocks.ocrAvailable.mockReturnValue(false);
    const result = await rebuildAttachmentContent(scannedPdfMessage, provider, "text-model");
    expect(result).toBeNull();
    expect(mocks.ocrImageDataUrl).not.toHaveBeenCalled();
  });
});
