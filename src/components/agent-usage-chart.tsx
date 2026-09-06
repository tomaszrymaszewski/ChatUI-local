import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  getAgentDailyUsage,
  subscribeToAgentUsage,
  type DailyUsage,
} from "@/lib/agent-usage";
import { cn } from "@/lib/utils";

const DAYS = 14;

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Recent token usage for one agent — plain div bars (no chart dependency).
 * Values are chars/4 estimates (see agent-usage.ts); the caption says so.
 * Refreshes live when runs complete (usage store subscription).
 */
export function AgentUsageChart({ agentId }: { agentId: string }) {
  const [days, setDays] = useState<DailyUsage[]>(() => getAgentDailyUsage(agentId, DAYS));

  useEffect(() => {
    setDays(getAgentDailyUsage(agentId, DAYS));
    return subscribeToAgentUsage(() => setDays(getAgentDailyUsage(agentId, DAYS)));
  }, [agentId]);

  const total = days.reduce((n, d) => n + d.tokens, 0);
  const runs = days.reduce((n, d) => n + d.runs, 0);
  const max = Math.max(1, ...days.map((d) => d.tokens));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <BarChart3 className="size-3.5 self-center text-muted-foreground" />
        <span className="text-sm font-medium">Usage</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {total === 0
            ? "no runs yet"
            : `${formatTokens(total)} tokens (est.) · ${runs} run${runs === 1 ? "" : "s"} · last ${DAYS} days`}
        </span>
      </div>
      {total === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          Token usage per day appears here once {`this agent`} runs.
        </p>
      ) : (
        <div
          className="flex h-24 items-end gap-1.5"
          role="img"
          aria-label={`Token usage, last ${DAYS} days, ${formatTokens(total)} total (estimated)`}
        >
          {days.map((d, i) => (
            <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-16 w-full items-end">
                <div
                  title={`${d.day}: ${formatTokens(d.tokens)} tokens (est.) · ${d.runs} run${d.runs === 1 ? "" : "s"}`}
                  className={cn(
                    "w-full rounded-sm",
                    d.tokens === 0
                      ? "h-0.5 bg-border"
                      : i === days.length - 1
                        ? "bg-primary/80"
                        : "bg-primary/40 hover:bg-primary/60",
                  )}
                  style={d.tokens === 0 ? undefined : { height: `${Math.max(6, (d.tokens / max) * 100)}%` }}
                />
              </div>
              <span className="truncate text-[9px] text-muted-foreground">
                {d.label.split(" ")[0]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
