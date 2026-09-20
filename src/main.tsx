import "./lib/process-shim";
import React from "react";
import ReactDOM from "react-dom/client";
import { preloadStores } from "./lib/idb-store";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import "./index.css";

// NOTE: there is deliberately no wake/sleep reload here. An earlier version
// reloaded the page when a 5s heartbeat jumped by more than 2 minutes, but
// that fired on every return to the app after a while — a white flash back
// to the homescreen with the open session lost. All data is local-first
// (IndexedDB/localStorage) and already survives sleep; the Supabase realtime
// channel reconnects on its own, so a reload buys nothing and costs the
// user's place.

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

async function boot(): Promise<void> {
  // Load chats into the big-key mirror (and sweep localStorage leftovers
  // into IndexedDB) before first render so no component ever sees an empty
  // store. Never throws — on failure the mirror falls back to localStorage.
  await preloadStores();
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
}

void boot();
