import { invoke } from "@tauri-apps/api/core";

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Run a shell command on the user's machine via the Rust shell
 * (src-tauri/src/lib.rs `run_command`). Login shell, optional working
 * directory, killed on timeout. Dev-only browser fallback errors out.
 */
export async function runCommand(
  command: string,
  cwd?: string,
  timeoutMs = 120000,
): Promise<RunCommandResult> {
  if (!isTauri) {
    return {
      stdout: "",
      stderr: "Terminal commands are only available in the desktop app.",
      exitCode: -1,
      timedOut: false,
    };
  }
  return invoke<RunCommandResult>("run_command", { command, cwd: cwd ?? null, timeoutMs });
}
