import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { useTheme } from "next-themes";
import {
  X,
  Copy,
  Download,
  Code,
  Eye,
  Play,
  RotateCcw,
  Loader2,
  Minus,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useSidebar } from "@/components/ui/sidebar";
import type { Artifact } from "@/lib/artifacts";
import {
  isPreviewable,
  isRunnable,
  isReactPreviewable,
  getArtifactOverride,
  setArtifactOverride,
  clearArtifactOverride,
  isArtifactModified,
} from "@/lib/artifacts";
import { runPython, type RunPythonResult } from "@/lib/run-python";
import { buildReactPreviewDoc } from "@/lib/react-preview";
import { exportArtifact, exportFormatsFor, type ExportFormat } from "@/lib/export-artifact";
import { cn } from "@/lib/utils";

function languageExtensions(language: string) {
  const lang = language.toLowerCase();
  if (lang === "markdown" || lang === "md") return [markdown()];
  if (lang === "python" || lang === "py") return [python()];
  if (lang === "html") return [html()];
  if (lang === "javascript" || lang === "js" || lang === "jsx") {
    return [javascript({ jsx: true })];
  }
  if (lang === "typescript" || lang === "ts" || lang === "tsx") {
    return [javascript({ jsx: true, typescript: true })];
  }
  return [];
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  md: "Markdown (.md)",
  html: "HTML (.html)",
  pdf: "PDF (.pdf)",
  docx: "Word (.docx)",
  svg: "SVG (.svg)",
  py: "Python (.py)",
  txt: "Text (.txt)",
};

