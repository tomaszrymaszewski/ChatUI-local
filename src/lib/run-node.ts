import { invoke } from "@tauri-apps/api/core";

export interface RunNodeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Run a Node.js script on the user's system node via the Rust shell
 * (src-tauri/src/lib.rs `run_node`). NODE_PATH points at the app-owned
 * node-libs folder so skill scripts can require() packages installed there.
 * Dev-only browser fallback errors out.
 */
export async function runNode(
  code: string,
  cwd?: string,
  timeoutMs = 30000,
): Promise<RunNodeResult> {
  if (!isTauri) {
    return {
      stdout: "",
      stderr: "Node execution is only available in the desktop app.",
      exitCode: -1,
      timedOut: false,
    };
  }
  return invoke<RunNodeResult>("run_node", { code, cwd: cwd ?? null, timeoutMs });
}
