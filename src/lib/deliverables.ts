import { invoke } from "@tauri-apps/api/core";

/**
 * Per-chat deliverables directory: where the agent saves files the user
 * should receive (decks, reports, datasets). run_python / run_node default
 * their cwd here, and share_files attaches download cards for whatever lands
 * in it. Kept under the app's data base (files/<sessionId>) so every run has
 * a writable, predictable home instead of inheriting the app process's cwd.
 */
export async function ensureDeliverablesDir(sessionId: string): Promise<string | undefined> {
  if (!(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) return undefined;
  try {
    const base = await invoke<string>("ensure_chat_ui_directory");
    return await invoke<string>("ensure_dir", { path: `${base}/files/${sessionId}` });
  } catch {
    return undefined;
  }
}

/**
 * Write a blob to disk as binary (base64 over the webview bridge). Used to
 * materialize chat attachments where the agent's file tools can read them.
 * False when unavailable (browser dev / tests) or the write fails.
 */
export async function writeBinaryFile(path: string, blob: Blob): Promise<boolean> {
  if (!(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) return false;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    await invoke("write_file_base64", { path, data: btoa(bin) });
    return true;
  } catch {
    return false;
  }
}