export function ArtifactPanel({
  artifacts,
  activeIndex,
  onSelectIndex,
  onClose,
  windowMode = "open",
  onMinimize,
  onExpand,
}: {
  artifacts: Artifact[];
  activeIndex: number;
  onSelectIndex: (index: number) => void;
  onClose: () => void;
  windowMode?: "open" | "minimized" | "expanded";
  onMinimize: () => void;
  onExpand: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const { setOpen } = useSidebar();
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const artifact = artifacts[activeIndex];

  const [draft, setDraft] = useState<string>("");
  const [modified, setModified] = useState(false);
  const [runResult, setRunResult] = useState<RunPythonResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [reactDoc, setReactDoc] = useState<string | null>(null);
  const [reactError, setReactError] = useState<string | null>(null);
  const [reactLoading, setReactLoading] = useState(false);

  useEffect(() => {
    if (!artifact) return;
    const override = getArtifactOverride(artifact);
    setDraft(override ?? artifact.content);
    setModified(isArtifactModified(artifact));
    setRunResult(null);
    setReactDoc(null);
    setReactError(null);
    setTab(isPreviewable(artifact.language) || isReactPreviewable(artifact.language) ? "preview" : "code");
  }, [artifact?.id, artifact?.content]);

  const extensions = useMemo(
    () => (artifact ? languageExtensions(artifact.language) : []),
    [artifact?.language],
  );

  useEffect(() => {
    if (!artifact || !isReactPreviewable(artifact.language)) return;
    if (tab !== "preview") return;
    let cancelled = false;
    let blobUrl: string | null = null;
    setReactLoading(true);
    setReactError(null);
    buildReactPreviewDoc(draft, artifact.language.toLowerCase() === "tsx" ? "tsx" : "jsx")
      .then(({ doc, blobUrl: url }) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        blobUrl = url;
        setReactDoc(doc);
      })
      .catch((err) => {
        if (!cancelled) {
          setReactError(err instanceof Error ? err.message : String(err));
          setReactDoc(null);
        }
      })
      .finally(() => {
        if (!cancelled) setReactLoading(false);
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [artifact?.id, draft, tab, artifact?.language]);

  // Collapse the app sidebar while the artifact window is open; restore on
  // unmount.  When minimized the sidebar is free to re-open so the user can
  // interact with it.
  useEffect(() => {
    if (windowMode !== "minimized") {
      setOpenRef.current(false);
    }
    return () => { setOpenRef.current(true); };
  }, [windowMode]);

  if (!artifact) return null;

  const previewable = isPreviewable(artifact.language) || isReactPreviewable(artifact.language);
  const runnable = isRunnable(artifact.language);
  const showCodeTab = !["markdown", "md"].includes(artifact.language);
  const showTabBar = previewable && showCodeTab;
  const effectiveTab = previewable && !showCodeTab ? "preview" : previewable ? tab : "code";
  const exportFormats = exportFormatsFor(artifact.language);

  const handleDraftChange = (value: string) => {
    setDraft(value);
    setArtifactOverride(artifact, value);
    setModified(isArtifactModified(artifact));
  };

  const handleReset = () => {
    clearArtifactOverride(artifact);
    setDraft(artifact.content);
    setModified(false);
    toast.success("Reverted to original");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleExport = async (format: ExportFormat) => {
    try {
      await exportArtifact({ title: artifact.title, language: artifact.language, content: draft }, format);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  const handleRun = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setRunResult(null);
    try {
      const result = await runPython(draft);
      setRunResult(result);
    } catch (err) {
      setRunResult({
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: -1,
        timedOut: false,
      });
    } finally {
      setIsRunning(false);
    }
  };

  const renderPreview = () => {
    const lang = artifact.language.toLowerCase();
    if (lang === "html" || lang === "svg") {
      const doc =
        lang === "svg"
          ? `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;">${draft}</body></html>`
          : draft;
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
          <MarkdownRenderer content={draft} />
        </div>
      );
    }
    if (isReactPreviewable(lang)) {
      if (reactLoading) {
        return (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Compiling preview…
          </div>
        );
      }
      if (reactError) {
        return (
          <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-xs text-destructive">
            {reactError}
          </pre>
        );
      }
      if (reactDoc) {
        return (
          <iframe
            srcDoc={reactDoc}
            title={artifact.title}
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full border-0 bg-white"
          />
        );
      }
      return null;
    }
    return <p className="p-4 text-sm text-muted-foreground">No preview for this language.</p>;
  };

  return (
    <div className={cn("flex h-full w-full flex-col overflow-hidden rounded-xl border bg-background shadow-2xl", windowMode !== "expanded" && "max-h-[90vh]")}>
      {/* Title bar with macOS traffic lights */}
      <div className="group/tl relative flex shrink-0 items-center gap-2 border-b px-3 py-2">
        {/* Traffic lights */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onClose}
            className={cn("flex size-3 items-center justify-center rounded-full transition-opacity", windowMode === "minimized" ? "bg-[#bfbfbf]" : "bg-[#ff5f57]")}
            aria-label="Close"
            title="Close"
          >
            <X className="size-2 opacity-0 group-hover/tl:opacity-100" strokeWidth={2.5} />
          </button>
          <button
            onClick={onMinimize}
            className={cn("flex size-3 items-center justify-center rounded-full transition-opacity", windowMode === "minimized" ? "bg-[#bfbfbf]" : "bg-[#febc2e]")}
            aria-label="Minimize"
            title="Minimize"
          >
            <Minus className="size-2 opacity-0 group-hover/tl:opacity-100" strokeWidth={2.5} />
          </button>
          <button
            onClick={onExpand}
            className={cn("flex size-3 items-center justify-center rounded-full transition-opacity", windowMode === "minimized" ? "bg-[#bfbfbf]" : "bg-[#28c840]")}
            aria-label={windowMode === "expanded" ? "Restore size" : "Expand"}
            title={windowMode === "expanded" ? "Restore size" : "Expand"}
          >
            {windowMode === "expanded" ? (
              <Minimize2 className="size-2 opacity-0 group-hover/tl:opacity-100" strokeWidth={2.5} />
            ) : (
              <Maximize2 className="size-2 opacity-0 group-hover/tl:opacity-100" strokeWidth={2.5} />
            )}
          </button>
        </div>

        {/* Centered title */}
        <span className="absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-sm font-medium">
          {artifact.title}
        </span>

        {/* Actions (right) */}
        <div className="ml-auto flex items-center gap-1">
          {modified && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              Modified
            </span>
          )}
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
            {artifact.language}
          </span>
          {runnable && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleRun}
              disabled={isRunning}
              aria-label="Run"
              title="Run with system Python"
            >
              {isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            </Button>
          )}
          {modified && (
            <Button variant="ghost" size="icon-xs" onClick={handleReset} aria-label="Revert edits" title="Revert edits">
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={handleCopy} aria-label="Copy">
            <Copy className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Export" title="Export">
                <Download className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {exportFormats.map((format) => (
                <DropdownMenuItem key={format} onClick={() => handleExport(format)}>
                  {FORMAT_LABELS[format]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs */}
      {showTabBar && (
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
          <Button
            variant={effectiveTab === "preview" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setTab("preview")}
          >
            <Eye className="size-3" /> Preview
          </Button>
          <Button
            variant={effectiveTab === "code" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setTab("code")}
          >
            <Code className="size-3" /> Code
          </Button>
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {effectiveTab === "preview" ? (
          renderPreview()
        ) : (
          <CodeMirror
            value={draft}
            onChange={handleDraftChange}
            extensions={extensions}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            height="100%"
            style={{ height: "100%", fontSize: 12 }}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        )}
      </div>

      {/* Python run output */}
      {runnable && (runResult || isRunning) && (
        <div className="max-h-48 shrink-0 overflow-auto border-t bg-muted/30 p-3 font-mono text-xs">
          {isRunning && <div className="text-muted-foreground">Running…</div>}
          {runResult?.timedOut && (
            <div className="mb-1 text-amber-600 dark:text-amber-400">Timed out — process killed.</div>
          )}
          {runResult?.stdout && <pre className="whitespace-pre-wrap">{runResult.stdout}</pre>}
          {runResult?.stderr && (
            <pre className="whitespace-pre-wrap text-destructive">{runResult.stderr}</pre>
          )}
          {runResult && !runResult.stdout && !runResult.stderr && !runResult.timedOut && (
            <div className="text-muted-foreground">(no output)</div>
          )}
          {runResult && (
            <div className="mt-1 text-muted-foreground">exit code: {runResult.exitCode}</div>
          )}
        </div>
      )}

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
