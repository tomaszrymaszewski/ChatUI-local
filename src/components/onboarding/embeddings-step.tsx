import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import {
  EMBEDDING_MODELS,
  RECOMMENDED_EMBEDDING_MODEL,
  preloadEmbeddingModel,
  type EmbeddingProgressInfo,
} from "@/lib/embeddings";
import { cn } from "@/lib/utils";

type DownloadState =
  | { phase: "idle" }
  | { phase: "downloading"; file?: string; progress: number }
  | { phase: "done" }
  | { phase: "error"; message: string };

export function EmbeddingsStep({
  selected,
  onSelect,
  onDone,
  onBack,
  headerBox,
  footerBox,
}: {
  selected: string;
  onSelect: (modelId: string) => void;
  onDone: () => void;
  onBack: () => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const [download, setDownload] = useState<DownloadState>({ phase: "idle" });

  const handleProgress = (info: EmbeddingProgressInfo) => {
    if (info.status === "progress" && info.file && (info.total ?? 0) > 0) {
      setDownload({
        phase: "downloading",
        file: info.file.split("/").pop(),
        progress: Math.round(((info.loaded ?? 0) / (info.total ?? 1)) * 100),
      });
    } else if (info.status === "done") {
      setDownload((prev) =>
        prev.phase === "downloading" ? prev : { phase: "downloading", progress: 100 },
      );
    }
  };

  const handleContinue = async () => {
    setDownload({ phase: "downloading", progress: 0 });
    try {
      await preloadEmbeddingModel(selected, handleProgress);
      setDownload({ phase: "done" });
      onDone();
    } catch (err) {
      setDownload({
        phase: "error",
        message:
          err instanceof Error
            ? err.message
            : "Couldn't download the model right now.",
      });
    }
  };

  const busy = download.phase === "downloading";

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        target={headerBox}
        title="Search inside your files"
        subtitle="A small local model reads your uploaded documents so the chat can find the right passages. It runs entirely on your Mac."
      />

      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">Embedding model</span>
        <div className="flex flex-col gap-3">
          {EMBEDDING_MODELS.map((model) => {
            const isSelected = selected === model.id;
            const recommended = model.id === RECOMMENDED_EMBEDDING_MODEL;
            return (
              <button
                key={model.id}
                type="button"
                disabled={busy}
                onClick={() => onSelect(model.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 text-left transition-all disabled:opacity-60",
                  isSelected
                    ? "border-primary ring-2 ring-primary/30"
                    : "hover:border-foreground/30",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{model.label}</span>
                    {recommended && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Recommended
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {model.size} · {model.dims} dimensions · downloads locally
                  </span>
                </div>
                {isSelected && (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {download.phase === "downloading" && (
        <div className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <Loader2 className="size-3.5 animate-spin" />
              Downloading {download.file ? `${download.file}…` : "model…"}
            </span>
            <span className="text-muted-foreground">{download.progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${download.progress}%` }}
            />
          </div>
        </div>
      )}

      {download.phase === "error" && (
        <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <span className="text-xs font-medium text-destructive">
            {download.message}
          </span>
          <span className="text-xs text-muted-foreground">
            You can continue — the model will download automatically the first
            time you attach a file.
          </span>
        </div>
      )}

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            <ArrowLeft />
            Back
          </Button>
          {download.phase === "error" ? (
            <Button onClick={onDone}>
              Continue anyway
              <ArrowRight />
            </Button>
          ) : (
            <Button onClick={() => void handleContinue()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Download />}
              {busy ? "Downloading…" : "Download & continue"}
            </Button>
          )}
        </div>
      </StepFooter>
    </div>
  );
}
