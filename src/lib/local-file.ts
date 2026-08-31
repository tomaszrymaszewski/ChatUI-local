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
