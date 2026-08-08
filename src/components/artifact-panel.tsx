import { useState } from "react";
import {
  X,
  Copy,
  Download,
  Code,
  Eye,
  FileCode,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import type { Artifact } from "@/lib/artifacts";
import { isPreviewable } from "@/lib/artifacts";

export function ArtifactPanel({
  artifacts,
  activeIndex,
  onSelectIndex,
  onClose,
}: {
  artifacts: Artifact[];
  activeIndex: number;
  onSelectIndex: (index: number) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const artifact = artifacts[activeIndex];
  if (!artifact) return null;

  const previewable = isPreviewable(artifact.language);
  const effectiveTab = previewable ? tab : "code";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleDownload = () => {
    const ext = artifact.language === "markdown" || artifact.language === "md"
      ? "md"
      : artifact.language === "svg" ? "svg"
      : artifact.language === "html" ? "html"
      : "txt";
    const blob = new Blob([artifact.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.title.replace(/\s+/g, "-").toLowerCase() || "artifact"}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderPreview = () => {
    const lang = artifact.language.toLowerCase();
    if (lang === "html" || lang === "svg") {
      const doc = lang === "svg"
        ? `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;">${artifact.content}</body></html>`
        : artifact.content;
      return (
        <iframe
          srcDoc={doc}
          title={artifact.title}
          sandbox="allow-scripts"
          className="h-full w-full border-0 bg-white"
        />
      );
    }
    if (lang === "markdown" || lang === "md") {
      return (
        <div className="h-full overflow-auto p-4">
          <MarkdownRenderer content={artifact.content} />
        </div>
      );
    }
    return <p className="p-4 text-sm text-muted-foreground">No preview for this language.</p>;
  };

  return (
    <div className="absolute right-0 top-0 z-30 flex h-full w-full max-w-2xl flex-col border-l bg-background shadow-xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <FileCode className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{artifact.title}</span>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
          {artifact.language}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" onClick={handleCopy} aria-label="Copy">
            <Copy className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={handleDownload} aria-label="Download">
            <Download className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close">
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        {previewable && (
          <Button
            variant={effectiveTab === "preview" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setTab("preview")}
          >
            <Eye className="size-3" /> Preview
          </Button>
        )}
        <Button
          variant={effectiveTab === "code" ? "secondary" : "ghost"}
          size="xs"
          onClick={() => setTab("code")}
        >
          <Code className="size-3" /> Code
        </Button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1">
        {effectiveTab === "preview" ? (
          renderPreview()
        ) : (
          <pre className="h-full overflow-auto p-4 text-xs font-mono whitespace-pre-wrap">
            {artifact.content}
          </pre>
        )}
      </div>

      {/* Artifact list */}
      {artifacts.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t px-2 py-1.5">
          {artifacts.map((a, i) => (
            <button
              key={a.id}
              onClick={() => onSelectIndex(i)}
              className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
                i === activeIndex ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {a.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
