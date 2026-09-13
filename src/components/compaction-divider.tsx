import { useState } from "react";
import { ChevronDown, ChevronUp, FoldVertical } from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { cn } from "@/lib/utils";

/**
 * Thick rule marking where a session was compacted: everything above it was
 * replaced by the summary for subsequent runs (the messages themselves are
 * untouched). Collapsed to one row by default; the button uncollapses the
 * summary in a box under the divider.
 */
export function CompactionDivider({ summary, at }: { summary: string; at: number }) {
  const [open, setOpen] = useState(false);
  const date =
    at > 0
      ? new Date(at).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  return (
    <div className="flex flex-col gap-2 py-4" data-testid="compaction-divider">
      <div className="flex items-center gap-3">
        <div aria-hidden className="h-1 min-w-0 flex-1 rounded-full bg-border" />
        <div className="flex shrink-0 items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <FoldVertical className="size-3" />
          <span>Context compacted{date ? ` · ${date}` : ""}</span>
          <button
            onClick={() => setOpen((p) => !p)}
            aria-expanded={open}
            className={cn(
              "flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors",
              "hover:bg-accent hover:text-foreground",
            )}
          >
            {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {open ? "Hide summary" : "Show summary"}
          </button>
        </div>
        <div aria-hidden className="h-1 min-w-0 flex-1 rounded-full bg-border" />
      </div>
      {open && (
        <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          <MarkdownRenderer content={summary} />
        </div>
      )}
    </div>
  );
}
