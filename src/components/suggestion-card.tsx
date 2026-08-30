import { useState } from "react";
import {
  ArrowUp,
  SquarePen,
  Sparkles,
  Plug,
  GraduationCap,
  Microscope,
  UsersRound,
  Check,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input-group";
import { toast } from "sonner";
import {
  installBundledSkill,
  installCuratedSkill,
  CURATED_SKILLS,
  getBundledSkillContent,
} from "@/lib/skills-library";
import type { SuggestionRequest } from "@/lib/agent/types";

export function SuggestionCard({
  suggestion,
  onDismiss,
  onInstallSkill,
  onOpenConnectors,
  onEnableMode,
}: {
  suggestion: SuggestionRequest;
  onDismiss: () => void;
  onInstallSkill: (name: string) => Promise<void>;
  onOpenConnectors: () => void;
  onEnableMode: (mode: "council" | "learn" | "research") => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  const icon =
    suggestion.kind === "skill" ? (
      <Sparkles className="size-4" />
    ) : suggestion.kind === "connector" ? (
      <Plug className="size-4" />
    ) : suggestion.target === "learn" ? (
      <GraduationCap className="size-4" />
    ) : suggestion.target === "research" ? (
      <Microscope className="size-4" />
    ) : (
      <UsersRound className="size-4" />
    );

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await onInstallSkill(suggestion.target);
      setInstalled(true);
      toast.success(`Installed skill: ${suggestion.target}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to install skill: ${suggestion.target}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleConnect = () => {
    onOpenConnectors();
    onDismiss();
  };

  const handleEnableMode = () => {
    onEnableMode(suggestion.target as "council" | "learn" | "research");
    onDismiss();
  };

  return (
    <InputGroup className="h-auto flex-col items-stretch gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            {icon}
            <span className="truncate text-sm font-medium">{suggestion.title}</span>
          </div>
          <span className="truncate text-xs text-muted-foreground mt-0.5">
            {suggestion.reason}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Dismiss and go back to text input"
        >
          <SquarePen className="size-3.5" />
          Back to text
        </button>
      </div>

      <div className="flex items-center gap-2">
        {suggestion.kind === "skill" && !installed && (
          <Button size="sm" onClick={() => void handleInstall()} disabled={installing}>
            {installing ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            Install skill
          </Button>
        )}
        {suggestion.kind === "skill" && installed && (
          <Button size="sm" variant="outline" onClick={onDismiss} disabled>
            <Check />
            Installed
          </Button>
        )}
        {suggestion.kind === "connector" && (
          <Button size="sm" onClick={handleConnect}>
            <Plug />
            Open Connectors
          </Button>
        )}
        {suggestion.kind === "mode" && (
          <Button size="sm" onClick={handleEnableMode}>
            <ArrowUp />
            Turn on
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </InputGroup>
  );
}

/**
 * Helper that resolves a skill name to the correct install function.
 * Bundled skills use installBundledSkill; curated skills use installCuratedSkill.
 */
export async function installSkillByName(name: string): Promise<void> {
  if (getBundledSkillContent(name)) {
    await installBundledSkill(name, "global");
    return;
  }
  const curated = CURATED_SKILLS.find((s) => s.name === name);
  if (curated) {
    await installCuratedSkill(curated, "global");
    return;
  }
  throw new Error(`Unknown skill: ${name}`);
}
