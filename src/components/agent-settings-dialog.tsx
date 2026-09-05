import type { AgentDefinition, Project } from "@/types";
import type { AgentUpdatePatch } from "@/lib/agents";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentSettingsForm } from "@/components/agent-settings-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Per-agent settings dialog (sidebar agent → ⋯ → Settings…). The form itself
 * is shared with the agent console's right panel and saves immediately.
 */
export function AgentSettingsDialog({
  agent,
  open,
  onOpenChange,
  onUpdate,
  projects,
  models,
}: {
  agent: AgentDefinition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, patch: AgentUpdatePatch) => void;
  projects: Project[];
  models: Array<{
    id: string;
    name: string;
    displayName?: string;
    providerId: string;
    providerName: string;
  }>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AgentAvatar seed={agent.id} className="size-5" />
            {agent.name}
          </DialogTitle>
          <DialogDescription>
            Changes save immediately. You can also change most of this by
            chatting with the agent — it will suggest changes when needed.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          <AgentSettingsForm
            agent={agent}
            onUpdate={onUpdate}
            projects={projects}
            models={models}
          />
        </div>
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
