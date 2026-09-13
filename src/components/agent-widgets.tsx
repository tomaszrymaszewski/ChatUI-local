import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Download,
  FileText,
  FoldVertical,
  Gauge,
  ListChecks,
  Loader2,
} from "lucide-react";
import type { SharedFile, TodoItem } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Exact token counts with thousands separators. */
function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** Session spend: cents show 2 decimals, fractions of a cent show 4. */
function formatCost(dollars: number): string {
  if (!Number.isFinite(dollars) || dollars <= 0) return "—";
  const digits = dollars < 0.01 ? 4 : 2;
  return `$${dollars.toFixed(digits)}`;
}

/** One label/value row of the context widget's body. */
function UsageRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-center justify-between gap-2" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px]">{value}</span>
    </div>
  );
}

/**
 * Context-window usage of the session — a usage bar plus the exact input,
 * cached-input and output token counts and the estimated spend of the
 * conversation so far. Numbers come from the provider's usage_metadata on
 * each model call (zero until the first response reports them); spend is
 * priced at models.dev list prices. The Compact button summarizes older
 * turns so subsequent runs carry more fresh context in the same window.
 */
export function ContextWidget({
  usage,
  contextLimit,
  canCompact,
  compacting,
  onCompact,
}: {
  usage: {
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    contextTokens: number;
    costDollars: number;
  };
  contextLimit: number | null;
  canCompact: boolean;
  compacting: boolean;
  onCompact: () => void;
}) {
  const [open, setOpen] = useState(true);
  const pct =
    contextLimit && usage.contextTokens > 0
      ? Math.min(100, Math.round((usage.contextTokens / contextLimit) * 100))
      : null;
  const barClass =
    pct === null
      ? "bg-muted-foreground/40"
      : pct >= 80
        ? "bg-red-500"
        : pct >= 50
          ? "bg-amber-500"
          : "bg-emerald-500";
  return (
    <div className="pointer-events-auto overflow-hidden rounded-xl border bg-card shadow-lg">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors hover:bg-accent/50"
      >
        <Gauge className="size-3.5 text-muted-foreground" />
        <span>Context</span>
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">
          {pct === null ? formatTokens(usage.contextTokens) : `${pct}%`}
        </span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t px-3 py-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-[width]", barClass)}
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          <div className="flex flex-col gap-0.5 text-xs">
            <UsageRow
              label="Input"
              value={formatTokens(usage.inputTokens)}
              title="Total prompt tokens across every model call this session — each agent step re-sends the full context, so this grows much faster than any single call"
            />
            <UsageRow
              label="Cached input"
              value={formatTokens(usage.cachedTokens)}
              title="Subset of Input served from the provider's prompt cache (billed at a discount, not extra)"
            />
            <UsageRow
              label="Output"
              value={formatTokens(usage.outputTokens)}
              title="Total completion tokens produced this session"
            />
            <UsageRow
              label="Cost"
              value={formatCost(usage.costDollars)}
              title="Estimated session spend at models.dev list prices for the session model (cached input at the cache-read price). Shown as — while the model is unpriced."
            />
            <UsageRow
              label="Window"
              value={
                contextLimit
                  ? `${formatTokens(usage.contextTokens)} / ${formatTokens(contextLimit)}`
                  : formatTokens(usage.contextTokens)
              }
              title="Only the most recent model call's input + output versus the model's context window — this (not Input) is how full the window is"
            />
          </div>
          <button
            onClick={onCompact}
            disabled={compacting || !canCompact}
            title="Summarize older turns to free context for the next runs"
            className="flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          >
            {compacting ? <Loader2 className="size-3 animate-spin" /> : <FoldVertical className="size-3" />}
            {compacting ? "Compacting…" : "Compact"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Floating widget overlay for the agent view — cards pinned to the top-right
 * of the session area. While visible, the chat column reserves matching
 * right-hand space (see ChatView), so widgets never cover chat text. Toggling
 * `visible` slides the stack out of/into the right edge. New widgets slot in
 * as additional children of the stack (each card re-enables pointer events
 * itself).
 */
export function WidgetStack({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "pointer-events-none absolute top-3 right-3 z-30 flex w-72 flex-col gap-2 transition-[transform,opacity] duration-300 ease-out",
        visible
          ? "translate-x-0 opacity-100"
          : "pointer-events-none translate-x-[calc(100%+0.75rem)] opacity-0",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The agent's live task plan (write_todos todo list) as a collapsible card.
 * Renders nothing while the agent has no todos.
 */
export function TasksWidget({ todos }: { todos: TodoItem[] }) {
  const [open, setOpen] = useState(true);
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div className="pointer-events-auto overflow-hidden rounded-xl border bg-card shadow-lg">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors hover:bg-accent/50"
      >
        <ListChecks className="size-3.5 text-muted-foreground" />
        <span>Tasks</span>
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">
          {done}/{todos.length}
        </span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>
      {open && (
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto border-t px-3 py-2">
          {todos.map((todo, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-1.5 text-xs",
                todo.status === "completed" && "text-muted-foreground line-through",
              )}
            >
              <span className="mt-0.5 shrink-0">
                {todo.status === "completed" ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <Circle
                    className={cn(
                      "size-2.5",
                      todo.status === "in_progress"
                        ? "fill-blue-500/40 text-blue-500"
                        : "text-muted-foreground/50",
                    )}
                  />
                )}
              </span>
              <span>{todo.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Files generated during the session (write_local_file results and share_files
 * shares) as a collapsible card beneath the task plan. Each row downloads the
 * file via the existing shared-file download flow. Renders nothing while the
 * session has no files.
 */
export function FilesWidget({
  files,
  onDownload,
}: {
  files: SharedFile[];
  onDownload: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (files.length === 0) return null;
  return (
    <div className="pointer-events-auto overflow-hidden rounded-xl border bg-card shadow-lg">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors hover:bg-accent/50"
      >
        <FileText className="size-3.5 text-muted-foreground" />
        <span>Files</span>
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">
          {files.length}
        </span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>
      {open && (
        <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto border-t px-3 py-2">
          {files.map((f) => (
            <button
              key={f.path}
              onClick={() => onDownload(f.path)}
              title={f.path}
              className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {f.size !== undefined && (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatBytes(f.size)}
                </span>
              )}
              <Download className="size-3 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
