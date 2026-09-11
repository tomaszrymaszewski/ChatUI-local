import {
  Bot,
  BookOpen,
  Calendar,
  CalendarClock,
  Check,
  Circle,
  Clock,
  CloudSun,
  Code,
  FileCode,
  FileDown,
  FileInput,
  FilePen,
  Globe,
  Lightbulb,
  ListChecks,
  MessagesSquare,
  Network,
  Pencil,
  Plug,
  Search,
  Sparkles,
  SquareTerminal,
  Terminal,
  UserCog,
  Wrench,
  Workflow,
  X,
} from "lucide-react";
import { useState } from "react";
import type { ActivityItem } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

/** Site favicon via DuckDuckGo's icon service, falling back to a globe.
 *  Dimmed by default; full opacity when hovered (or when the parent chip,
 *  marked `group`, is hovered). */
export function Favicon({ url, className }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { /* keep empty */ }
  if (failed || !hostname) return <Globe className={className} />;
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${hostname}.ico`}
      onError={() => setFailed(true)}
      className={cn(
        "object-contain opacity-40 transition-opacity group-hover:opacity-100 hover:opacity-100",
        className,
      )}
      alt=""
    />
  );
}

/** Raw tool name → display label: `write_todos` → "Write todos". */
export function formatToolName(name: string): string {
  const words = name.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function toolIcon(name: string) {
  switch (name) {
    case "web_search": return Search;
    case "web_fetch": return Globe;
    case "run_python":
    case "run_node": return SquareTerminal;
    case "run_command": return Terminal;
    case "run_coding_task": return Code;
    case "create_artifact": return FileCode;
    case "share_files": return FileDown;
    case "get_current_time": return Clock;
    case "get_current_date": return Calendar;
    case "get_weather": return CloudSun;
    case "search_skills": return Sparkles;
    case "search_connectors": return Plug;
    case "suggest": return Lightbulb;
    case "schedule_task":
    case "list_schedules":
    case "update_schedule":
    case "delete_schedule": return CalendarClock;
    case "create_workflow":
    case "delete_workflow": return Workflow;
    case "search_chats": return MessagesSquare;
    case "search_knowledge": return BookOpen;
    case "read_local_file": return FileInput;
    case "write_local_file": return FilePen;
    case "create_agent": return Bot;
    case "update_agent": return UserCog;
    case "write_todos":
    case "todo": return ListChecks;
    case "request_structured_input": return Pencil;
    default: return Wrench;
  }
}

/**
 * Icon for an inline activity chip/tool call — one distinct icon per tool,
 * kept across statuses (running = blue pulse, done = muted, error = red X).
 * Visited websites (web_fetch with a url) show the site's favicon.
 */
export function ActivityIcon({ item, className }: { item: ActivityItem; className?: string }) {
  if (item.kind === "todo") {
    return item.status === "done" ? (
      <Check className={cn("text-emerald-500", className)} />
    ) : item.status === "running" ? (
      <Circle className={cn("fill-blue-500/40 text-blue-500", className)} />
    ) : (
      <Circle className={cn("text-muted-foreground/50", className)} />
    );
  }
  if (item.status === "error") {
    return <X className={cn("text-red-500", className)} />;
  }
  const statusCls =
    item.status === "done"
      ? "text-muted-foreground"
      : "animate-pulse text-blue-500";
  if (item.kind === "subagent") {
    return <Network className={cn(statusCls, className)} />;
  }
  if (item.kind === "input") {
    return <Pencil className={cn(statusCls, className)} />;
  }
  if (item.name === "web_fetch" && item.url) {
    return <Favicon url={item.url} className={className} />;
  }
  const Icon = toolIcon(item.name.toLowerCase());
  return <Icon className={cn(statusCls, className)} />;
}
