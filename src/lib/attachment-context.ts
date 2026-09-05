import type { Provider } from "@/types";
import type { ContentPart } from "@/lib/llm";
import type { MessageAttachment } from "@/types";
import {
  isImageFile,
  isTextLikeFile,
  isPdfFile,
  extractFileText,
  fileToDataUrl,
  normalizeImageFile,
  pdfPagesToDataUrls,
  chunkText,
} from "@/lib/files";
import { embed, embedQuery, cosineSimilarity } from "@/lib/embeddings";
import { getModelCapabilities } from "@/lib/model-capabilities";
import { getFileBlob, getFileText, setFileText } from "@/lib/attachment-store";

interface Attachable {
  name: string;
  type: string;
  file?: File;
}

export interface PreparedAttachmentContext {
  content: string | ContentPart[];
  blocked: boolean;
  warning?: string;
}

const INLINE_THRESHOLD = 6000;
const MAX_INLINE_CHARS = 12000;
const RAG_TOP_K = 6;
/** Scanned-PDF pages rendered as images (first N pages only). */
const MAX_SCANNED_PAGES = 10;/**
 * Build the text context for one extracted document: inlined when small,
 * chunked + embedded + top-K retrieved when large. Shared by the live send
 * path and the history-replay/project-context paths (which pass cached text).
 */
