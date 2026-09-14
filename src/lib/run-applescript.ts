import { invoke } from "@tauri-apps/api/core";

export interface RunAppleScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Run an AppleScript snippet on the user's Mac via the Rust shell
 * (src-tauri/src/lib.rs `run_applescript`). The script travels to osascript
 * through a temp file (no shell-quoting pitfalls), killed on timeout.
 * Dev-only browser fallback throws.
 */
export async function runAppleScript(
  script: string,
  timeoutMs = 30000,
): Promise<RunAppleScriptResult> {
  if (!isTauri) {
    throw new Error("AppleScript is only available in the desktop app.");
  }
  return invoke<RunAppleScriptResult>("run_applescript", { script, timeoutMs });
}
