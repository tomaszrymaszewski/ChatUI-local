import { useState, useEffect, useCallback, useMemo, type ComponentType, type SVGProps } from "react";
import {
  Sparkles,
  Search,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  Loader2,
  BookOpen,
  FileText,
  FileSpreadsheet,
  Presentation,
  NotebookText,
  Palette,
  Brush,
  Paintbrush,
  WandSparkles,
  Fingerprint,
  Megaphone,
  PenLine,
  FlaskConical,
  Blocks,
  AppWindow,
  Atom,
  LayoutTemplate,
  LayoutGrid,
  Database,
  Lightbulb,
  Bug,
  ListChecks,
  GitPullRequest,
  Telescope,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FastapiLogo, NextjsLogo } from "@/components/brand-logos";
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

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const SKILL_ICONS: Record<string, { Icon: IconComponent; tile: string }> = {
  fastapi: { Icon: FastapiLogo, tile: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  nextjs: { Icon: NextjsLogo, tile: "bg-foreground/10 text-foreground" },
  "frontend-ui": { Icon: LayoutGrid, tile: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  research: { Icon: Telescope, tile: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  pdf: { Icon: FileText, tile: "bg-red-500/10 text-red-600 dark:text-red-400" },
  docx: { Icon: NotebookText, tile: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  xlsx: { Icon: FileSpreadsheet, tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  pptx: { Icon: Presentation, tile: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  "frontend-design": { Icon: Palette, tile: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  "canvas-design": { Icon: Brush, tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  "brand-guidelines": { Icon: Fingerprint, tile: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  "theme-factory": { Icon: Paintbrush, tile: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
  "algorithmic-art": { Icon: WandSparkles, tile: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  "internal-comms": { Icon: Megaphone, tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  "doc-coauthoring": { Icon: PenLine, tile: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  "webapp-testing": { Icon: FlaskConical, tile: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  "mcp-builder": { Icon: Blocks, tile: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" },
  "web-artifacts-builder": { Icon: AppWindow, tile: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  "skill-creator": { Icon: Sparkles, tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  "react-best-practices": { Icon: Atom, tile: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" },
  "web-design-guidelines": { Icon: LayoutTemplate, tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  "supabase-postgres-best-practices": { Icon: Database, tile: "bg-green-500/10 text-green-600 dark:text-green-400" },
  brainstorming: { Icon: Lightbulb, tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  "systematic-debugging": { Icon: Bug, tile: "bg-red-500/10 text-red-600 dark:text-red-400" },
  "test-driven-development": { Icon: ListChecks, tile: "bg-lime-500/10 text-lime-600 dark:text-lime-400" },
  "code-review": { Icon: GitPullRequest, tile: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
};

const FALLBACK_ICON: { Icon: IconComponent; tile: string } = {
  Icon: Sparkles,
  tile: "bg-muted text-muted-foreground",
};

export function skillIcon(name: string): { Icon: IconComponent; tile: string } {
  return SKILL_ICONS[name] ?? FALLBACK_ICON;
}

export function SkillsPanel({
  activeDirectory,
}: {
  activeDirectory: string | null;
}) {
  const [scope, setScope] = useState<"global" | "project">("global");
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
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
    void refresh();
  }, [refresh, tick]);

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

  const handleUninstall = async (name: string) => {
    const matches = installedSkills.filter((s) => s.name === name);
    if (matches.length === 0) return;
    setUninstalling(name);
    try {
      for (const skill of matches) {
        await deleteSkill(skill.name, skill.scope, activeDirectory ?? undefined);
      }
      setTick((t) => t + 1);
    } catch {
      toast.error("Failed to delete skill");
    } finally {
      setUninstalling(null);
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5" /> Skills
        </h2>
        <p className="text-sm text-muted-foreground">
          Skills are instruction packs that make the AI great at a specific task — like
          creating polished PDFs, designing on-brand slides, or reviewing code. Install one
          once and it works everywhere.
        </p>
      </div>

        <div className="flex flex-col gap-2.5">
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

          <div className="flex flex-wrap items-center gap-1.5">
            {(["All", ...SKILL_CATEGORIES] as Array<SkillCategory | "All">).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  category === c
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {/* ─── Library ─── */}
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium">Skill library</span>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
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
                const { Icon, tile } = skillIcon(name);
                return (
                  <div
                    key={`${item.kind}-${name}`}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border p-4 transition-colors",
                      installed
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "hover:border-foreground/20 hover:bg-muted/50",
                    )}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-lg",
                          tile,
                        )}
                      >
                        <Icon className="size-5" />
                      </div>
                      {installed ? (
                        <button
                          onClick={() => handleUninstall(name)}
                          disabled={uninstalling === name}
                          className={cn(
                            "group inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
                            "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                            "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive dark:hover:text-destructive",
                            "disabled:pointer-events-none disabled:opacity-50",
                          )}
                        >
                          {uninstalling === name ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <>
                              <Check className="size-2.5 group-hover:hidden" />
                              <Trash2 className="hidden size-2.5 group-hover:block" />
                            </>
                          )}
                          <span className="group-hover:hidden">Installed</span>
                          <span className="hidden group-hover:inline">Uninstall</span>
                        </button>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
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
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold leading-tight">{title}</span>
                      <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {desc}
                      </span>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10px] text-muted-foreground/70">
                      <span className="truncate">{source}</span>
                      <span className="shrink-0 rounded-full border px-2 py-0.5">{cat}</span>
                    </div>
                  </div>
                );
              })}
            </div>
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
    </div>
  );
}
