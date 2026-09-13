import { useEffect, useState } from "react";
import { chatUiBaseDir } from "@/lib/agent/sandbox";

/**
 * Resolved absolute path of the app's data base directory (null until known
 * or outside Tauri). Read-only — creates nothing; safe for display use.
 */
export function useChatUiBaseDir(): string | null {
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void chatUiBaseDir().then((dir) => {
      if (alive) setBase(dir);
    });
    return () => {
      alive = false;
    };
  }, []);
  return base;
}
