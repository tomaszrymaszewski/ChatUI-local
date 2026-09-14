import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Open a macOS app by name via the Rust shell (src-tauri/src/lib.rs
 * `open_app`, i.e. `open -a`). Resolves with the shell's confirmation;
 * throws when the app isn't installed. Dev-only browser fallback throws.
 */
export async function openApp(app: string, args?: string[]): Promise<string> {
  if (!isTauri) {
    throw new Error("Opening apps is only available in the desktop app.");
  }
  return invoke<string>("open_app", { app, args: args ?? null });
}
