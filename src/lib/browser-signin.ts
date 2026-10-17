import { invoke } from "@tauri-apps/api/core";

/** Checked per call (not at module load) so tests can flip the environment. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Open the agent browser's persistent Chrome profile in headed mode so the
 * user can sign in to a website once (Gmail, …); later headless agent runs
 * reuse the saved session. The headless browser server is stopped first —
 * a Chrome profile only allows one instance — and restarts on the next
 * agent use. The user should close the window when done.
 */
export async function openBrowserSignIn(url?: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Browser sign-in is only available in the desktop app.");
  }
  await invoke("browser_login_open", { url: url?.trim() || null });
}
