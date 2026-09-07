import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One folder the console's Access tab opens in this viewer. */
export interface FolderViewerTarget {
  /** Display title ("Private workspace" or the folder's name). */
  title: string;
  /** Absolute path to browse. */
  path: string;
  /** True for the agent's private workspace — shows the stats visualization. */
  isWorkspace?: boolean;
}

interface DirEntryWire {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
}

interface WorkspaceStats {
  files: number;
  folders: number;
  bytes: number;
  lastModified: number;
}

const PREVIEW_CAP = 100_000;

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

async function listEntries(path: string): Promise<DirEntryWire[]> {
  try {
    return await invoke<DirEntryWire[]>("list_dir_entries", { path });
  } catch {
    return [];
  }
}

/** Bounded recursive walk for the workspace stats row (workspaces are small). */
async function workspaceStats(root: string): Promise<WorkspaceStats> {
  const stats: WorkspaceStats = { files: 0, folders: 0, bytes: 0, lastModified: 0 };
  const queue: string[] = [root];
  let visited = 0;
  while (queue.length > 0 && visited < 1000) {
    const dir = queue.shift()!;
    const entries = await listEntries(dir);
    visited += entries.length;
    for (const entry of entries) {
      if (entry.isDir) {
        stats.folders += 1;
        queue.push(entry.path);
      } else {
        stats.files += 1;
        stats.bytes += entry.size;
      }
      stats.lastModified = Math.max(stats.lastModified, entry.modifiedAt ?? 0);
    }
  }
  return stats;
}

interface FilePreview {
  name: string;
  path: string;
  content: string | null;
  truncated: boolean;
}

/**
 * Read-only file viewer for the agent console's Access tab: browse a granted
 * folder (or the private workspace) in a modal — folders navigate via
 * breadcrumb, files preview as capped text. The workspace variant shows a
 * stats header (files, folders, size, last modified) above the browser.
 */
export function FolderViewerDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: FolderViewerTarget | null;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<DirEntryWire[] | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const loadDir = useCallback(async (path: string) => {
    setCurrentPath(path);
    setPreview(null);
    setUnavailable(false);
    setEntries(null);
    const list = await listEntries(path);
    setEntries(list);
    if (list.length === 0) {
      // Distinguish an empty folder from one we cannot read (browser dev).
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    if (!open || !target) return;
    void loadDir(target.path);
    if (target.isWorkspace) {
      setStats(null);
      void workspaceStats(target.path).then(setStats);
    } else {
      setStats(null);
    }
  }, [open, target, loadDir]);

  if (!target) return null;

  const openFile = async (entry: DirEntryWire) => {
    setPreview({ name: entry.name, path: entry.path, content: null, truncated: false });
    try {
      const text = await invoke<string>("read_text_file", { path: entry.path });
      setPreview({
        name: entry.name,
        path: entry.path,
        content: text.slice(0, PREVIEW_CAP),
        truncated: text.length > PREVIEW_CAP,
      });
    } catch {
      setPreview({
        name: entry.name,
        path: entry.path,
        content: null,
        truncated: false,
      });
    }
  };

  // Breadcrumb segments from the viewer's root to the current directory.
  const root = target.path.replace(/\/+$/, "");
  const relSegments =
    currentPath.replace(/\/+$/, "") === root
      ? []
      : currentPath
          .replace(/\/+$/, "")
          .slice(root.length + 1)
          .split("/")
          .filter(Boolean);

  const statChips = stats
    ? [
        { label: "files", value: String(stats.files) },
        { label: "folders", value: String(stats.folders) },
        { label: "size", value: formatBytes(stats.bytes) },
        {
          label: "last modified",
          value: stats.lastModified
            ? new Date(stats.lastModified * 1000).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—",
        },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {target.isWorkspace ? (
              <HardDrive className="size-4 text-muted-foreground" />
            ) : (
              <Folder className="size-4 text-muted-foreground" />
            )}
            {target.title}
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {target.path.replace(/^\/Users\/[^/]+/, "~")}
          </DialogDescription>
        </DialogHeader>

        {target.isWorkspace && (
          <div className="flex flex-wrap gap-2">
            {statChips.length > 0 ? (
              statChips.map((chip) => (
                <div
                  key={chip.label}
                  className="flex min-w-20 flex-col gap-0.5 rounded-lg border bg-muted/30 px-2.5 py-1.5"
                >
                  <span className="text-xs font-medium">{chip.value}</span>
                  <span className="text-[10px] text-muted-foreground">{chip.label}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Gathering workspace stats…
              </div>
            )}
          </div>
        )}

        {/* ─── Breadcrumb ─── */}
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-xs">
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-medium hover:bg-accent"
            onClick={() => void loadDir(target.path)}
          >
            <FolderOpen className="size-3.5 text-muted-foreground" />
            {target.title}
          </button>
          {relSegments.map((segment, i) => (
            <span key={i} className="flex shrink-0 items-center gap-0.5">
              <ChevronRight className="size-3 text-muted-foreground" />
              <button
                type="button"
                className="rounded-md px-1.5 py-1 hover:bg-accent"
                onClick={() =>
                  void loadDir(
                    [root, ...relSegments.slice(0, i + 1)].join("/"),
                  )
                }
              >
                {segment}
              </button>
            </span>
          ))}
        </div>

        {/* ─── Body: file preview or folder listing ─── */}
        {preview ? (
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void loadDir(currentPath)}
              >
                <ArrowLeft className="size-3" />
                Back to folder
              </Button>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {preview.name}
              </span>
            </div>
            <ScrollArea className="h-72 rounded-lg border bg-muted/30">
              {preview.content !== null ? (
                <div className="p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                    {preview.content}
                  </pre>
                  {preview.truncated && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      (Preview truncated at {formatBytes(PREVIEW_CAP)} of text)
                    </p>
                  )}
                </div>
              ) : (
                <p className="p-3 text-xs text-muted-foreground">
                  No text preview available — the file is binary or unreadable.
                </p>
              )}
            </ScrollArea>
          </div>
        ) : entries === null ? (
          <div className="flex h-40 items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            {unavailable
              ? "Nothing here yet — or folder contents are only available in the desktop app."
              : "Empty folder."}
          </div>
        ) : (
          <ScrollArea className="h-72 rounded-lg border">
            <div className="flex flex-col">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="flex items-center gap-2 border-b px-3 py-2 text-left text-xs transition-colors last:border-b-0 hover:bg-accent"
                  onClick={() =>
                    entry.isDir ? void loadDir(entry.path) : void openFile(entry)
                  }
                >
                  {entry.isDir ? (
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={cn("min-w-0 flex-1 truncate", !entry.isDir && "font-mono")}>
                    {entry.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {entry.isDir ? "folder" : formatBytes(entry.size)}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
