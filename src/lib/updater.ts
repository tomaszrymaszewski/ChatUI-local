/**
 * App update checking and installation.
 *
 * Uses tauri-plugin-updater to ping a static JSON manifest hosted on GitHub
 * Releases (see tauri.conf.json → plugins.updater.endpoints). Everything
 * besides that one HTTPS ping is local. The public key in tauri.conf.json
 * verifies the signed update bundle before installation.
 */

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SETTINGS_KEY = "chatui:update-settings";

export interface UpdateSettings {
  autoCheck: boolean;
  lastChecked: string | null;
  skippedVersion?: string;
}

export function loadUpdateSettings(): UpdateSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UpdateSettings>;
      return {
        autoCheck: parsed.autoCheck ?? true,
        lastChecked: parsed.lastChecked ?? null,
        skippedVersion: parsed.skippedVersion,
      };
    }
  } catch {
    // ignore malformed JSON
  }
  return { autoCheck: true, lastChecked: null };
}

export function saveUpdateSettings(settings: UpdateSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export interface UpdateCheckResult {
  available: boolean;
  info?: UpdateInfo;
  currentVersion: string;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isTauri) {
    return { available: false, currentVersion: "0.0.0" };
  }
  const currentVersion = await getVersion();
  const update = await check();
  if (update) {
    return {
      available: true,
      currentVersion,
      info: {
        version: update.version,
        currentVersion,
        date: update.date,
        body: update.body,
      },
    };
  }
  return { available: false, currentVersion };
}

export type DownloadProgressFn = (
  event:
    | { event: "Started"; contentLength: number | undefined }
    | { event: "Progress"; downloaded: number; contentLength: number | undefined }
    | { event: "Finished" },
) => void;

export async function downloadAndInstallUpdate(
  onProgress?: DownloadProgressFn,
): Promise<void> {
  if (!isTauri) return;
  const update = await check();
  if (!update) return;
  let downloaded = 0;
  let contentLength: number | undefined;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength;
        onProgress?.({ event: "Started", contentLength });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ event: "Progress", downloaded, contentLength });
        break;
      case "Finished":
        onProgress?.({ event: "Finished" });
        break;
    }
  });
}

export async function relaunchApp(): Promise<void> {
  if (!isTauri) return;
  await relaunch();
}

export function isUpdaterAvailable(): boolean {
  return isTauri;
}

export { type Update };
