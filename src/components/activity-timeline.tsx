import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ListChecks,
  Network,
  SquarePen,
  Wrench,
  X,
} from "lucide-react";
import type { ActivityItem, TodoItem } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

function ActivityIcon({ item }: { item: ActivityItem }) {
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
  if (item.kind === "input") return <SquarePen className="size-3 animate-pulse text-blue-500" />;
  return <Wrench className="size-3 animate-pulse text-blue-500" />;
}

export function ActivityTimeline({
  activities,
  todos,
  live,
  defaultOpen,
}: {
  activities: ActivityItem[];
  todos?: TodoItem[];
  live?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const nonTodo = activities.filter((a) => a.kind !== "todo");
  if (nonTodo.length === 0 && (!todos || todos.length === 0)) return null;

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Wrench className="size-3.5" />
        <span className={live ? "shimmer" : undefined}>
          {live ? "Working…" : "Activity"}
        </span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 max-h-60 overflow-y-auto">
          {nonTodo.map((item) => (
            <div key={item.id} className="flex items-start gap-1.5 text-xs">
              <span className="mt-0.5 shrink-0">
                <ActivityIcon item={item} />
              </span>
              <span className="min-w-0">
                <span className="font-medium">
                  {item.kind === "subagent" ? `Subagent: ${item.name}` : item.name}
                </span>
                {item.detail && (
                  <span className="block truncate text-muted-foreground">{item.detail}</span>
                )}
              </span>
            </div>
          ))}
          {todos && todos.length > 0 && (
            <div className="mt-1 flex flex-col gap-0.5 border-t pt-1.5">
              <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <ListChecks className="size-3" /> Todos
              </div>
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
                  <span className="min-w-0">{todo.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
