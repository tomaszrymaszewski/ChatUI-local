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
