import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { skillIcon } from "@/components/skills-panel";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import {
  listBundledSkills,
  listCuratedSkills,
  installBundledSkill,
  installCuratedSkill,
  deleteSkill,
  listInstalledSkills,
  type SkillCatalogEntry,
  type CuratedSkill,
} from "@/lib/skills-library";
import { cn } from "@/lib/utils";

type LibraryItem =
  | { kind: "bundled"; entry: SkillCatalogEntry }
  | { kind: "curated"; entry: CuratedSkill };

export function SkillsStep({
  onNext,
  onBack,
  headerBox,
  footerBox,
}: {
  onNext: () => void;
  onBack: () => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const skills = await listInstalledSkills("global");
      setInstalled(new Set(skills.map((s) => s.name)));
    } catch {
      // Skills need the desktop shell; leave the list empty.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const skills = useMemo<LibraryItem[]>(
    () => [
      ...listBundledSkills().map((e) => ({ kind: "bundled" as const, entry: e })),
      ...listCuratedSkills().map((e) => ({ kind: "curated" as const, entry: e })),
    ],
    [],
  );

  const handleToggle = async (item: LibraryItem) => {
    const name = item.entry.name;
    setBusy(name);
    try {
      if (installed.has(name)) {
        await deleteSkill(name, "global");
        setInstalled((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      } else if (item.kind === "bundled") {
        await installBundledSkill(name, "global");
        setInstalled((prev) => new Set(prev).add(name));
        toast.success(`Installed skill: ${name}`);
      } else {
        await installCuratedSkill(item.entry, "global");
        setInstalled((prev) => new Set(prev).add(name));
        toast.success(`Installed skill: ${item.entry.title}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to update skill: ${name}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        target={headerBox}
        title="Add some skills"
        subtitle="Skills teach the AI specific jobs — like making PDFs or reviewing code. Pick the ones that fit you, or skip and browse later in Settings."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((item) => {
          const name = item.entry.name;
          const title = item.kind === "bundled" ? name : item.entry.title;
          const { Icon, tile } = skillIcon(name);
          const isInstalled = installed.has(name);
          return (
            <button
              key={`${item.kind}-${name}`}
              onClick={() => handleToggle(item)}
              disabled={busy !== null}
              className={cn(
                "flex flex-col gap-2.5 rounded-xl border p-4 text-left transition-colors cursor-pointer",
                isInstalled
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "hover:border-foreground/30 hover:bg-muted/50",
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tile)}>
                  <Icon className="size-4.5" />
                </div>
                {busy === name ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : isInstalled ? (
                  <Trash2 className="size-4 text-muted-foreground" />
                ) : (
                  <Plus className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{title}</span>
                <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {item.entry.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onNext}>
              Skip for now
            </Button>
            <Button onClick={onNext}>
              Continue
              <ArrowRight />
            </Button>
          </div>
        </div>
      </StepFooter>
    </div>
  );
}
