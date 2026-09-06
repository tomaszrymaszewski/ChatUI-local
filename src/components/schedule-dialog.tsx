import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { AgentDefinition, AgentSchedule, ScheduleCadence } from "@/types";
import { computeNextRun, describeCadence, saveSchedule } from "@/lib/schedules";
import { loadWorkflows } from "@/lib/workflows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type CadenceKind = ScheduleCadence["kind"];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Create or edit a schedule: a prompt (or workflow) that runs an agent on a
 * cadence while the app is open. The next run time is computed on save.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  agents,
  /** Existing schedule to edit, or undefined/creating a new one. */
  schedule,
  /** Pre-select this agent when creating (the console's agent). */
  defaultAgentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentDefinition[];
  schedule?: AgentSchedule | null;
  defaultAgentId?: string;
}) {
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<string | "task">("task");
  const [target, setTarget] = useState<"prompt" | "workflow">("prompt");
  const [prompt, setPrompt] = useState("");
  const [workflowId, setWorkflowId] = useState<string | "none">("none");
  const [cadenceKind, setCadenceKind] = useState<CadenceKind>("daily");
  const [timeHHMM, setTimeHHMM] = useState("09:00");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [runAtLocal, setRunAtLocal] = useState("");
  const [workflows, setWorkflows] = useState(loadWorkflows());

  // Re-read the workflow list each open (cheap, storage-backed).
  useEffect(() => {
    if (open) setWorkflows(loadWorkflows());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setName(schedule.name);
      setAgentId(schedule.agentId ?? "task");
      setTarget(schedule.workflowId ? "workflow" : "prompt");
      setPrompt(schedule.prompt ?? "");
      setWorkflowId(schedule.workflowId ?? "none");
      const c = schedule.cadence;
      setCadenceKind(c.kind);
      setTimeHHMM(c.timeHHMM ?? "09:00");
      setWeekdays(c.weekdays?.length ? c.weekdays : [1]);
      setIntervalMinutes(c.intervalMinutes ?? 60);
      setRunAtLocal(c.runAt ? toDatetimeLocal(c.runAt) : "");
    } else {
      setName("");
      setAgentId(defaultAgentId ?? "task");
      setTarget("prompt");
      setPrompt("");
      setWorkflowId("none");
      setCadenceKind("daily");
      setTimeHHMM("09:00");
      setWeekdays([1]);
      setIntervalMinutes(60);
      setRunAtLocal("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule, defaultAgentId]);

  const buildCadence = (): ScheduleCadence | null => {
    switch (cadenceKind) {
      case "daily":
        return { kind: "daily", timeHHMM };
      case "weekly":
        return { kind: "weekly", timeHHMM, weekdays };
      case "interval":
        return { kind: "interval", intervalMinutes };
      case "once":
        if (!runAtLocal) return null;
        return { kind: "once", runAt: new Date(runAtLocal).toISOString() };
    }
  };

  const canSave =
    name.trim().length > 0 &&
    (target === "workflow"
      ? workflowId !== "none"
      : prompt.trim().length > 0) &&
    buildCadence() !== null;

  const handleSave = () => {
    const cadence = buildCadence();
    if (!cadence || !canSave) return;
    const nextRun = computeNextRun(cadence, new Date());
    if (!nextRun) {
      toast.error("That schedule can never fire — check the time");
      return;
    }
    saveSchedule({
      id: schedule?.id,
      name: name.trim(),
      agentId: agentId === "task" ? undefined : agentId,
      workflowId: target === "workflow" ? (workflowId === "none" ? undefined : workflowId) : undefined,
      prompt: target === "prompt" ? prompt.trim() : undefined,
      cadence,
      enabled: schedule?.enabled ?? true,
      nextRun: nextRun.toISOString(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{schedule ? "Edit schedule" : "New schedule"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-name">Name</Label>
            <Input
              id="schedule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Morning report"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Runs as</Label>
              <Select
                value={agentId}
                onValueChange={(v) => setAgentId(v as string | "task")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">Task agent (standalone)</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Runs</Label>
              <Select
                value={target}
                onValueChange={(v) => setTarget(v as "prompt" | "workflow")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prompt">A prompt</SelectItem>
                  <SelectItem value="workflow" disabled={workflows.length === 0}>
                    A workflow
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {target === "prompt" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="schedule-prompt">Prompt</Label>
              <Textarea
                id="schedule-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="What the agent should do on each run…"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>Workflow</Label>
              <Select
                value={workflowId}
                onValueChange={(v) => setWorkflowId(v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name} ({w.steps.length} steps)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Cadence</Label>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["daily", "Daily"],
                  ["weekly", "Weekly"],
                  ["interval", "Interval"],
                  ["once", "Once"],
                ] as Array<[CadenceKind, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCadenceKind(key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    cadenceKind === key
                      ? "border-foreground bg-foreground text-background"
                      : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {cadenceKind !== "interval" && cadenceKind !== "once" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">at</span>
                <Input
                  type="time"
                  value={timeHHMM}
                  onChange={(e) => setTimeHHMM(e.target.value)}
                  className="w-28"
                />
              </div>
            )}
            {cadenceKind === "weekly" && (
              <div className="flex flex-wrap gap-1">
                {WEEKDAY_LABELS.map((label, idx) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      setWeekdays((prev) =>
                        prev.includes(idx)
                          ? prev.filter((d) => d !== idx)
                          : [...prev, idx].sort((a, b) => a - b),
                      )
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      weekdays.includes(idx)
                        ? "border-foreground bg-foreground text-background"
                        : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {cadenceKind === "interval" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">every</span>
                <Input
                  type="number"
                  min={5}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value) || 0)}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            )}
            {cadenceKind === "once" && (
              <Input
                type="datetime-local"
                value={runAtLocal}
                onChange={(e) => setRunAtLocal(e.target.value)}
                className="w-56"
              />
            )}
            <p className="text-xs text-muted-foreground">
              {buildCadence()
                ? `Next run: ${
                    (() => {
                      const next = computeNextRun(buildCadence()!, new Date());
                      return next
                        ? next.toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "never (time already passed)";
                    })()
                  } — ${describeCadence(buildCadence()!)}`
                : "Pick a time for the run."}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={schedule?.enabled ?? true}
                onCheckedChange={(enabled) => {
                  if (schedule) {
                    saveSchedule({ ...schedule, enabled });
                  }
                }}
                disabled={!schedule}
              />
              Enabled (edit later)
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!canSave} onClick={handleSave}>
                {schedule ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
