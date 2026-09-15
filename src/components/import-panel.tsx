import { useRef, useState } from "react";
import { Archive, ExternalLink, FileUp, Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/provider-logos";
import { cn } from "@/lib/utils";
import {
  importFile,
  type ImportFormat,
  type ImportResult,
} from "@/lib/data-transfer";

async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

interface ImportFormatMeta {
  id: ImportFormat;
  label: string;
  description: string;
  fileHint: string;
  tutorialTitle: string;
  tutorial: string[];
  helpUrl?: string;
  helpButton?: string;
}

export const IMPORT_FORMATS: ImportFormatMeta[] = [
  {
    id: "openai",
    label: "ChatGPT",
    description: "Conversations from an OpenAI data export",
    fileHint: "Pick the .zip (or conversations.json)",
    tutorialTitle: "How to get your ChatGPT export",
    tutorial: [
      "Sign in to ChatGPT, open your profile menu and go to Settings → Data controls.",
      "Under Export data, click Export, then confirm.",
      "Open the email from OpenAI when it arrives and download the .zip — the link expires after 24 hours.",
      "Import that .zip below. No need to unzip it first.",
    ],
    helpUrl: "https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data",
    helpButton: "OpenAI export guide",
  },
  {
    id: "anthropic",
    label: "Claude",
    description: "Conversations from an Anthropic data export",
    fileHint: "Pick the .zip (or conversations.json)",
    tutorialTitle: "How to get your Claude export",
    tutorial: [
      "Click your initials in the bottom-left corner of Claude and open Settings.",
      "Go to the Privacy section and click Export data.",
      "Open the email link when it arrives and download the .zip — it expires after 24 hours.",
      "Import that .zip below. No need to unzip it first.",
    ],
    helpUrl: "https://support.claude.com/en/articles/9450526-export-your-claude-data",
    helpButton: "Anthropic export guide",
  },
  {
    id: "chatui",
    label: "AI Studio backup",
    description: "Everything from another device running this app",
    fileHint: "Pick the backup .json file",
    tutorialTitle: "How to get an AI Studio backup",
    tutorial: [
      "On your other device, open AI Studio → Settings → Data & migration.",
      "Click Export… and choose “AI Studio backup”, then save the .json file.",
      "Import that .json file below. It replaces everything on this device, so keep a backup first if unsure.",
    ],
  },
];

/**
 * Format picker + tutorial + file import, shared by the Settings import dialog
 * and the onboarding import step. The parent decides what happens after a
 * successful import (toast, reload, advance the wizard).
 */
export function ImportPanel({ onImported }: { onImported: (result: ImportResult) => void }) {
  const [format, setFormat] = useState<ImportFormat>("openai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const meta = IMPORT_FORMATS.find((f) => f.id === format)!;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onImported(await importFile(file, { format }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import data");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {IMPORT_FORMATS.map((f) => {
          const selected = f.id === format;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFormat(f.id);
                setError(null);
              }}
              className={cn(
                "flex flex-col gap-2 rounded-xl border p-3 text-left transition-all",
                selected ? "border-primary ring-2 ring-primary/30" : "hover:border-foreground/30",
              )}
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                {f.id === "chatui" ? (
                  <Archive className="size-4" />
                ) : (
                  <ProviderLogo logoKey={f.id} className="size-4" />
                )}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{f.label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{f.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{meta.tutorialTitle}</span>
          {meta.helpUrl && (
            <Button variant="outline" size="sm" onClick={() => openExternal(meta.helpUrl!)}>
              <ExternalLink />
              {meta.helpButton}
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

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
            {busy ? "Importing…" : "Choose file…"}
          </Button>
          <span className="text-xs text-muted-foreground">{meta.fileHint}</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.zip,application/json,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={handleFile}
        />
        {error && (
          <p className="text-xs leading-relaxed text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
