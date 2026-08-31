import { Check, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input-group";
import type { ApprovalRequest } from "@/lib/agent/types";

/**
 * Approve/deny card shown in place of the composer while an agent-mode run
 * wants to execute a local command (or a coding-agent permission). Mirrors
 * the structured-input form's slot and styling.
 */
export function ApprovalCard({
  request,
  onApprove,
  onDeny,
}: {
  request: ApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const isShell = request.source === "run_command";
  const title = isShell
    ? "Run this command?"
    : request.action === "read"
      ? "Read this file?"
      : request.action === "write"
        ? "Write this file?"
        : "Allow this action?";
  return (
    <InputGroup className="h-auto flex-col items-stretch gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-500" />
            <span className="truncate text-sm font-medium">{title}</span>
          </div>
          {request.reason && (
            <span className="mt-0.5 truncate text-xs text-muted-foreground">
              {request.reason}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-1">
        <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-relaxed">
          {request.command}
        </pre>
        {request.action === "write" && (
          <span className="text-[11px] text-muted-foreground">
            Creates or overwrites the file with the agent's new content.
          </span>
        )}
        {request.cwd && (
          <span className="font-mono text-[11px] text-muted-foreground">
            in {request.cwd}
          </span>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDeny}>
          <X />
          Deny
        </Button>
        <Button size="sm" onClick={onApprove}>
          <Check />
          Approve
        </Button>
      </div>
    </InputGroup>
  );
}
