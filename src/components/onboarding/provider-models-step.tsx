import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ProviderLogo } from "@/components/provider-logos";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import { fetchModelsFromApi, fetchOllamaModels } from "@/lib/llm";
import { formatModelName } from "@/lib/model-display";
import type { ProviderMeta } from "@/lib/provider-meta";
import type { Provider } from "@/types";
import { cn } from "@/lib/utils";

export function ProviderModelsStep({
  provider,
  meta,
  onAddModels,
  onDone,
  onBack,
  headerBox,
  footerBox,
}: {
  provider: Provider;
  meta: ProviderMeta;
  onAddModels: (modelNames: string[]) => Promise<void>;
  onDone: () => void;
  onBack: () => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const [available, setAvailable] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [manualName, setManualName] = useState("");

  const isOllama = meta.key === "ollama";
  const existingNames = useMemo(
    () => new Set(provider.models.map((m) => m.name)),
    [provider.models],
  );

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const models = isOllama
        ? await fetchOllamaModels()
        : await fetchModelsFromApi(provider);
      const fresh = models.filter((m) => !existingNames.has(m));
      setAvailable(fresh);
      const defaults = new Set(
        fresh.filter((m) => meta.defaultModels.includes(m)),
      );
      if (defaults.size === 0 && fresh.length > 0) defaults.add(fresh[0]);
      setSelected(defaults);
    } catch (err) {
      setAvailable([]);
      setSelected(new Set(meta.defaultModels.filter((m) => !existingNames.has(m))));
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setLoading(false);
    }
  }, [provider, isOllama, meta.defaultModels, existingNames]);

  useEffect(() => {
    void fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id]);

  const list = error && available.length === 0 ? meta.defaultModels.filter((m) => !existingNames.has(m)) : available;

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAddManual = () => {
    const name = manualName.trim();
    if (!name) return;
    if (!list.includes(name)) setAvailable((prev) => [...prev, name]);
    setSelected((prev) => new Set(prev).add(name));
    setManualName("");
  };

  const handleSave = async () => {
    const names = [...selected].filter((n) => !existingNames.has(n));
    if (names.length === 0) return;
    setSaving(true);
    try {
      await onAddModels(names);
      toast.success(`Added ${names.length} model${names.length === 1 ? "" : "s"} from ${meta.name}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add models");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        target={headerBox}
        title="Choose your models"
        subtitle="We picked some good defaults — switch any on or off, then add them."
      >
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
          <ProviderLogo logoKey={meta.logoKey} className="size-7" />
        </div>
      </StepHeader>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {loading ? "Fetching models…" : `${list.length} model${list.length === 1 ? "" : "s"} available`}
          </span>
          <Button variant="ghost" size="sm" onClick={fetchModels} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Contacting {meta.name}…
          </div>
        ) : (
          <>
            {error && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                Couldn't fetch the live model list ({error}). You can still add the
                suggested models below, or try Refresh.
              </div>
            )}
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
              {list.map((name) => (
                <button
                  key={name}
                  onClick={() => toggle(name)}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors",
                    selected.has(name)
                      ? "border-primary/40 bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{formatModelName(name)}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{name}</span>
                  </span>
                  <span className="flex items-center gap-2" onClick={(e) => e.preventDefault()}>
                    {meta.defaultModels.includes(name) && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        recommended
                      </span>
                    )}
                    <Switch checked={selected.has(name)} />
                  </span>
                </button>
              ))}
              {list.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No models found yet.
                </p>
              )}
            </div>
          </>
        )}

        <div className="flex gap-2">
          <Input
            placeholder="Or type a model name manually…"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddManual();
            }}
          />
          <Button variant="outline" onClick={handleAddManual} disabled={!manualName.trim()}>
            <Plus />
            Add
          </Button>
        </div>
      </div>

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft />
            Back to providers
          </Button>
          <Button onClick={handleSave} disabled={saving || selected.size === 0}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Add {selected.size > 0 ? `${selected.size} ` : ""}model{selected.size === 1 ? "" : "s"}
          </Button>
        </div>
      </StepFooter>
    </div>
  );
}
