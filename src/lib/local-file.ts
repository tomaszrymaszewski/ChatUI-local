import { invoke } from "@tauri-apps/api/core";

export interface LocalFileRead {
  path: string;
  /** "text" | "pdf-text" | "binary" | "directory" */
  kind: string;
  size: number;
  truncated: boolean;
  content: string;
  note?: string | null;
}

export interface LocalFileWrite {
  path: string;
  bytes: number;
  created: boolean;
}

/** Checked per call (not at module load) so tests can flip the environment. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Read a local file on the user's machine via the Rust shell
 * (src-tauri/src/lib.rs `read_local_file`). Text files come back as text,
 * PDFs as extracted text (pdftotext), folders as a listing, binaries are
 * refused with a note. Dev-only browser fallback errors out.
 */
export async function readLocalFile(path: string): Promise<LocalFileRead> {
  if (!isTauri()) {
    throw new Error("Local file access is only available in the desktop app.");
  }
  return invoke<LocalFileRead>("read_local_file", { path });
}

/**
 * Create or overwrite a local file on the user's machine via the Rust shell
 * (src-tauri/src/lib.rs `write_local_file`). The parent folder must exist.
 * Dev-only browser fallback errors out.
 */
export async function writeLocalFile(path: string, content: string): Promise<LocalFileWrite> {
  if (!isTauri()) {
    throw new Error("Local file access is only available in the desktop app.");
  }
  return invoke<LocalFileWrite>("write_local_file", { path, content });
}

export interface SharedFileBytes {
  path: string;
  name: string;
  size: number;
  contentBase64: string;
}

/**
 * Read a shared file's raw bytes (base64) via the Rust shell
 * (src-tauri/src/lib.rs `read_shared_file`) so it can be offered as a
 * download from a chat message. Dev-only browser fallback errors out.
 */
export async function readSharedFile(path: string): Promise<SharedFileBytes> {
  if (!isTauri()) {
    throw new Error("Local file access is only available in the desktop app.");
  }
  return invoke<SharedFileBytes>("read_shared_file", { path });
}

/**
 * Download a shared file through the browser: bytes come over IPC as
 * base64, become a Blob, and the standard anchor-download flow saves it
 * (the same proven path as the artifact exports).
 */
export async function downloadSharedFile(path: string): Promise<string> {
  const file = await readSharedFile(path);
  const binary = atob(file.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  return file.name;
}
