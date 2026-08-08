import { useState, useEffect, useMemo, useCallback } from "react";
import { Puzzle, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOpencodeContext } from "@/lib/opencode-context";
import {
  getMcpStatus,
  runOpendcodeMcpAuth,
  getDefaultConfig,
  type McpStatus,
} from "@/lib/opencode";
import { readOpencodeConfig, getMcpEntries, type McpEntry } from "@/lib/opencode-config";
import { getDisabledMcps, setDisabledMcps } from "@/lib/session-mcp";

export function McpPicker() {
  const oc = useOpencodeContext();
  const config = useMemo(() => getDefaultConfig(), []);
  const [entries, setEntries] = useState<Record<string, McpEntry>>({});
  const [status, setStatus] = useState<Record<string, McpStatus>>({});
  const [disabled, setDisabled] = useState<string[]>([]);
  const [authing, setAuthing] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const sessionId = oc.activeSessionId;
  const directory = oc.activeDirectory;

  const refresh = useCallback(async () => {
    const cfg = await readOpencodeConfig(directory);
    setEntries(getMcpEntries(cfg));
    if (oc.serving) {
      try {
        setStatus(await getMcpStatus(config, directory ?? undefined));
      } catch { /* ignore */ }
    }
  }, [config, directory, oc.serving]);

  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

  useEffect(() => {
    setDisabled(getDisabledMcps(sessionId));
  }, [sessionId]);

  const toggle = (name: string, on: boolean) => {
    const next = on ? disabled.filter((n) => n !== name) : [...disabled.filter((n) => n !== name), name];
    setDisabled(next);
    setDisabledMcps(sessionId, next);
  };

  const handleAuth = async (name: string) => {
    setAuthing(name);
    try {
      await runOpendcodeMcpAuth(name);
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const s = await getMcpStatus(config, directory ?? undefined);
          if (s[name]?.status === "connected") {
            toast.success(`${name} authenticated`);
            break;
          }
        } catch { /* keep polling */ }
      }
    } catch {
      toast.error(`Failed to authenticate ${name}`);
    } finally {
      setAuthing(null);
      setTick((t) => t + 1);
    }
  };

  const entryList = Object.entries(entries);
  const enabledCount = entryList.length - disabled.length;

  if (entryList.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="h-6 gap-1 rounded-md px-2 text-xs">
          <Puzzle className="size-3" />
          <span className="max-w-24 truncate">MCPs {enabledCount}/{entryList.length}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>MCP servers (this session)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {entryList.map(([name]) => {
          const isOn = !disabled.includes(name);
          const st = status[name]?.status;
          return (
            <div key={name} className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium">{name}</span>
                {st && st !== "connected" && (
                  <Badge variant={st === "failed" ? "destructive" : "outline"} className="mt-0.5 w-fit text-[9px]">{st.replace("_", " ")}</Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {st === "needs_auth" && (
                  <Button size="xs" variant="ghost" disabled={authing === name} onClick={() => handleAuth(name)} className="h-6 px-1.5">
                    {authing === name ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
                  </Button>
                )}
                <Switch size="sm" checked={isOn} onCheckedChange={(v) => toggle(name, v)} />
              </div>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
