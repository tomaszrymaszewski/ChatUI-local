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
