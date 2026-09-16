import { useEffect, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  acknowledgeRecoveryCode,
  exportSyncRecoveryCode,
} from "@/lib/sync-crypto";

/**
 * First-run "write down your recovery code" dialog, popped by SyncBootstrap
 * after a clean full sync when this device's key was never confirmed saved.
 * "I've saved it" persists the ack (never shows again); Later/close snoozes
 * until next launch.
 */
export function SaveRecoveryCodeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCode(null);
      void exportSyncRecoveryCode()
        .then(setCode)
        .catch(() => setCode(null));
    }
  }, [open ]);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Recovery code copied");
    } catch {
      toast.error("Couldn't copy — select the code manually");
    }
  };

  const saved = () => {
    acknowledgeRecoveryCode();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Save your sync recovery code
          </DialogTitle>
          <DialogDescription>
            Your cloud data is end-to-end encrypted with a key only this device
            holds — not even the server can read it. Save this code in your
            password manager or on paper: you&apos;ll need it to read your data
            on any other device, and there is no other way to recover it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>Recovery code for this device</Label>
          {code ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                {code}
              </code>
              <Button variant="outline" size="sm" onClick={() => void copy()}>
                <Copy />
                Copy
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Loading recovery code…</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Later
          </Button>
          <Button onClick={saved} disabled={!code}>
            <Check />
            I&apos;ve saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
