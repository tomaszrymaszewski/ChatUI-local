import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { mcpIcon } from "@/components/connectors-panel";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import { MCP_CATALOG, type McpCatalogEntry } from "@/lib/mcp-catalog";
import {
  readOpencodeConfig,
  getMcpEntries,
  setMcpEntry,
  removeMcpEntry,
  type McpEntry,
} from "@/lib/opencode-config";
import { cn } from "@/lib/utils";

export function ConnectorsStep({
  onNext,
  onBack,
  headerBox,
  footerBox,
}: {
  onNext: () => void;
  onBack: () => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const config = await readOpencodeConfig(null);
      setEnabled(new Set(Object.keys(getMcpEntries(config))));
    } catch {
      // Config not available yet; leave everything off.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = async (cat: McpCatalogEntry) => {
    setBusy(cat.id);
    try {
      if (enabled.has(cat.id)) {
        await removeMcpEntry(null, cat.id);
        setEnabled((prev) => {
          const next = new Set(prev);
          next.delete(cat.id);
          return next;
        });
      } else {
        const entry: McpEntry =
          cat.install.type === "remote"
            ? { type: "remote", url: cat.install.url, enabled: true }
            : { type: "local", command: cat.install.command, enabled: true };
        await setMcpEntry(null, cat.id, entry);
        setEnabled((prev) => new Set(prev).add(cat.id));
        if (cat.auth === "oauth") {
          toast.success(`${cat.name} added — you'll sign in the first time it's used`);
        } else {
          toast.success(`${cat.name} added`);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to update ${cat.name}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        target={headerBox}
        title="Connect your apps"
        subtitle="Connectors let the AI work with your apps — notes, tasks, code, and more. All optional; add or remove them anytime in Settings."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MCP_CATALOG.map((cat) => {
          const { Icon, tile } = mcpIcon(cat.id);
          const isEnabled = enabled.has(cat.id);
          return (
            <button
              key={cat.id}
              onClick={() => handleToggle(cat)}
              disabled={busy !== null}
              className={cn(
                "flex flex-col gap-2.5 rounded-xl border p-4 text-left transition-colors cursor-pointer",
                isEnabled
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "hover:border-foreground/30 hover:bg-muted/50",
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tile)}>
                  <Icon className="size-4.5" />
                </div>
                {busy === cat.id ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : isEnabled ? (
                  <Trash2 className="size-4 text-muted-foreground" />
                ) : (
                  <Plus className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{cat.name}</span>
                <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {cat.tagline}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onNext}>
              Skip for now
            </Button>
            <Button onClick={onNext}>
              Continue
              <ArrowRight />
            </Button>
          </div>
        </div>
      </StepFooter>
    </div>
  );
}
