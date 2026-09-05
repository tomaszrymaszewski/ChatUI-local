const PDFJS_VERSION = "6.2.108";
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

const TEXT_EXTENSIONS = [
  "md", "txt", "csv", "json", "js", "jsx", "ts", "tsx", "py", "rs", "go",
  "java", "c", "cpp", "h", "hpp", "sh", "bash", "yml", "yaml", "xml", "html",
  "css", "toml", "ini", "env", "sql", "rb", "php", "swift", "kt", "scala",
  "lua", "vue", "svelte",
];

const TEXT_MIMES = [
  "text/",
  "application/json",
  "application/javascript",
  "application/xml",
  "application/x-yaml",
  "application/x-sh",
];

export function isTextLikeFile(file: { type: string; name: string }): boolean {
  if (TEXT_MIMES.some((m) => file.type.startsWith(m) || file.type === m)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.includes(ext);
}

export function isImageFile(file: { type: string }): boolean {
  return file.type.startsWith("image/");
}

export function isPdfFile(file: { type: string; name: string }): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isDocxFile(file: { type: string; name: string }): boolean {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}

/** Extract plain text from a file (text, PDF, DOCX). Returns "" if unsupported. */
export async function extractFileText(file: File): Promise<string> {
  try {
    if (isTextLikeFile(file)) {
      return await file.text();
    }
    if (isPdfFile(file)) {
      return await extractPdfText(file);
    }
    if (isDocxFile(file)) {
      return await extractDocxText(file);
    }
  } catch {
    // ignore extraction errors
  }
  return "";
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as unknown as Array<{ str?: string }>;
    text += items.map((item) => item.str ?? "").join(" ") + "\n\n";
  }
  return text.trim();
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/** Read a file as a base64 data URL (for images). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ─── Image normalization for vision-model APIs ─────────────────────────────

const API_SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
/** Payload guard: APIs commonly reject images above ~10-20 MB. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Detail guard: never downscale below this long edge, only cap above it. */
const MAX_IMAGE_EDGE = 4096;

/**
 * Normalize an image for vision-model APIs while preserving as much detail
 * as possible: re-encode unsupported formats (HEIC, TIFF, BMP, …) to JPEG at
 * the ORIGINAL resolution, and only shrink when the long edge exceeds 4096px
 * or the file exceeds 10 MB. JPEG/PNG/WebP/GIF under the limits pass through
 * untouched (no recompression loss).
 */
export async function normalizeImageFile(file: File): Promise<File> {
  const safeType = API_SAFE_IMAGE_TYPES.has(file.type);
  try {
    const bitmap = await createImageBitmap(file);
    const needsResize =
      bitmap.width > MAX_IMAGE_EDGE || bitmap.height > MAX_IMAGE_EDGE;
    if (safeType && file.size <= MAX_IMAGE_BYTES && !needsResize) {
      bitmap.close();
      return file;
    }
    const scale = needsResize
      ? MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height)
      : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob || blob.size >= file.size) return file;
    const name = (file.name.replace(/\.[^.]+$/, "") || "image") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    // Undecodable here (e.g. HEIC on an older OS) — send the original and
    // let the provider accept or reject it.
    return file;
  }
}

/**
 * Render the first pages of a scanned (image-only) PDF to JPEG data URLs so
 * vision models can read them with full visual detail. Returns [] when
 * nothing could be rendered.
 */
export async function pdfPagesToDataUrls(
  file: File,
  maxPages = 10,
): Promise<string[]> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const urls: string[] = [];
    const pages = Math.min(pdf.numPages, maxPages);
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      // ~2x for readable scanned text, capped at the 4096px edge.
      const scale = Math.min(2, MAX_IMAGE_EDGE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      urls.push(canvas.toDataURL("image/jpeg", 0.92));
    }
    return urls;
  } catch {
    return [];
  }
}

/** Split text into overlapping chunks. */
export function chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
  if (!text.trim()) return [];
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}
