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
  Link2,
  FolderOpen,
  ClipboardPaste,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { open as openDirectoryPicker } from "@tauri-apps/plugin-dialog";
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
  installBundledSkill,
  installRegistrySkill,
  listInstalledSkills,
  deleteSkill,
  globalSkillsDirectory,
  SKILL_CATEGORIES,
  type InstalledSkill,
  type SkillCategory,
} from "@/lib/skills-library";
import {
  listAllCatalogSkills,
  parseGithubSkillUrl,
  saveCustomSkill,
  type CatalogSkill,
} from "@/lib/skill-registry";
import { scheduleKnowledgeSweep } from "@/lib/knowledge-index";

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

/** Well-known skill folders of other agent apps (imported on click only). */
const EXTERNAL_SKILL_DIRS = [
  { label: "Claude Code", path: "~/.claude/skills" },
  { label: "opencode", path: "~/.config/opencode/skills" },
  { label: "Eigent", path: "~/.eigent/skills" },
];

type AddMode = "url" | "folder" | "paste";

export function SkillsPanel({
  activeDirectory,
}: {
  activeDirectory: string | null;
}) {
  const [scope, setScope] = useState<"global" | "project">("global");
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [library, setLibrary] = useState<CatalogSkill[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SkillCategory | "All">("All");
  // Add-skill dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("url");
  const [githubUrl, setGithubUrl] = useState("");
  const [pastedMd, setPastedMd] = useState("");
  const [adding, setAdding] = useState(false);
  // Import-from-other-apps state
  const [importOpen, setImportOpen] = useState(false);
  const [importScan, setImportScan] = useState<Array<{ label: string; path: string; skills: string[] }> | null>(null);
  const [importScanning, setImportScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPicked, setImportPicked] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const globalSkills = await listInstalledSkills("global");
    const projectSkills = activeDirectory ? await listInstalledSkills("project", activeDirectory) : [];
    setInstalledSkills([...globalSkills, ...projectSkills]);
    setLibrary(await listAllCatalogSkills());
  }, [activeDirectory]);

  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

  const installedNames = useMemo(
    () => new Set(installedSkills.map((s) => s.name)),
    [installedSkills],
  );

  const handleInstall = async (skill: CatalogSkill) => {
    const name = skill.name;
    setInstalling(name);
    try {
      if (skill.repo) {
        await installRegistrySkill(
          { name, repo: skill.repo, dir: skill.dir, branch: skill.branch },
          scope,
          activeDirectory ?? undefined,
        );
      } else {
        await installBundledSkill(name, scope, activeDirectory ?? undefined);
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

  const handleAddGithubUrl = async () => {
    const parsed = parseGithubSkillUrl(githubUrl);
    if (!parsed) {
      toast.error("Enter a GitHub URL: github.com/owner/repo or …/tree/branch/skill-dir");
      return;
    }
    setAdding(true);
    try {
      await installRegistrySkill(parsed, scope, activeDirectory ?? undefined);
      saveCustomSkill({
        ...parsed,
        title: parsed.name,
        description: `Custom skill imported from github.com/${parsed.repo}`,
        category: "Coding",
        sourceLabel: "Custom — GitHub",
        keywords: [],
      });
      toast.success(`Installed skill: ${parsed.name}`);
      setGithubUrl("");
      setAddOpen(false);
      setTick((t) => t + 1);
      scheduleKnowledgeSweep(2_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to install from GitHub");
    } finally {
      setAdding(false);
    }
  };

  const handleAddFolder = async () => {
    try {
      const picked = await openDirectoryPicker({ directory: true, multiple: false });
      if (typeof picked !== "string" || !picked) return;
      const name = picked.split("/").filter(Boolean).pop() ?? "skill";
      const dest = await globalSkillsDirectory();
      const target = `${dest}/${name}`;
      if (await invoke<boolean>("path_exists", { path: target })) {
        toast.error(`A skill named "${name}" already exists`);
        return;
      }
      await invoke("copy_path", { src: picked, dest: target });
      toast.success(`Imported skill: ${name}`);
      setAddOpen(false);
      setTick((t) => t + 1);
      scheduleKnowledgeSweep(2_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import folder");
    }
  };

  const handleAddPaste = async () => {
    const content = pastedMd.trim();
    if (!content) return;
    const nameMatch = content.match(/^---\n[\s\S]*?^name:\s*(\S+)/m);
    const name = nameMatch?.[1] ?? `pasted-skill-${Date.now()}`;
    setAdding(true);
    try {
      const home = await globalSkillsDirectory();
      await invoke("write_text_file", { path: `${home}/${name}/SKILL.md`, content });
      toast.success(`Installed skill: ${name}`);
      setPastedMd("");
      setAddOpen(false);
      setTick((t) => t + 1);
      scheduleKnowledgeSweep(2_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save skill");
    } finally {
      setAdding(false);
    }
  };

  const scanExternalDirs = useCallback(async () => {
    setImportScanning(true);
    try {
      const found: Array<{ label: string; path: string; skills: string[] }> = [];
      for (const dir of EXTERNAL_SKILL_DIRS) {
        const entries = await invoke<Array<{ name: string }>>("list_dir_entries", { path: dir.path }).catch(() => []);
        if (entries.length > 0) {
          found.push({ label: dir.label, path: dir.path, skills: entries.map((e) => e.name) });
        }
      }
      setImportScan(found);
      setImportPicked(new Set());
    } finally {
      setImportScanning(false);
    }
  }, []);

  useEffect(() => {
    if (importOpen && !importScan && !importScanning) void scanExternalDirs();
  }, [importOpen, importScan, importScanning, scanExternalDirs]);

  const handleImportExternal = async () => {
    if (importPicked.size === 0) return;
    setImporting(true);
    try {
      const home = await invoke<string>("get_home_dir");
      const dest = await globalSkillsDirectory();
      let count = 0;
      for (const source of importScan ?? []) {
        for (const skill of source.skills) {
          const key = `${source.path}/${skill}`;
          if (!importPicked.has(key)) continue;
          const target = `${dest}/${skill}`;
          if (await invoke<boolean>("path_exists", { path: target })) continue;
          await invoke("copy_path", {
            src: key.replace(/^~/, home),
            dest: target,
          }).catch(() => {});
          count += 1;
        }
      }
      toast.success(count > 0 ? `Imported ${count} skill(s)` : "Nothing new to import");
      setImportOpen(false);
      setImportScan(null);
      setTick((t) => t + 1);
      scheduleKnowledgeSweep(2_000);
    } finally {
      setImporting(false);
    }
  };

  const filteredLibrary = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library.filter((item) => {
      if (category !== "All" && item.category !== category) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.toLowerCase().includes(q))
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
          creating polished PDFs, designing on-brand slides, or reviewing code. Everything in
          the catalog is discoverable by the agent automatically; installing just keeps it
          always ready.
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
                  <SelectItem value="global">All projects (app library)</SelectItem>
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
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Download className="size-3.5" /> Import
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" /> Add skill
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

        {addOpen && (
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Add a skill</span>
              <button onClick={() => setAddOpen(false)} className="text-muted-foreground hover:text-foreground">
                <Trash2 className="hidden" />
                <span className="text-xs">Close</span>
              </button>
            </div>
            <div className="flex gap-1.5">
              {(
                [
                  { id: "url", label: "GitHub URL", Icon: Link2 },
                  { id: "folder", label: "Local folder", Icon: FolderOpen },
                  { id: "paste", label: "Paste SKILL.md", Icon: ClipboardPaste },
                ] as Array<{ id: AddMode; label: string; Icon: IconComponent }>
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setAddMode(id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    addMode === id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3" /> {label}
                </button>
              ))}
            </div>
            {addMode === "url" && (
              <div className="flex gap-2">
                <Input
                  placeholder="https://github.com/owner/repo/tree/main/skills/my-skill"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                />
                <Button size="sm" disabled={adding || !githubUrl.trim()} onClick={() => void handleAddGithubUrl()}>
                  {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  Add
                </Button>
              </div>
            )}
            {addMode === "folder" && (
              <Button size="sm" variant="outline" onClick={() => void handleAddFolder()} className="self-start">
                <FolderOpen className="size-3.5" /> Choose folder…
              </Button>
            )}
            {addMode === "paste" && (
              <div className="flex flex-col gap-2">
                <textarea
                  className="min-h-32 rounded-lg border bg-transparent p-3 font-mono text-xs"
                  placeholder={"---\nname: my-skill\ndescription: What it does for the AI\n---\n# Instructions…"}
                  value={pastedMd}
                  onChange={(e) => setPastedMd(e.target.value)}
                />
                <Button size="sm" disabled={adding || !pastedMd.trim()} onClick={() => void handleAddPaste()} className="self-start">
                  {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  Save skill
                </Button>
              </div>
            )}
          </div>
        )}

        {importOpen && (
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Import skills from other apps</span>
              <button onClick={() => { setImportOpen(false); setImportScan(null); }} className="text-xs text-muted-foreground hover:text-foreground">
                Close
              </button>
            </div>
            {importScanning && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {importScan && importScan.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No skill folders found in Claude Code, opencode, or Eigent.
              </p>
            )}
            {importScan?.map((source) => (
              <div key={source.path} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{source.label}</span>
                <div className="flex flex-wrap gap-1.5">
                  {source.skills.map((skill) => {
                    const key = `${source.path}/${skill}`;
                    const picked = importPicked.has(key);
                    const already = installedNames.has(skill);
                    return (
                      <button
                        key={key}
                        disabled={already}
                        onClick={() => {
                          const next = new Set(importPicked);
                          if (picked) next.delete(key);
                          else next.add(key);
                          setImportPicked(next);
                        }}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          already
                            ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                            : picked
                              ? "border-foreground bg-foreground text-background"
                              : "border-border text-muted-foreground hover:text-foreground",
                        )}
                        title={already ? "Already installed" : key}
                      >
                        {already ? <Check className="mr-1 inline size-3" /> : picked ? <Check className="mr-1 inline size-3" /> : <Plus className="mr-1 inline size-3" />}
                        {skill}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {importScan && importScan.length > 0 && (
              <Button
                size="sm"
                className="self-start"
                disabled={importing || importPicked.size === 0}
                onClick={() => void handleImportExternal()}
              >
                {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                Import {importPicked.size > 0 ? `${importPicked.size} ` : ""}selected
              </Button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {/* ─── Library ─── */}
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium">Skill library</span>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {filteredLibrary.map((item) => {
                const name = item.name;
                const installed = installedNames.has(name);
                const { Icon, tile } = skillIcon(name);
                return (
                  <div
                    key={`${item.sourceLabel}-${name}`}
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
                      <span className="text-sm font-semibold leading-tight">{item.title}</span>
                      <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </span>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10px] text-muted-foreground/70">
                      <span className="truncate">{item.sourceLabel}</span>
                      <span className="shrink-0 rounded-full border px-2 py-0.5">{item.category}</span>
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
            Tip: skills are reusable instructions. The agent finds what it needs via the
            knowledge index and installs on demand — you don't need to do anything special.
          </span>
        </div>
    </div>
  );
}
