import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Globe,
  Network,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import type { ActivityItem, ReasoningStream, TodoItem } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

function ActivityChipIcon({ item }: { item: ActivityItem }) {
  if (item.kind === "todo") {
    return item.status === "done" ? (
      <Check className="size-3 text-emerald-500" />
    ) : item.status === "running" ? (
      <Circle className="size-2.5 fill-blue-500/40 text-blue-500" />
    ) : (
      <Circle className="size-2.5 text-muted-foreground/50" />
    );
  }
  if (item.status === "done") return <Check className="size-3 text-emerald-500" />;
  if (item.status === "error") return <X className="size-3 text-red-500" />;
  if (item.kind === "subagent") return <Network className="size-3 animate-pulse text-blue-500" />;
  if (item.kind === "input") return <Pencil className="size-3 animate-pulse text-blue-500" />;
  const name = item.name.toLowerCase();
  if (name === "web_search") return <Search className="size-3 animate-pulse text-blue-500" />;
  if (name === "web_fetch") return <Globe className="size-3 animate-pulse text-blue-500" />;
  if (name === "run_python") return <SquareTerminal className="size-3 animate-pulse text-blue-500" />;
  return <Wrench className="size-3 animate-pulse text-blue-500" />;
}

function Favicon({ url, className }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { /* keep empty */ }
  if (failed || !hostname) return <Globe className={className} />;
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${hostname}.ico`}
      onError={() => setFailed(true)}
      className={cn("object-contain", className)}
      alt=""
    />
  );
}

function ActivityChip({ item }: { item: ActivityItem }) {
  const [expanded, setExpanded] = useState(false);

  if (item.kind === "source" && item.url) {
    let hostname = item.url;
    try { hostname = new URL(item.url).hostname; } catch { /* keep raw */ }
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        title={item.url}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-blue-500 transition-colors hover:bg-accent hover:text-blue-600"
      >
        <span className="shrink-0">
          {item.status === "running" ? (
            <Circle className="size-2.5 animate-pulse fill-blue-500/40 text-blue-500" />
          ) : item.status === "error" ? (
            <X className="size-2.5 text-red-500" />
          ) : (
            <Favicon url={item.url} className="size-2.5" />
          )}
        </span>
        <span className={cn("max-w-[220px] truncate", item.status === "running" && "shimmer")}>
          {item.title || hostname}
        </span>
      </a>
    );
  }

  const label = item.label ?? item.name;
  const doneLabel =
    item.status === "done"
      ? label.replace(/^Searching /, "Searched ").replace(/^Fetching /, "Fetched ").replace(/^Creating /, "Created ").replace(/^Running /, "Ran ")
      : label;

  return (
    <div className="my-1">
      <button
        onClick={() => item.detail && setExpanded((p) => !p)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs transition-colors",
          item.status === "error"
            ? "text-red-500"
            : item.status === "done"
              ? "text-muted-foreground"
              : "text-muted-foreground",
          item.detail && "hover:bg-accent",
        )}
      >
        <span className="shrink-0">
          <ActivityChipIcon item={item} />
        </span>
        <span className={cn(item.status === "running" && "shimmer")}>
          {item.status === "running" ? label : doneLabel}
        </span>
        {item.detail && (
          <span className="shrink-0">
            {expanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
          </span>
        )}
      </button>
      {expanded && item.detail && (
        <div className="mt-0.5 ml-5 max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
          <pre className="whitespace-pre-wrap break-all font-sans">{item.detail}</pre>
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({
  reasoning,
  reasoningMs,
  live,
  label,
}: {
  reasoning: string;
  reasoningMs?: number;
  live?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(true);
  if (!reasoning) return null;

  const defaultLabel = live
    ? "Thinking…"
    : reasoningMs
      ? `Thought for ${Math.max(1, Math.round(reasoningMs / 1000))}s`
      : "Thinking";

  const displayLabel = label
    ? live
      ? `${label} thinking…`
      : reasoningMs
        ? `${label} (${Math.max(1, Math.round(reasoningMs / 1000))}s)`
        : label
    : defaultLabel;

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {live && <Circle className="size-2.5 fill-blue-500/40 text-blue-500" />}
        <span className={cn(live && "shimmer")}>{displayLabel}</span>
        {open ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
      </button>
      {open && (
        <div className="mt-1 max-h-60 overflow-y-auto rounded-lg border bg-muted/20 p-3">
          <MarkdownRenderer content={reasoning} className="text-xs text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function SubagentBox({
  item,
  children,
  reasoning,
  live,
}: {
  item: ActivityItem;
  children: ActivityItem[];
  reasoning?: ReasoningStream;
  live?: boolean;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const running = item.status === "running";
  const open = override ?? running;

  // Auto-collapse when the agent finishes, unless the user manually toggled.
  useEffect(() => {
    if (!running && override === null) {
      setOverride(false);
    }
  }, [running, override]);

  const label = item.label ?? item.name;
  const doneLabel =
    item.status === "done"
      ? label.replace(/^Researching: /, "Researched: ").replace(/^Filling gap: /, "Filled gap: ")
      : label;

  return (
    <div className="my-2 rounded-lg border bg-muted/20">
      <button
        onClick={() => setOverride(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs transition-colors hover:bg-accent/50"
      >
        <span className="shrink-0">
          {item.status === "done" ? (
            <Check className="size-3 text-emerald-500" />
          ) : item.status === "error" ? (
            <X className="size-3 text-red-500" />
          ) : (
            <Network className="size-3 animate-pulse text-blue-500" />
          )}
        </span>
        <span className={cn("font-medium", item.status === "running" && "shimmer")}>
          {item.status === "running" ? label : doneLabel}
        </span>
        <span className="ml-auto shrink-0">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto border-t px-3 py-2">
          {reasoning && reasoning.text && (
            <div className="mb-2">
              <ThinkingBlock
                reasoning={reasoning.text}
                reasoningMs={reasoning.ms}
                label={reasoning.label}
                live={live && reasoning.ms === undefined}
              />
            </div>
          )}
          {children.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {children.map((child) => (
                <ActivityChip key={child.id} item={child} />
              ))}
            </div>
          )}
          {item.output && (
            <div className="mt-2 border-t pt-2">
              <MarkdownRenderer content={item.output} className="text-xs" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-col gap-0.5">
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
  );
}

export interface MessageStreamProps {
  content: string;
  activities?: ActivityItem[];
  reasoning?: string;
  reasoningMs?: number;
  reasoningStreams?: ReasoningStream[];
  todos?: TodoItem[];
  live?: boolean;
  className?: string;
  onOpenArtifact?: (content: string, language: string) => void;
}

/**
 * Renders assistant content with activities and thinking interleaved inline,
 * like the ChatGPT/Claude apps. Activities are positioned at their `textOffset`
 * within the content so they appear at the moment they were called.
 *
 * Sub-agent activities (kind === "subagent") are rendered as collapsible boxes
 * containing their child tool calls, source links, reasoning, and output text.
 */
export function MessageStream({
  content,
  activities,
  reasoning,
  reasoningMs,
  reasoningStreams,
  todos,
  live,
  className,
  onOpenArtifact,
}: MessageStreamProps) {
  const nonTodoActivities = (activities ?? []).filter((a) => a.kind !== "todo");
  const hasContent = content.length > 0;
  const hasActivities = nonTodoActivities.length > 0;
  const hasReasoning = (reasoning?.length ?? 0) > 0;
  const hasStreams = (reasoningStreams?.length ?? 0) > 0;

  if (!hasContent && !hasActivities && !hasReasoning && !hasStreams && !(todos?.length)) {
    return null;
  }

  // Identify sub-agent activities and group children by parentId (or id-prefix
  // fallback for persisted messages from before parentId was introduced).
  const subagentActivities = nonTodoActivities.filter((a) => a.kind === "subagent");
  const subagentIds = new Set(subagentActivities.map((a) => a.id));
  const childIds = new Set<string>();

  const childrenOf = (parentId: string): ActivityItem[] =>
    nonTodoActivities.filter((a) => {
      if (a.id === parentId) return false;
      if (a.parentId === parentId) {
        childIds.add(a.id);
        return true;
      }
      // Fallback: match by id prefix (e.g. "researcher-0-search-1" → parent "researcher-0").
      if (!a.parentId && a.id.startsWith(parentId + "-")) {
        childIds.add(a.id);
        return true;
      }
      return false;
    });

  // Pre-compute children for all sub-agents so childIds is populated before
  // we compute topLevelActivities below. Without this, childIds would still be
  // empty (childrenOf is only called in JSX later) and every child activity
  // would appear both inside its box AND duplicated at the top level.
  const subagentChildren = subagentActivities.map((sa) => childrenOf(sa.id));

  const streamFor = (id: string): ReasoningStream | undefined =>
    reasoningStreams?.find((s) => s.id === id);

  // Top-level reasoning streams = streams whose id does NOT match a sub-agent.
  const topLevelStreams = (reasoningStreams ?? []).filter(
    (s) => !subagentIds.has(s.id),
  );

  // Activities rendered at top level (exclude sub-agent boxes and their children).
  const topLevelActivities = nonTodoActivities.filter(
    (a) => a.kind !== "subagent" && !childIds.has(a.id),
  );

  // Activities that started after some content was already streamed stay
  // interleaved within the text at their textOffset.
  const inlineActivities = topLevelActivities.filter((a) => (a.textOffset ?? 0) > 0);
  const sortedActivities = [...inlineActivities].sort(
    (a, b) => (a.textOffset ?? 0) - (b.textOffset ?? 0),
  );

  const chunks: Array<{ text: string; activity?: ActivityItem }> = [];
  let lastOffset = 0;

  const seenIds = new Set<string>();
  const deduped = sortedActivities.filter((a) => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });

  for (const activity of deduped) {
    const offset = activity.textOffset ?? 0;
    if (offset > lastOffset) {
      chunks.push({ text: content.slice(lastOffset, offset) });
    }
    chunks.push({ text: "", activity });
    lastOffset = offset;
  }
  if (lastOffset < content.length) {
    chunks.push({ text: content.slice(lastOffset) });
  }

  // Chronological timeline of top-level thoughts, sub-agent boxes, and chips
  // that were created before any content streamed. Research/council pipelines
  // emit chairman thoughts both before and after sub-agent runs; ordering by
  // creation seq keeps later thoughts below the sub-agent boxes instead of
  // pinning every thought to the top. Legacy items without seq fall back to
  // the old layout order (streams, then boxes, then chips).
  const hasSubagents = subagentActivities.length > 0;
  const leadChips = topLevelActivities.filter((a) => (a.textOffset ?? 0) === 0);

  type TimelineEntry =
    | { kind: "stream"; key: string; order: number; stream: ReasoningStream }
    | { kind: "box"; key: string; order: number; item: ActivityItem; children: ActivityItem[] }
    | { kind: "chip"; key: string; order: number; item: ActivityItem };

  const timeline: TimelineEntry[] = [];
  if (hasSubagents || topLevelStreams.length > 0 || leadChips.length > 0) {
    topLevelStreams.forEach((s, i) =>
      timeline.push({ kind: "stream", key: `stream-${s.id}`, order: s.seq ?? i, stream: s }),
    );
    subagentActivities.forEach((item, i) =>
      timeline.push({ kind: "box", key: item.id, order: item.seq ?? 1_000_000 + i, item, children: subagentChildren[i] }),
    );
    leadChips.forEach((item, i) =>
      timeline.push({ kind: "chip", key: item.id, order: item.seq ?? 2_000_000 + i, item }),
    );
    timeline.sort((a, b) => a.order - b.order);
  }

  return (
    <div className={className}>
      {timeline.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5">
          {timeline.map((entry) =>
            entry.kind === "stream" ? (
              <ThinkingBlock
                key={entry.key}
                reasoning={entry.stream.text}
                reasoningMs={entry.stream.ms}
                label={entry.stream.label}
                live={live && entry.stream.ms === undefined}
              />
            ) : entry.kind === "box" ? (
              <SubagentBox
                key={entry.key}
                item={entry.item}
                children={entry.children}
                reasoning={streamFor(entry.item.id)}
                live={live}
              />
            ) : (
              <ActivityChip key={entry.key} item={entry.item} />
            ),
          )}
        </div>
      )}
      {hasReasoning && (
        <ThinkingBlock reasoning={reasoning!} reasoningMs={reasoningMs} live={live} />
      )}
      {todos && todos.length > 0 && <TodoList todos={todos} />}
      {chunks.map((chunk, i) => (
        <div key={i}>
          {chunk.activity && <ActivityChip item={chunk.activity} />}
          {chunk.text && <MarkdownRenderer content={chunk.text} onOpenArtifact={onOpenArtifact} />}
        </div>
      ))}
    </div>
  );
}
