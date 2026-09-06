import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { AgentDefinition, AgentWorkflow, WorkflowStep } from "@/types";
import { saveWorkflow } from "@/lib/workflows";
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
import { Textarea } from "@/components/ui/textarea";

/**
 * Create or edit a linear workflow: ordered steps, each a prompt run by an
 * agent (or the standalone task agent). A step's prompt may reference the
 * previous step's output via {{previous}}.
 */
export function WorkflowDialog({
  open,
  onOpenChange,
  agents,
  /** Existing workflow to edit, or undefined to create. */
  workflow,
  defaultAgentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentDefinition[];
  workflow?: AgentWorkflow | null;
  defaultAgentId?: string;
}) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<WorkflowStep[]>([]);

  useEffect(() => {
    if (!open) return;
    if (workflow) {
      setName(workflow.name);
      setSteps(workflow.steps.map((s) => ({ ...s })));
    } else {
      setName("");
      setSteps([{ agentId: defaultAgentId, prompt: "" }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workflow, defaultAgentId]);

  const canSave = name.trim().length > 0 && steps.every((s) => s.prompt.trim().length > 0);

  const updateStep = (idx: number, patch: Partial<WorkflowStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const handleSave = () => {
    if (!canSave) return;
    saveWorkflow({
      id: workflow?.id ?? crypto.randomUUID(),
      name: name.trim(),
      steps: steps.map((s) => ({
        agentId: s.agentId || undefined,
        prompt: s.prompt.trim(),
      })),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{workflow ? "Edit workflow" : "New workflow"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workflow-name">Name</Label>
            <Input
              id="workflow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Draft → review → publish"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Steps</Label>
            {steps.map((step, idx) => (
              <div key={idx} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {idx + 1}
                  </span>
                  <Select
                    value={step.agentId ?? "__task__"}
                    onValueChange={(v) =>
                      updateStep(idx, { agentId: v === "__task__" ? undefined : v })
                    }
                  >
                    <SelectTrigger size="sm" className="w-52">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__task__">Task agent (standalone)</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={idx === 0}
                    onClick={() => moveStep(idx, -1)}
                    aria-label="Move step up"
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={idx === steps.length - 1}
                    onClick={() => moveStep(idx, 1)}
                    aria-label="Move step down"
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={steps.length === 1}
                    onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Remove step"
                  >
                    <Trash2 />
                  </Button>
                </div>
                <Textarea
                  value={step.prompt}
                  onChange={(e) => updateStep(idx, { prompt: e.target.value })}
                  rows={2}
                  placeholder={
                    idx === 0
                      ? "What this step should do…"
                      : "What this step should do… use {{previous}} for the prior step's output"
                  }
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setSteps((prev) => [...prev, { agentId: undefined, prompt: "" }])}
            >
              <Plus className="size-4" />
              Add step
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canSave} onClick={handleSave}>
              {workflow ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
