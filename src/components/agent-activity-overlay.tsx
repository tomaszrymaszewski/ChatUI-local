import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalPosition, primaryMonitor } from "@tauri-apps/api/window";
import { Check, LoaderCircle, Monitor } from "lucide-react";

interface ComputerActivity {
  id?: string;
  active: boolean;
  label: string;
  detail?: string;
}

export function AgentActivityOverlay() {
  const [activity, setActivity] = useState<ComputerActivity | null>(null);
  const [visible, setVisible] = useState(false);
  const [dark, setDark] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const activeActivities = useRef(new Map<string, ComputerActivity>());

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const showAtTop = async () => {
      try {
        const monitor = await currentMonitor() ?? await primaryMonitor();
        if (monitor) {
          const origin = monitor.position.toLogical(monitor.scaleFactor);
          const size = monitor.size.toLogical(monitor.scaleFactor);
          await win.setPosition(new LogicalPosition(origin.x + Math.max(0, (size.width - 560) / 2), origin.y + 12));
        }
        await win.setAlwaysOnTop(true);
        await win.setFocusable(false);
        await win.setIgnoreCursorEvents(true);
        if (!disposed) await win.show();
      } catch (error) {
        console.warn("Could not show computer activity overlay", error);
      }
    };

    void listen<ComputerActivity>("agent-computer-activity", ({ payload }) => {
      const activityId = payload.id ?? payload.label;
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (payload.active) {
        activeActivities.current.set(activityId, payload);
        setActivity(payload);
        setVisible(true);
        void showAtTop();
      } else {
        activeActivities.current.delete(activityId);
        const stillActive = Array.from(activeActivities.current.values()).at(-1);
        if (stillActive) {
          setActivity(stillActive);
          setVisible(true);
        } else {
          setActivity(payload);
          setVisible(true);
          hideTimer.current = window.setTimeout(() => {
            setVisible(false);
            void win.hide().catch(() => {});
          }, 1800);
        }
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    const syncTheme = () => {
      const setting = localStorage.getItem("theme");
      const useDark = setting === "dark" || (setting !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", useDark);
      setDark(useDark);
    };
    syncTheme();
    window.addEventListener("storage", syncTheme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", syncTheme);
    return () => {
      window.removeEventListener("storage", syncTheme);
      media.removeEventListener("change", syncTheme);
    };
  }, []);

  if (!visible || !activity) return null;
  const panel = dark
    ? "rgba(28, 28, 30, .96)"
    : "rgba(250, 250, 252, .97)";
  const foreground = dark ? "#f4f4f5" : "#18181b";
  const muted = dark ? "#a1a1aa" : "#71717a";
  const border = dark ? "rgba(255,255,255,.13)" : "rgba(0,0,0,.12)";

  return (
    <main
      aria-live="polite"
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8px 14px 0",
        boxSizing: "border-box",
        background: "transparent",
        color: foreground,
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          minHeight: 56,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          boxSizing: "border-box",
          border: `1px solid ${border}`,
          borderRadius: 16,
          background: panel,
          boxShadow: dark ? "0 8px 30px rgba(0,0,0,.38)" : "0 8px 30px rgba(0,0,0,.14)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div style={{ width: 28, height: 28, display: "grid", placeItems: "center", borderRadius: 9, background: dark ? "rgba(96,165,250,.16)" : "rgba(37,99,235,.10)", color: dark ? "#93c5fd" : "#2563eb", flex: "none" }}>
          {activity.active ? <LoaderCircle size={17} className="animate-spin" /> : <Check size={17} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 550, lineHeight: "18px" }}>
            <Monitor size={14} style={{ color: muted, flex: "none" }} />
            <span>{activity.active ? activity.label : `${activity.label} complete`}</span>
          </div>
          {activity.detail && <div style={{ marginTop: 2, color: muted, fontSize: 11, lineHeight: "15px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activity.detail}</div>}
        </div>
        <span style={{ color: muted, fontSize: 11, flex: "none" }}>AI Studio</span>
      </div>
    </main>
  );
}
