import { invoke } from "@tauri-apps/api/core";

/** Readiness report for desktop Computer Use (open-computer-use). */
export interface ComputerUseStatus {
  /** The open-computer-use CLI resolves on PATH. */
  installed: boolean;
  /** macOS Accessibility permission granted; null when unknown / non-macOS. */
  accessibility: boolean | null;
  /** macOS Screen Recording permission granted; null when unknown / non-macOS. */
  screenRecording: boolean | null;
  /** Installed and no known permission still missing — safe to use. */
  ready: boolean;
  /** Raw `doctor` output, for display when the structured flags are empty. */
  raw: string;
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True when the open-computer-use CLI is installed. */
export async function isComputerUseInstalled(): Promise<boolean> {
  if (!inTauri()) return false;
  try {
    return await invoke<boolean>("ocu_installed");
  } catch {
    return false;
  }
}

/**
 * Check Computer Use readiness. Running this also makes macOS surface its own
 * permission onboarding UI when Accessibility or Screen Recording is missing,
 * which is the intended way to prompt the user to grant them.
 */
export async function checkComputerUse(): Promise<ComputerUseStatus> {
  if (!inTauri()) {
    return { installed: false, accessibility: null, screenRecording: null, ready: false, raw: "" };
  }
  const result = await invoke<{
    installed: boolean;
    accessibility: boolean | null;
    screenRecording: boolean | null;
    ready: boolean;
    raw: string;
  }>("ocu_doctor");
  return result;
}

/**
 * Install (or update) the open-computer-use CLI globally via npm. Rejects with
 * a human-readable message on failure (e.g. npm/Node.js missing).
 */
export async function installComputerUse(): Promise<void> {
  if (!inTauri()) {
    throw new Error("Computer Use can only be installed in the desktop app.");
  }
  await invoke<void>("ocu_install");
}

/** Which macOS privacy pane to open. */
export type PrivacyPane = "accessibility" | "screen-recording";

/**
 * Open the macOS System Settings pane for a Computer Use permission, so the
 * user can toggle AI Studio (or drag it) into the list. macOS does not let an
 * app grant these itself.
 */
export async function openPrivacySettings(pane: PrivacyPane): Promise<void> {
  if (!inTauri()) return;
  await invoke<void>("open_privacy_settings", { pane });
}
