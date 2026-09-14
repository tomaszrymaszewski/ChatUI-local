/**
 * Visibility preference for the session widget stack (the right-hand
 * Context/Tasks/Files panels), stored per tab: hidden by default in chat,
 * open by default in agent. A pre-existing global `chatui:widgets-hidden`
 * flag (from before the per-tab split) is adopted once for users who had
 * explicitly toggled it, then superseded by the per-tab keys.
 */

export type WidgetTab = "chat" | "agent";

const LEGACY_WIDGETS_HIDDEN_KEY = "chatui:widgets-hidden";

export function widgetsStorageKey(tab: WidgetTab): string {
  return `chatui:widgets-hidden-${tab}`;
}

export function resolveWidgetsHidden(tab: WidgetTab): boolean {
  const stored = localStorage.getItem(widgetsStorageKey(tab));
  if (stored !== null) return stored === "1";
  const legacy = localStorage.getItem(LEGACY_WIDGETS_HIDDEN_KEY);
  if (legacy !== null) return legacy === "1";
  return tab === "chat";
}
