import { invoke } from "@tauri-apps/api/core";

export interface RunPythonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Run a Python script on the user's system python3 via the Rust shell
 * (src-tauri/src/lib.rs `run_python`). Dev-only browser fallback errors out.
 * Optional `cwd` — without it the child inherits the app process's cwd.
 */
export async function runPython(
  code: string,
  timeoutMs = 30000,
  cwd?: string,
): Promise<RunPythonResult> {
  if (!isTauri) {
    return {
      stdout: "",
      stderr: "Python execution is only available in the desktop app.",
      exitCode: -1,
      timedOut: false,
    };
  }
  return invoke<RunPythonResult>("run_python", { code, cwd, timeoutMs });
}
