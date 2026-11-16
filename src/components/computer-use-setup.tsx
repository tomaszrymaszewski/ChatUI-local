import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkComputerUse,
  installComputerUse,
  openPrivacySettings,
  type ComputerUseStatus,
  type PrivacyPane,
} from "@/lib/computer-use";

type Phase = "checking" | "idle" | "installing";

function Row({
  ok,
  label,
  hint,
  action,
}: {
  ok: boolean | null;
  label: string;
  hint?: string;
  /** Optional trailing action (e.g. "Open settings") shown when not granted. */
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok === true ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      ) : (
        <CircleAlert
          className={cn(
            "mt-0.5 size-4 shrink-0",
            ok === false ? "text-amber-500" : "text-muted-foreground",
          )}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={ok === true ? "text-foreground" : "text-muted-foreground"}>
          {label}
        </span>
        {hint && ok !== true && (
          <span className="text-xs text-muted-foreground">{hint}</span>
        )}
      </div>
      {action && ok !== true && (
        <Button
          variant="outline"
          size="sm"
          onClick={action.onClick}
          className="h-7 shrink-0 gap-1.5 px-2 text-xs"
        >
          <ExternalLink className="size-3.5" />
          {action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * Checks that desktop Computer Use (open-computer-use) is installed and
 * permitted, and guides the user through installing the CLI and granting macOS
 * Accessibility / Screen Recording. Used in onboarding and in Settings; it
 * only drives the external helper, never the opt-in setting itself.
 */
export function ComputerUseSetup({ className }: { className?: string }) {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPhase("checking");
    setError(null);
    try {
      setStatus(await checkComputerUse());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = async () => {
    setPhase("installing");
    setError(null);
    try {
      await installComputerUse();
      setStatus(await checkComputerUse());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  };

  const openPane = async (pane: PrivacyPane) => {
    setError(null);
    try {
      // Running doctor first registers AI Studio in the macOS permission list
      // (with its label), so the user finds it ready to toggle / drag in. Then
      // jump straight to the right System Settings pane.
      if (installed) await checkComputerUse().catch(() => {});
      await openPrivacySettings(pane);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const busy = phase === "installing" || phase === "checking";
  const installed = status?.installed ?? false;
  // macOS reports permission flags; other platforms leave them null, so a
  // null permission on an installed CLI is treated as "nothing to show".
  const needsPermission =
    installed && (status?.accessibility === false || status?.screenRecording === false);

  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border bg-card/60 p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Computer Use setup</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={busy}
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        >
          {phase === "checking" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Recheck
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Row
          ok={installed}
          label={installed ? "Helper installed" : "Helper not installed"}
          hint="The open-computer-use command-line helper powers desktop control."
        />
        <Row
          ok={status?.accessibility ?? null}
          label="Accessibility permission"
          hint="Opens Privacy & Security → Accessibility. Toggle AI Studio on (or drag it into the list)."
          action={{
            label: "Open settings",
            onClick: () => void openPane("accessibility"),
          }}
        />
        <Row
          ok={status?.screenRecording ?? null}
          label="Screen Recording permission"
          hint="Opens Privacy & Security → Screen Recording. Toggle AI Studio on (or drag it into the list)."
          action={{
            label: "Open settings",
            onClick: () => void openPane("screen-recording"),
          }}
        />
      </div>

      {!installed && (
        <Button onClick={install} disabled={busy} size="sm" className="gap-2">
          {phase === "installing" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Installing…
            </>
          ) : (
            <>
              <Download className="size-4" />
              Install helper
            </>
          )}
        </Button>
      )}

      {installed && needsPermission && (
        <p className="text-xs text-muted-foreground">
          Grant the permissions above in System Settings, then click Recheck.
          The first time an agent uses Computer Use, macOS may prompt you
          automatically.
        </p>
      )}

      {installed && status?.ready && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          Ready to use.
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive">
          {error}
          {error.toLowerCase().includes("npm") && " — install Node.js, then try again."}
        </p>
      )}
    </div>
  );
}
