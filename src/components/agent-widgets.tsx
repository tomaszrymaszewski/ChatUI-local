import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Circle, ListChecks } from "lucide-react";
import type { TodoItem } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

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
