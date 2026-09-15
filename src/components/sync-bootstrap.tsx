import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { createSupabaseBackend, startSyncManager } from "@/lib/sync";

/**
 * Owns the cloud-sync lifecycle for the whole app (onboarding + main UI):
 * starts the sync manager on sign-in, stops it on sign-out, and toasts the
 * outcome of the initial merge. Background syncs stay silent — the initial
 * result is the one the user asked for by connecting.
 */
export function SyncBootstrap() {
  const { user, configured } = useAuth();
  const stopRef = useRef<(() => void) | null>(null);
  const toastedForRef = useRef<string | null>(null);
  const lastUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastUserRef.current !== (user?.id ?? null)) {
      lastUserRef.current = user?.id ?? null;
      toastedForRef.current = null;
    }
    if (!configured || !user) {
      stopRef.current?.();
      stopRef.current = null;
      return;
    }
    const userId = user.id;
    const backend = createSupabaseBackend();
    stopRef.current = startSyncManager(backend, {
      onSync: (result) => {
        if (toastedForRef.current === userId) return;
        // The manager's first callback is the initial pull-merge-push (its
        // debounced pushes only fire on later local writes).
        toastedForRef.current = userId;
        if (result.error) {
          toast.error(
            "Couldn't reach your cloud data. Your chats are safe on this device — sync will retry.",
          );
          return;
        }
        if (result.undecryptable.length > 0) {
          const n = result.undecryptable.length;
          toast.warning(
            `Connected, but ${n} synced ${n === 1 ? "item" : "items"} couldn't be decrypted on this device. Enter your sync recovery code in Settings → Account → Data.`,
          );
          return;
        }
        const parts: string[] = [];
        if (result.pulled > 0) parts.push(`${result.pulled} downloaded`);
        if (result.pushed > 0) parts.push(`${result.pushed} uploaded`);
        if (result.merged.length > 0) parts.push("chats merged across devices");
        if (result.deletedLocal > 0) parts.push(`${result.deletedLocal} removed`);
        toast.success(
          parts.length > 0
            ? `Account connected (${parts.join(", ")})`
            : "Account connected (All synced)",
        );
      },
    });
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [user, configured]);

  return null;
}
