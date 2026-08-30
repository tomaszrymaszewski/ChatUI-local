import { useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, ExternalLink, Loader2, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProviderLogo } from "@/components/provider-logos";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import { fetchOllamaModels } from "@/lib/llm";
import type { ProviderMeta } from "@/lib/provider-meta";

async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

export function ProviderKeyStep({
  meta,
  baseUrl,
  onSave,
  onBack,
  headerBox,
  footerBox,
}: {
  meta: ProviderMeta;
  baseUrl: string;
  onSave: (name: string, baseUrl: string, apiKey: string) => Promise<void>;
  onBack: () => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [name, setName] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);

  const isCustom = meta.key === "custom";
  const isLocal = !!meta.local;
  const effectiveName = isCustom ? name : meta.name;
  const effectiveBaseUrl = isCustom ? customBaseUrl : baseUrl;

  const canSave =
    !saving &&
    (isCustom ? name.trim() && customBaseUrl.trim() : true) &&
    (isLocal || !meta.keyHelpUrl || apiKey.trim().length > 0 || isCustom);

  const handleCheckOllama = async () => {
    setChecking(true);
    try {
      const models = await fetchOllamaModels();
      setOllamaOk(true);
      toast.success(`Ollama is running — ${models.length} model${models.length === 1 ? "" : "s"} found`);
    } catch {
      setOllamaOk(false);
      toast.error("Couldn't reach Ollama. Is it installed and running?");
    } finally {
      setChecking(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(effectiveName.trim(), effectiveBaseUrl.trim(), apiKey.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <StepHeader target={headerBox} title={`Connect ${meta.name}`} subtitle={meta.tagline}>
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
          <ProviderLogo logoKey={meta.logoKey} className="size-7" />
        </div>
      </StepHeader>

      {meta.tutorial && (
        <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {isLocal ? "How to get Ollama running" : "How to get your key"}
            </span>
            {meta.keyHelpUrl && (
              <Button variant="outline" size="sm" onClick={() => openExternal(meta.keyHelpUrl!)}>
                <ExternalLink />
                {isLocal ? "Download Ollama" : "Get your key"}
              </Button>
            )}
          </div>
          <ol className="flex flex-col gap-2">
            {meta.tutorial.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background font-medium text-foreground shadow-sm">
                  {i + 1}
                </span>
                <span className="pt-0.5 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {isCustom && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="onb-provider-name">Provider name</Label>
              <Input
                id="onb-provider-name"
                placeholder="e.g. Together AI, Groq"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="onb-provider-url">Base URL</Label>
              <Input
                id="onb-provider-url"
                placeholder="https://api.example.com/v1"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The OpenAI-compatible endpoint (without /chat/completions)
              </p>
            </div>
          </>
        )}

        {isLocal ? (
          <div className="flex items-center justify-between rounded-xl border p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Local connection</span>
              <span className="text-xs text-muted-foreground">
                {ollamaOk === true && "Ollama is reachable"}
                {ollamaOk === false && "Ollama is not reachable yet"}
                {ollamaOk === null && "No API key needed — runs on your machine"}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={handleCheckOllama} disabled={checking}>
              {checking ? <Loader2 className="animate-spin" /> : <PlugZap />}
              Check connection
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="onb-api-key">API key</Label>
            <div className="relative">
              <Input
                id="onb-api-key"
                type={showKey ? "text" : "password"}
                placeholder={isCustom ? "Optional, if your endpoint needs one" : "Paste your key here"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored only on this device — it never leaves your computer.
            </p>
          </div>
        )}
      </div>

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="animate-spin" />}
            Save &amp; choose models
            <ArrowRight />
          </Button>
        </div>
      </StepFooter>
    </div>
  );
}
