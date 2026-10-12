import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";

/** Highlight API registry names painted by the ::highlight rules in index.css. */
const FIND_ALL = "conv-find";
const FIND_CURRENT = "conv-find-current";

/** Feature-detect the CSS Custom Highlight API (WKWebView 18.2+, Chrome 105+). */
function highlights(): Map<string, unknown> | undefined {
  return (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
}
function highlightCtor():
  | (new (...ranges: Array<AbstractRange>) => unknown)
  | undefined {
  return (window as unknown as { Highlight?: new (...ranges: Array<AbstractRange>) => unknown })
    .Highlight;
}

/**
 * Find-in-conversation bar (⌘F), styled like a browser's: appears top right,
 * highlights every match in the rendered messages, shows "n/m", Enter /
 * Shift+Enter step through matches, Esc closes. Matches are located with
 * Range walks over the message scroller's text nodes and painted via the
 * Custom Highlight API (no DOM mutation, so React stays happy); when the API
 * is unavailable, counting and scrolling still work without the paint.
 */
export function ConversationSearch({
  open,
  onOpenChange,
  rootRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Container that holds the conversation (we search its message scroller). */
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [current, setCurrent] = useState(0);
  const [paintTick, setPaintTick] = useState(0);
  const [domTick, setDomTick] = useState(0);
  const rangesRef = useRef<Range[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const scroller = () =>
    rootRef.current?.querySelector('[data-slot="message-scroller"]') ?? null;

  const clearPaint = () => {
    const hl = highlights();
    hl?.delete(FIND_ALL);
    hl?.delete(FIND_CURRENT);
  };

  // Follow the conversation while open (streaming runs, edits) — debounced.
  // Watch only the message scroller: the bar's own counter updates must not
  // re-trigger the scan (they'd reset the current match in a loop).
  useEffect(() => {
    if (!open) return;
    const target = scroller() ?? rootRef.current;
    if (!target) return;
    const obs = new MutationObserver(() => setDomTick((t) => t + 1));
    obs.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => obs.disconnect();
  }, [open, rootRef]);

  // Scan for matches.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const q = query.trim();
      const hl = highlights();
      const Ctor = highlightCtor();
      hl?.delete(FIND_ALL);
      hl?.delete(FIND_CURRENT);
      rangesRef.current = [];
      if (q) {
        const root = scroller();
        if (root) {
          const nodes: Text[] = [];
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let n: Node | null;
          while ((n = walker.nextNode())) nodes.push(n as Text);
          const full = nodes.map((t) => t.data).join("").toLowerCase();
          const needle = q.toLowerCase();
          const locate = (pos: number): { node: Text; offset: number } | null => {
            for (const t of nodes) {
              if (pos <= t.data.length) return { node: t, offset: pos };
              pos -= t.data.length;
            }
            return null;
          };
          const ranges: Range[] = [];
          let idx = full.indexOf(needle);
          while (idx !== -1 && ranges.length < 500) {
            const s = locate(idx);
            const e = locate(idx + needle.length);
            if (s && e) {
              const r = document.createRange();
              r.setStart(s.node, s.offset);
              r.setEnd(e.node, e.offset);
              ranges.push(r);
            }
            idx = full.indexOf(needle, idx + needle.length);
          }
          rangesRef.current = ranges;
          if (hl && Ctor && ranges.length > 0) {
            hl.set(FIND_ALL, new Ctor(...ranges));
          }
        }
      }
      setMatchCount(rangesRef.current.length);
      setCurrent(0);
      setPaintTick((t) => t + 1);
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, domTick]);

  // Paint + scroll to the current match.
  useEffect(() => {
    if (!open) return;
    const hl = highlights();
    const Ctor = highlightCtor();
    hl?.delete(FIND_CURRENT);
    const r = rangesRef.current[current];
    if (!r) return;
    if (hl && Ctor) hl.set(FIND_CURRENT, new Ctor(r));
    r.startContainer.parentElement?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintTick, current, open]);

  // Reset on close / unmount.
  useEffect(() => {
    if (open) return;
    clearPaint();
    return () => clearPaint();
  }, [open]);

  if (!open) return null;

  const go = (dir: 1 | -1) => {
    if (matchCount === 0) return;
    setCurrent((c) => (c + dir + matchCount) % matchCount);
  };

  return (
    <div className="absolute top-2 right-3 z-40 flex items-center gap-1.5 rounded-full border bg-card/90 py-1 pr-1.5 pl-3 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-1 duration-200">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onOpenChange(false);
          }
        }}
        placeholder="Find in conversation…"
        className="w-44 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
      />
      {query.trim() !== "" && (
        <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground">
          {matchCount > 0 ? `${current + 1}/${matchCount}` : "0/0"}
        </span>
      )}
      <button
        type="button"
        aria-label="Previous match"
        disabled={matchCount === 0}
        onClick={() => go(-1)}
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <ArrowUp className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        disabled={matchCount === 0}
        onClick={() => go(1)}
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <ArrowDown className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Close search"
        onClick={() => onOpenChange(false)}
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
