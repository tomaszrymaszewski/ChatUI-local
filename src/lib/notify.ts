import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadUserSettings } from "@/hooks/use-user-settings";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let actionWired = false;

/** Focus the app window when a task notification is clicked. Once per session. */
async function ensureClickToFocus(): Promise<void> {
  if (actionWired) return;
  actionWired = true;
  try {
    await onAction(() => {
      getCurrentWindow()
        .setFocus()
        .catch(() => {});
    });
  } catch {
    // Click-to-focus is a nicety — the notification itself still shows.
  }
}

/**
 * Post a native macOS notification for a finished background task.
 * Best-effort and silent: no-ops outside the desktop app, when permission is
 * denied, or when the plugin call throws. Never rejects.
 */
export async function notifyTaskFinished(title: string, body: string): Promise<void> {
  try {
    if (!isTauri) return;
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    await ensureClickToFocus();
    sendNotification({ title, body });
  } catch {
    // Notifications must never break the run that just finished.
  }
}

/**
 * Notify only when the user isn't watching and hasn't opted out: the
 * window's document is hidden (minimized / fully occluded) at completion
 * time. Interactive runs finishing in a visible window need no ping.
 */
export async function notifyIfBackground(title: string, body: string): Promise<void> {
  try {
    if (!loadUserSettings().taskFinishNotifications) return;
    if (typeof document !== "undefined" && !document.hidden) return;
  } catch {
    return;
  }
  await notifyTaskFinished(title, body);
}
