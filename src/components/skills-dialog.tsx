import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles,
  Search,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  Loader2,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listBundledSkills,
  listCuratedSkills,
  installBundledSkill,
  installCuratedSkill,
  listInstalledSkills,
  deleteSkill,
  SKILL_CATEGORIES,
  type SkillCatalogEntry,
  type InstalledSkill,
  type CuratedSkill,
  type SkillCategory,
} from "@/lib/skills-library";

type LibraryItem =
  | { kind: "bundled"; entry: SkillCatalogEntry }
  | { kind: "curated"; entry: CuratedSkill };

export function SkillsDialog({
  open,
  onOpenChange,
  activeDirectory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeDirectory: string | null;
}) {
  const [scope, setScope] = useState<"global" | "project">("global");
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SkillCategory | "All">("All");

  const refresh = useCallback(async () => {
    const globalSkills = await listInstalledSkills("global");
    const projectSkills = activeDirectory ? await listInstalledSkills("project", activeDirectory) : [];
    setInstalledSkills([...globalSkills, ...projectSkills]);
  }, [activeDirectory]);

  const library = useMemo<LibraryItem[]>(() => {
    const bundled: LibraryItem[] = listBundledSkills().map((e) => ({
      kind: "bundled" as const,
      entry: e,
    }));
    const curated: LibraryItem[] = listCuratedSkills().map((e) => ({
      kind: "curated" as const,
      entry: e,
    }));
    return [...bundled, ...curated];
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh, tick]);

  const installedNames = useMemo(
    () => new Set(installedSkills.map((s) => s.name)),
    [installedSkills],
  );

  const handleInstall = async (item: LibraryItem) => {
    const name = item.entry.name;
    setInstalling(name);
    try {
      if (item.kind === "bundled") {
        await installBundledSkill(name, scope, activeDirectory ?? undefined);
      } else {
        await installCuratedSkill(item.entry, scope, activeDirectory ?? undefined);
      }
      toast.success(`Installed skill: ${name}`);
      setTick((t) => t + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to install skill: ${name}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleDelete = async (skill: InstalledSkill) => {
    try {
      await deleteSkill(skill.name, skill.scope, activeDirectory ?? undefined);
      setTick((t) => t + 1);
    } catch {
      toast.error("Failed to delete skill");
    }
  };

  const filteredLibrary = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library.filter((item) => {
      const title = item.kind === "bundled" ? item.entry.name : item.entry.title;
      const desc = item.entry.description;
      const cat: SkillCategory = item.kind === "bundled" ? "Built-in" : item.entry.category;
      if (category !== "All" && cat !== category) return false;
      if (!q) return true;
      return (
        title.toLowerCase().includes(q) ||
        desc.toLowerCase().includes(q) ||
        item.entry.name.toLowerCase().includes(q)
      );
    });
  }, [library, query, category]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5" /> Skills
          </DialogTitle>
          <DialogDescription>
            Skills are instruction packs that make the AI great at a specific task — like
            creating polished PDFs, designing on-brand slides, or reviewing code. Install one
            once and it works in both Chat and the Agent.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Save to:</span>
            <Select value={scope} onValueChange={(v) => setScope(v as "global" | "project")}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">All projects (~/.config)</SelectItem>
                <SelectItem value="project" disabled={!activeDirectory}>
                  {activeDirectory
                    ? `This project (${activeDirectory.replace(/.*\//, "")})`
                    : "This project (open one first)"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTick((t) => t + 1)}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {/* ─── Installed ─── */}
          <div className="flex flex-col gap-2 pb-3">
            <span className="text-sm font-medium">Installed</span>
            {installedSkills.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No skills installed yet. Pick one from the library below.
              </p>
            )}
            {installedSkills.map((skill) => (
              <div
                key={`${skill.scope}-${skill.name}`}
                className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
              >
                <div className="flex items-center gap-2">
                  <Check className="size-3.5 text-green-500" />
                  <span className="text-sm font-medium">{skill.name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {skill.scope === "global" ? "All projects" : "This project"}
                  </Badge>
                </div>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(skill)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
          </div>

          <Separator />

          {/* ─── Library ─── */}
          <div className="flex flex-col gap-3 pt-3">
            <span className="text-sm font-medium">Skill library</span>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search skills…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as SkillCategory | "All")}
              >
                <SelectTrigger size="sm" className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All categories</SelectItem>
                  {SKILL_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {filteredLibrary.map((item) => {
              const name = item.entry.name;
              const title = item.kind === "bundled" ? name : item.entry.title;
              const desc = item.entry.description;
              const cat: SkillCategory = item.kind === "bundled" ? "Built-in" : item.entry.category;
              const source =
                item.kind === "bundled"
                  ? "Built-in"
                  : item.entry.sourceLabel;
              const installed = installedNames.has(name);
              return (
                <div
                  key={`${item.kind}-${name}`}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{title}</span>
                      <Badge variant="outline" className="text-[10px]">{cat}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{desc}</span>
                    <span className="text-[10px] text-muted-foreground/70">{source}</span>
                  </div>
                  <div className="shrink-0">
                    {installed ? (
                      <Badge variant="secondary" className="text-[10px]">
                        <Check className="size-2.5" /> Installed
                      </Badge>
                    ) : (
                      <Button
                        size="xs"
                        disabled={installing === name}
                        onClick={() => handleInstall(item)}
                      >
                        {installing === name ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Plus className="size-3" />
                        )}
                        Install
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredLibrary.length === 0 && (
              <p className="text-xs text-muted-foreground">No skills match your search.</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
          <BookOpen className="size-3.5 shrink-0" />
          <span>
            Tip: skills are reusable instructions. The AI reads them when your request matches
            what a skill covers — you don't need to do anything special after installing.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
