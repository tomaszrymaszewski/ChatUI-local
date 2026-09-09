import { invoke } from "@tauri-apps/api/core";
import type { RunCommandResult } from "@/lib/run-command";

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
 * node-libs folder so skill scripts can require("pptxgenjs") etc. Dev-only
 * browser fallback errors out.
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

/**
 * One-time setup of the app-owned Node libraries folder
 * (~/Documents/chatUI/node-libs): creates it with a package.json and installs
 * pptxgenjs — the library skills like pptx describe as "preinstalled" — so
 * `require("pptxgenjs")` works from any run_node script. Called at launch
 * alongside the skills auto-installer; failures are silent and retried on the
 * next launch.
 */
export async function ensureNodeLibs(): Promise<void> {
  if (!isTauri) return;
  try {
    const base = await invoke<string>("ensure_chat_ui_directory");
    const libs = `${base}/node-libs`;
    const pkg = `${libs}/package.json`;
    if (!(await invoke<boolean>("path_exists", { path: pkg }))) {
      await invoke("write_text_file", {
        path: pkg,
        content: JSON.stringify({ name: "chatui-node-libs", private: true }) + "\n",
      });
    }
    if (await invoke<boolean>("path_exists", { path: `${libs}/node_modules/pptxgenjs` })) {
      return;
    }
    await invoke<RunCommandResult>("run_command", {
      command: "npm install pptxgenjs --no-audit --no-fund --loglevel=error",
      cwd: libs,
      timeoutMs: 120000,
    });
  } catch {
    // offline / no npm — retried on the next launch
  }
}