export async function documentTextContext(
  name: string,
  text: string,
  query: string,
): Promise<string> {
  if (!text) return "";
  if (text.length <= INLINE_THRESHOLD) {
    return `\n\n--- ${name} ---\n${text.slice(0, MAX_INLINE_CHARS)}`;
  }
  const chunks = chunkText(text);
  const chunkEmbeds = await embed(chunks);
  const queryVec = await embedQuery(query || name);
  const ranked = chunks
    .map((c, i) => ({ c, s: cosineSimilarity(queryVec, chunkEmbeds[i] ?? []) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, RAG_TOP_K);
  return `\n\n--- ${name} (relevant excerpts) ---\n${ranked.map((r) => r.c).join("\n…\n")}`;
}

/**
 * Prepare attachment content for an outgoing chat message.
 * - Images: normalized (unsupported formats re-encoded, extreme sizes capped
 *   at original detail) and sent as base64 image_url parts with detail=high.
 * - Documents (text/PDF/DOCX): inlined if small, else chunked + embedded +
 *   top-K retrieved. Scanned (image-only) PDFs are rendered page-by-page and
 *   sent as images so vision models can read them with full detail.
 */
export async function prepareAttachmentContext(
  files: Attachable[],
  userText: string,
  provider: Provider,
  modelName: string,
  modelLabel?: string,
): Promise<PreparedAttachmentContext> {
  const rawImages = files.filter((f) => isImageFile(f) && f.file);
  const documents = files.filter((f) => !isImageFile(f) && f.file);

  const caps = rawImages.length > 0
    ? await getModelCapabilities(provider, modelName)
    : null;
  if (caps && !caps.vision) {
    return {
      content: userText,
      blocked: true,
      warning: `${modelLabel ?? modelName} doesn't support image input. Remove the image or switch to a vision-capable model.`,
    };
  }

  // Normalize images for API compatibility while keeping maximum detail.
  const images: File[] = [];
  for (const f of rawImages) {
    images.push(await normalizeImageFile(f.file!));
  }

  // Scanned (image-only) PDFs: no extractable text → render pages as images.
  const scannedImages: Array<{ name: string; url: string }> = [];

  let docContext = "";
  for (const doc of documents) {
    const text = await extractFileText(doc.file!);
    if (!text) {
      if (isPdfFile(doc)) {
        const urls = await pdfPagesToDataUrls(doc.file!, MAX_SCANNED_PAGES);
        if (urls.length > 0) {
          scannedImages.push(...urls.map((url) => ({ name: doc.name, url })));
          docContext += `\n\n--- ${doc.name} (scanned document — ${urls.length} page${urls.length > 1 ? "s" : ""} attached as images) ---`;
          continue;
        }
      }
      if (!isTextLikeFile(doc)) {
        // Unsupported binary file (e.g. xlsx) — note it
        docContext += `\n\n--- ${doc.name} ---\n[File content could not be extracted]`;
      }
      continue;
    }
    docContext += await documentTextContext(doc.name, text, userText);
  }

  if (scannedImages.length > 0) {
    const check = caps ?? (await getModelCapabilities(provider, modelName));
    if (!check.vision) {
      const names = [...new Set(scannedImages.map((i) => i.name))].join(", ");
      return {
        content: userText,
        blocked: true,
        warning: `${names} is a scanned document — its pages are images, and ${modelLabel ?? modelName} has no vision. Switch to a vision-capable model to read it.`,
      };
    }
  }

  const fullText = docContext ? userText + docContext : userText;
  const totalImages = images.length + scannedImages.length;

  if (totalImages > 0) {
    const imageUrls = await Promise.all(images.map((file) => fileToDataUrl(file)));
    const content: ContentPart[] = [
      { type: "text", text: fullText },
      ...[...imageUrls, ...scannedImages.map((i) => i.url)].map((url) => ({
        type: "image_url" as const,
        image_url: { url, detail: "high" as const },
      })),
    ];
    return { content, blocked: false };
  }

  return { content: fullText, blocked: false };
}

// ─── History replay ────────────────────────────────────────────────────────

/**
 * Rebuild a stored user message's attachment content from the persistent
 * file store, so attachments keep working across the whole chat (not just
 * the send they arrived on). Documents use their cached extracted text
 * (inline or RAG excerpts); images come back as high-detail image parts and
 * are silently skipped when the model has no vision (replay never blocks).
 * Returns null when the message needs no attachment context.
 */
export async function rebuildAttachmentContent(
  message: { content: string; attachments?: MessageAttachment[] },
  provider: Provider,
  modelName: string,
): Promise<string | ContentPart[] | null> {
  const attachments = (message.attachments ?? []).filter((a) => a.storageId);
  if (attachments.length === 0) return null;

  const caps = await getModelCapabilities(provider, modelName);
  const imageUrls: string[] = [];
  let docContext = "";

  for (const a of attachments) {
    const blob = await getFileBlob(a.storageId!);
    if (!blob) continue;
    if (isImageFile(a)) {
      if (!caps.vision) continue;
      const file = await normalizeImageFile(new File([blob], a.name, { type: a.type }));
      imageUrls.push(await fileToDataUrl(file));
      continue;
    }
    let text = await getFileText(a.storageId!);
    if (!text) {
      text = await extractFileText(new File([blob], a.name, { type: a.type }));
      if (text) void setFileText(a.storageId!, text);
    }
    if (!text) {
      if (isPdfFile(a)) {
        // Scanned PDF — render pages as images for vision models.
        if (!caps.vision) continue;
        const urls = await pdfPagesToDataUrls(new File([blob], a.name, { type: a.type }), MAX_SCANNED_PAGES);
        imageUrls.push(...urls);
        docContext += `\n\n--- ${a.name} (scanned document — pages attached as images) ---`;
        continue;
      }
      if (!isTextLikeFile(a)) {
        docContext += `\n\n--- ${a.name} ---\n[File content could not be extracted]`;
      }
      continue;
    }
    docContext += await documentTextContext(a.name, text, message.content);
  }

  if (imageUrls.length === 0 && !docContext) return null;

  const fullText = docContext ? message.content + docContext : message.content;
  if (imageUrls.length > 0) {
    return [
      { type: "text", text: fullText },
      ...imageUrls.map((url) => ({
        type: "image_url" as const,
        image_url: { url, detail: "high" as const },
      })),
    ];
  }
  return fullText;
}

// ─── Project files context ─────────────────────────────────────────────────

/** Total character budget for project file text injected into a conversation. */
const PROJECT_CONTEXT_CHAR_CAP = 24000;
/** Max project images attached to a single message (vision models only). */
const PROJECT_CONTEXT_MAX_IMAGES = 6;

export interface ProjectFilesContext {
  /** Text context to append to the run's instructions (docs inline/RAG). */
  text: string;
  /** Image data URLs to attach to the outgoing user message (vision only). */
  imageDataUrls: string[];
  /** Images skipped because the model has no vision (noted in text). */
  skippedImages: string[];
}

interface ProjectEntryLike {
  id: string;
  name: string;
  type?: string;
  storageId?: string;
}

/**
 * Build the persistent context for a project's uploaded files and images —
 * injected into EVERY conversation in that project. Documents are inlined
 * (small) or RAG-excerpted against the user's query; images become
 * high-detail image parts when the model has vision.
 */
export async function buildProjectFilesContext(
  files: ProjectEntryLike[],
  images: ProjectEntryLike[],
  query: string,
  provider: Provider,
  modelName: string,
): Promise<ProjectFilesContext> {
  const result: ProjectFilesContext = { text: "", imageDataUrls: [], skippedImages: [] };

  let used = 0;
  for (const f of files) {
    if (!f.storageId || used >= PROJECT_CONTEXT_CHAR_CAP) continue;
    let text = await getFileText(f.storageId);
    if (!text) {
      const blob = await getFileBlob(f.storageId);
      if (!blob) continue;
      text = await extractFileText(new File([blob], f.name, { type: f.type ?? "application/octet-stream" }));
      if (text) void setFileText(f.storageId, text);
    }
    if (!text) continue;
    const ctx = await documentTextContext(f.name, text, query);
    if (ctx) {
      result.text += ctx;
      used += ctx.length;
    }
  }

  if (images.length > 0) {
    const caps = await getModelCapabilities(provider, modelName);
    for (const img of images) {
      if (!img.storageId) continue;
      if (!caps.vision) {
        result.skippedImages.push(img.name);
        continue;
      }
      if (result.imageDataUrls.length >= PROJECT_CONTEXT_MAX_IMAGES) break;
      const blob = await getFileBlob(img.storageId);
      if (!blob) continue;
      const file = await normalizeImageFile(
        new File([blob], img.name, { type: blob.type || "image/png" }),
      );
      result.imageDataUrls.push(await fileToDataUrl(file));
    }
  }

  return result;
}
