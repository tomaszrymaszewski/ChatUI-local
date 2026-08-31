import "./lib/process-shim";
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import "./index.css";

// Wake detector: after a long system sleep the webview can wake up with dead
// connections and stalled timers (or macOS may have killed and reloaded the
// web content process). A 5s heartbeat that jumps by more than 2 minutes
// means the machine slept — reload so the app always wakes into fresh,
// working state. localStorage persists all data across the reload.
let lastHeartbeat = Date.now();
setInterval(() => {
  const now = Date.now();
  if (now - lastHeartbeat > 120_000) {
    window.location.reload();
    return;
  }
  lastHeartbeat = now;
}, 5_000);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("App crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace", fontSize: "14px", whiteSpace: "pre-wrap" }}>
          <h2 style={{ marginBottom: "1rem" }}>Something went wrong</h2>
          <p style={{ color: "red", marginBottom: "1rem" }}>{this.state.error.message}</p>
          <p style={{ color: "#888", fontSize: "12px" }}>{this.state.error.stack}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
