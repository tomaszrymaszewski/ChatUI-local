import { useEffect, useMemo, useState } from "react";
import { open as openDirectoryPicker } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  ArrowUp,
  BarChart3,
  CalendarClock,
  Check,
  FolderPlus,
  Pencil,
  Plug,
  Plus,
  Settings2,
  Sparkles,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";
import type { AgentDefinition, AgentSchedule, AgentWorkflow, BackgroundPattern, ChatSession, Project } from "@/types";
import type { AgentUpdatePatch } from "@/lib/agents";
import { modelLabel } from "@/lib/model-display";
import { describeCadence, deleteSchedule, loadSchedules, subscribeToSchedules, updateSchedule } from "@/lib/schedules";
import { deleteWorkflow, loadWorkflows, subscribeToWorkflows } from "@/lib/workflows";
import { listInstalledSkills } from "@/lib/skills-library";
import { MCP_CATALOG } from "@/lib/mcp-catalog";
import { AgentAvatar } from "@/components/agent-avatar";
import type { AgentConsoleTab } from "@/components/app-sidebar";
import { AgentUsageChart } from "@/components/agent-usage-chart";
import { ScheduleDialog } from "@/components/schedule-dialog";
import { WorkflowDialog } from "@/components/workflow-dialog";
import { PatternBackground } from "@/components/background-pattern";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { skillIcon } from "@/components/skills-panel";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const DEFAULT_MODEL_VALUE = "__default__";

function CardTitleRow({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-sm font-medium">{title}</span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <CardTitleRow icon={icon} title={title} action={action} />
      {children}
    </div>
  );
}

function PermissionRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/**
 * The agent page (sidebar agent click): header + the panel selected in the
 * sidebar (General / Permissions / Automations / Connections) above a
 * composer pinned to the bottom (like the dashboard).
 * - General: identity (name, purpose, system prompt), model, token usage.
 * - Permissions: local folders, internet/compiler access, visible
 *   chats & projects.
 * - Automations: schedules and workflows.
 * - Connections: activated skills and apps/connectors.
 * Past sessions live in the sidebar's Sessions section.
 */
export function AgentConsole({
  agent,
  agents,
  sessions,
  projects,
  models,
  sendOnEnter,
  backgroundPattern,
  modelSelect,
  tab,
  composing,
  onComposingChange,
  onUpdateAgent,
  onSend,
}: {
  agent: AgentDefinition;
  /** All saved agents (for schedule/workflow step pickers). */
  agents: AgentDefinition[];
  /** This agent's sessions, newest first. */
  sessions: ChatSession[];
  projects: Project[];
  models: Array<{
    id: string;
    name: string;
    displayName?: string;
    providerId: string;
    providerName: string;
  }>;
  sendOnEnter: boolean;
  /** Chat-area background pattern (Settings → General); not shown behind the cards. */
  backgroundPattern: BackgroundPattern;
  /** Composer model picker (rendered when the agent has no pinned model). */
  modelSelect: React.ReactNode;
  /** Panel selected in the sidebar — the sidebar owns this state. */
  tab: AgentConsoleTab;
  /** New-session compose mode — entered from the sidebar + or the start button. */
  composing: boolean;
  onComposingChange: (composing: boolean) => void;
  onUpdateAgent: (id: string, patch: AgentUpdatePatch) => void;
  onSend: (text: string) => void;
}) {
  const [inputText, setInputText] = useState("");
  const [installedSkills, setInstalledSkills] = useState<Array<{ name: string; path: string }>>([]);
  const [schedules, setSchedules] = useState<AgentSchedule[]>(loadSchedules());
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>(loadWorkflows());
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<AgentSchedule | null>(null);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<AgentWorkflow | null>(null);

  // Identity drafts (General tab) — resync when the record changes
  // externally (e.g. the agent editing itself mid-chat).
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [purposeDraft, setPurposeDraft] = useState(agent.purpose);
  const [instructionsDraft, setInstructionsDraft] = useState(agent.systemPrompt);
  const [editingInstructions, setEditingInstructions] = useState(false);

  useEffect(() => {
    void listInstalledSkills("global").then(setInstalledSkills).catch(() => setInstalledSkills([]));
  }, []);

  useEffect(() => {
    const sync = () => {
      setSchedules(loadSchedules());
      setWorkflows(loadWorkflows());
    };
    sync();
    const offSchedules = subscribeToSchedules(sync);
    const offWorkflows = subscribeToWorkflows(sync);
    return () => {
      offSchedules();
      offWorkflows();
    };
  }, []);

  useEffect(() => {
    setNameDraft(agent.name);
    setPurposeDraft(agent.purpose);
    setInstructionsDraft(agent.systemPrompt);
  }, [agent]);

  const update = (patch: AgentUpdatePatch) => onUpdateAgent(agent.id, patch);

  const send = () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    onComposingChange(false);
    onSend(text);
  };

  const pinnedModel = agent.model
    ? models.find((m) => m.name === agent.model)
    : undefined;

  const groupedModels = useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const m of models) {
      const list = map.get(m.providerName) ?? [];
      list.push(m);
      map.set(m.providerName, list);
    }
    return Array.from(map.entries());
  }, [models]);

  const agentSchedules = useMemo(
    () =>
      schedules
        .filter((s) => s.agentId === agent.id)
        .sort((a, b) => (a.nextRun ?? "9999").localeCompare(b.nextRun ?? "9999")),
    [schedules, agent.id],
  );

  const agentWorkflows = useMemo(
    () => workflows.filter((w) => w.steps.some((s) => s.agentId === agent.id)),
    [workflows, agent.id],
  );

  const customConnectors = useMemo(
    () => agent.connectors.filter((id) => !MCP_CATALOG.some((c) => c.id === id)),
    [agent.connectors],
  );

  const commitName = () => {
    const name = nameDraft.trim();
    if (name && name !== agent.name) update({ name });
    else setNameDraft(agent.name);
  };

  const commitPurpose = () => {
    const purpose = purposeDraft.trim();
    if (purpose !== agent.purpose) update({ purpose });
    else setPurposeDraft(agent.purpose);
  };

  const commitInstructions = () => {
    if (instructionsDraft !== agent.systemPrompt) update({ systemPrompt: instructionsDraft });
  };

  const toggleListValue = (list: string[], value: string, patch: (next: string[]) => void) => {
    patch(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const addFolder = async () => {
    try {
      const dir = await openDirectoryPicker({
        directory: true,
        title: "Add a folder this agent may access",
      });
      if (typeof dir === "string" && !(agent.allowedFolders ?? []).includes(dir)) {
        update({ allowedFolders: [...(agent.allowedFolders ?? []), dir] });
      }
    } catch {
      toast.error("Folder picker is only available in the desktop app");
    }
  };

  const lastScheduleStatus = (schedule: AgentSchedule) => {
    if (!schedule.lastStatus) return null;
    const when = schedule.lastRun
      ? new Date(schedule.lastRun).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return (
      <span
        className={cn(
          "shrink-0 text-[10px]",
          schedule.lastStatus === "ok"
            ? "text-emerald-600 dark:text-emerald-400"
            : schedule.lastStatus === "error"
              ? "text-destructive"
              : "text-muted-foreground",
        )}
      >
        {schedule.lastStatus === "ok" ? "✓" : "✕"} {when}
      </span>
    );
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PatternBackground pattern={backgroundPattern} />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-4 px-4 py-4">
            <div
              className={cn(
                "grid transition-all duration-500",
                composing ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
              )}
              aria-hidden={composing}
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  className={cn(
                    "flex flex-col gap-4 transition-all duration-500",
                    composing && "pointer-events-none -translate-y-2",
                  )}
                >
            <h2 className="text-xl font-semibold capitalize">{tab}</h2>
            {tab === "general" && (
              <>
                {/* ─── Identity ─── */}
                <SectionCard
                  icon={<AgentAvatar seed={agent.id} className="size-3.5" />}
                  title="Identity"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`agent-name-${agent.id}`}>Name</Label>
                      <Input
                        id={`agent-name-${agent.id}`}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={commitName}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitName(); } }}
                        placeholder="Agent name"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`agent-purpose-${agent.id}`}>Purpose</Label>
                      <Input
                        id={`agent-purpose-${agent.id}`}
                        value={purposeDraft}
                        onChange={(e) => setPurposeDraft(e.target.value)}
                        onBlur={commitPurpose}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitPurpose(); } }}
                        placeholder="One-line description shown in the sidebar"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`agent-instructions-${agent.id}`}>System prompt</Label>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (editingInstructions) {
                            commitInstructions();
                            setEditingInstructions(false);
                          } else {
                            setInstructionsDraft(agent.systemPrompt);
                            setEditingInstructions(true);
                          }
                        }}
                        aria-label={editingInstructions ? "Save system prompt" : "Edit system prompt"}
                      >
                        {editingInstructions ? <Check /> : <Pencil />}
                      </Button>
                    </div>
                    {editingInstructions ? (
                      <Textarea
                        id={`agent-instructions-${agent.id}`}
                        autoFocus
                        value={instructionsDraft}
                        onChange={(e) => setInstructionsDraft(e.target.value)}
                        onBlur={commitInstructions}
                        rows={6}
                        placeholder="The agent's own system prompt — identity, how it works, its limits…"
                      />
                    ) : (
                      <div className="overflow-x-auto rounded-lg border bg-muted/30 p-3">
                        {agent.systemPrompt ? (
                          <MarkdownRenderer content={agent.systemPrompt} className="break-words text-sm" />
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            (No system prompt set — click the pencil to write one)
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </SectionCard>

                {/* ─── Model ─── */}
                <SectionCard
                  icon={<Settings2 className="size-3.5 text-muted-foreground" />}
                  title="Model"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`agent-model-${agent.id}`}>Model</Label>
                    <Select
                      value={agent.model ?? DEFAULT_MODEL_VALUE}
                      onValueChange={(v) => update({ model: v === DEFAULT_MODEL_VALUE ? undefined : v })}
                    >
                      <SelectTrigger id={`agent-model-${agent.id}`} className="w-full">
                        <SelectValue placeholder="Default model" />
                      </SelectTrigger>
                      <SelectContent className="min-w-56">
                        <SelectItem value={DEFAULT_MODEL_VALUE}>
                          Default (app model)
                        </SelectItem>
                        {groupedModels.map(([providerName, list]) => (
                          <SelectGroup key={providerName}>
                            <SelectLabel>{providerName}</SelectLabel>
                            {list.map((m) => (
                              <SelectItem key={m.id} value={m.name}>
                                {modelLabel(m)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </SectionCard>

                {/* ─── Usage ─── */}
                <SectionCard
                  icon={<BarChart3 className="size-3.5 text-muted-foreground" />}
                  title="Recent usage"
                >
                  <AgentUsageChart agentId={agent.id} />
                </SectionCard>
              </>
            )}

            {tab === "permissions" && (
              <>

                {/* ─── Local folders ─── */}
                <SectionCard
                  icon={<FolderPlus className="size-3.5 text-muted-foreground" />}
                  title="Local folders"
                  action={
                    <Button variant="outline" size="xs" onClick={() => void addFolder()}>
                      <FolderPlus className="size-3" />
                      Add folder
                    </Button>
                  }
                >
                  <p className="font-mono text-[11px] text-muted-foreground">
                    Private workspace: ~/Documents/chatUI/agents/{agent.id} (always available)
                  </p>
                  {(agent.allowedFolders ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No extra folders granted — the agent can only write inside its workspace.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {(agent.allowedFolders ?? []).map((folder) => (
                        <div
                          key={folder}
                          className="flex items-center gap-2 rounded-lg border p-2"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">
                            {folder.replace(/^\/Users\/[^/]+/, "~")}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            trusted
                          </span>
                          <button
                            aria-label={`Revoke ${folder}`}
                            className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                            onClick={() =>
                              update({
                                allowedFolders: (agent.allowedFolders ?? []).filter(
                                  (f) => f !== folder,
                                ),
                              })
                            }
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Granted folders are trusted — file access inside them runs without approval cards.
                  </p>
                </SectionCard>

                {/* ─── Capabilities ─── */}
                <SectionCard
                  icon={<Settings2 className="size-3.5 text-muted-foreground" />}
                  title="Capabilities"
                >
                  <PermissionRow
                    label="Internet access"
                    description="Search and fetch the web"
                    checked={agent.capabilities.web}
                    onCheckedChange={(web) => update({ capabilities: { web } })}
                  />
                  <PermissionRow
                    label="Compiler & terminal"
                    description="Run shell commands and coding tasks — each command approved"
                    checked={agent.capabilities.terminal}
                    onCheckedChange={(terminal) => update({ capabilities: { terminal } })}
                  />
                </SectionCard>

                {/* ─── Visible chats & projects ─── */}
                <SectionCard
                  icon={<CalendarClock className="size-3.5 text-muted-foreground" />}
                  title="Visible chats & projects"
                >
                  <PermissionRow
                    label="Read past chats"
                    description={`Search and read your chat history (${sessions.length} session${sessions.length === 1 ? "" : "s"} with this agent)`}
                    checked={agent.readChats ?? false}
                    onCheckedChange={(readChats) => update({ readChats })}
                  />
                  <div className="flex flex-col gap-1.5">
                    <Label>Projects</Label>
                    {projects.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No projects yet — create one in the Projects view.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {projects.map((project) => (
                          <div
                            key={project.id}
                            className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
                          >
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <span className="truncate text-sm font-medium">{project.name}</span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {project.directory ?? "no folder linked"}
                              </span>
                            </div>
                            <Switch
                              checked={(agent.allowedProjects ?? []).includes(project.id)}
                              onCheckedChange={() =>
                                toggleListValue(agent.allowedProjects ?? [], project.id, (allowedProjects) =>
                                  update({ allowedProjects }),
                                )
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </SectionCard>
              </>
            )}

            {tab === "automations" && (
              <>
                {/* ─── Schedules ─── */}
                <SectionCard
                  icon={<CalendarClock className="size-3.5 text-muted-foreground" />}
                  title="Schedules"
                  action={
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setEditingSchedule(null);
                        setScheduleDialogOpen(true);
                      }}
                    >
                      <CalendarClock className="size-3" />
                      New
                    </Button>
                  }
                >
                  {agentSchedules.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No schedules — set one to put {agent.name} on the clock.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {agentSchedules.map((schedule) => (
                        <div
                          key={schedule.id}
                          className="flex items-center gap-2 rounded-lg border p-2"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                            onClick={() => {
                              setEditingSchedule(schedule);
                              setScheduleDialogOpen(true);
                            }}
                          >
                            <span className="w-full truncate text-xs font-medium">{schedule.name}</span>
                            <span className="truncate text-[10px] text-muted-foreground">
                              {describeCadence(schedule.cadence)}
                              {schedule.nextRun
                                ? ` · next ${new Date(schedule.nextRun).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                                : " · done"}
                            </span>
                          </button>
                          {lastScheduleStatus(schedule)}
                          <Switch
                            checked={schedule.enabled}
                            onCheckedChange={(enabled) =>
                              updateSchedule(schedule.id, { enabled })
                            }
                          />
                          <button
                            aria-label={`Delete ${schedule.name}`}
                            className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                            onClick={() => deleteSchedule(schedule.id)}
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                {/* ─── Workflows ─── */}
                <SectionCard
                  icon={<WorkflowIcon className="size-3.5 text-muted-foreground" />}
                  title="Workflows"
                  action={
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setEditingWorkflow(null);
                        setWorkflowDialogOpen(true);
                      }}
                    >
                      <WorkflowIcon className="size-3" />
                      New
                    </Button>
                  }
                >
                  <p className="text-xs text-muted-foreground">
                    Step chains this agent takes part in. Schedule one to run it automatically.
                  </p>
                  {agentWorkflows.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground">No workflows yet.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {agentWorkflows.map((workflow) => (
                        <div
                          key={workflow.id}
                          className="flex items-center gap-2 rounded-lg border p-2"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                            onClick={() => {
                              setEditingWorkflow(workflow);
                              setWorkflowDialogOpen(true);
                            }}
                          >
                            <span className="w-full truncate text-xs font-medium">{workflow.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {workflow.steps.length} step{workflow.steps.length === 1 ? "" : "s"}
                            </span>
                          </button>
                          <button
                            aria-label={`Delete ${workflow.name}`}
                            className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                            onClick={() => deleteWorkflow(workflow.id)}
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </>
            )}

            {tab === "connections" && (
              <>
                {/* ─── Skills ─── */}
                <SectionCard
                  icon={<Sparkles className="size-3.5 text-muted-foreground" />}
                  title="Skills"
                >
                  {installedSkills.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No skills installed — add some in Settings → Skills.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {installedSkills.map((skill) => {
                        const { Icon, tile } = skillIcon(skill.name);
                        const enabled = (agent.skills ?? []).includes(skill.name);
                        return (
                          <div
                            key={skill.name}
                            className="flex items-center gap-2 rounded-lg border p-2"
                          >
                            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", tile)}>
                              <Icon className="size-4" />
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="truncate text-xs font-medium">{skill.name}</span>
                              <span className="truncate font-mono text-[10px] text-muted-foreground">
                                {skill.path}
                              </span>
                            </div>
                            <Switch
                              checked={enabled}
                              onCheckedChange={() =>
                                toggleListValue(agent.skills ?? [], skill.name, (skills) =>
                                  update({ skills }),
                                )
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Enabled skills auto-invoke when a task needs them — nothing loads into context until then.
                  </p>
                </SectionCard>

                {/* ─── Connectors ─── */}
                <SectionCard
                  icon={<Plug className="size-3.5 text-muted-foreground" />}
                  title="Apps & connectors"
                >
                  <div className="flex flex-col gap-1.5">
                    {MCP_CATALOG.map((entry) => {
                      const enabled = agent.connectors.includes(entry.id);
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center gap-2 rounded-lg border p-2"
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-xs font-medium">{entry.name}</span>
                            <span className="truncate text-[10px] text-muted-foreground">
                              {entry.tagline}
                            </span>
                          </div>
                          <Switch
                            checked={enabled}
                            onCheckedChange={() =>
                              update({
                                connectors: enabled
                                  ? agent.connectors.filter((c) => c !== entry.id)
                                  : [...agent.connectors, entry.id],
                              })
                            }
                          />
                        </div>
                      );
                    })}
                    {customConnectors.map((id) => (
                      <div
                        key={id}
                        className="flex items-center gap-2 rounded-lg border p-2"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-mono text-xs font-medium">{id}</span>
                          <span className="text-[10px] text-muted-foreground">
                            Custom connector
                          </span>
                        </div>
                        <button
                          aria-label={`Remove ${id}`}
                          className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                          onClick={() =>
                            update({ connectors: agent.connectors.filter((c) => c !== id) })
                          }
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Install and sign in once in Settings → Connectors.
                  </p>
                </SectionCard>
              </>
            )}
                </div>
              </div>
            </div>
            <div
              className={cn(
                "grid flex-1 transition-all delay-100 duration-500",
                composing ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
              aria-hidden={!composing}
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  className={cn(
                    "flex h-full flex-col items-center justify-center gap-3 px-4 py-8 text-center",
                    !composing && "pointer-events-none",
                  )}
                >
                  <AgentAvatar seed={agent.id} className="size-10" />
                  <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold">New session with {agent.name}</h2>
                    <p className="mx-auto max-w-sm text-xs text-muted-foreground">
                      {agent.purpose || "Ask anything below to start a new conversation."}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    tabIndex={composing ? undefined : -1}
                    onClick={() => onComposingChange(false)}
                  >
                    Back to <span className="capitalize">{tab}</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* ─── Start button / composer — pinned to the bottom ─── */}
      <div className="relative z-10 shrink-0 bg-gradient-to-t from-background via-background/60 to-transparent pt-10">
        <div className="mx-auto w-full max-w-6xl px-4 pb-4">
          {composing ? (
            <InputGroup
              key="composer"
              className="animate-in fade-in slide-in-from-bottom-3 bg-card duration-500"
            >
              <InputGroupTextarea
                autoFocus
                value={inputText}
                onChange={(e) => setInputText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={`Message ${agent.name}…`}
                className="max-h-40 min-h-12"
              />
              <InputGroupAddon
                align="block-end"
                className="animate-in fade-in duration-500 delay-200"
              >
                {agent.model ? (
                  <span
                    className="px-1.5 py-1 text-xs text-muted-foreground"
                    title={`This agent always runs on ${modelLabel(pinnedModel ?? { name: agent.model })}`}
                  >
                    {pinnedModel ? modelLabel(pinnedModel) : agent.model}
                  </span>
                ) : (
                  modelSelect
                )}
                <div className="flex-1" />
                <InputGroupButton
                  variant="default"
                  size="icon-xs"
                  className="rounded-lg"
                  onClick={send}
                  disabled={!inputText.trim()}
                  aria-label="Send message"
                >
                  <ArrowUp />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          ) : (
            <div key="start" className="flex animate-in fade-in justify-center duration-300 pt-4">
              <Button variant="outline" size="sm" onClick={() => onComposingChange(true)}>
                <Plus />
                Start new session
              </Button>
            </div>
          )}
        </div>
      </div>

      <ScheduleDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        agents={agents}
        schedule={editingSchedule}
        defaultAgentId={agent.id}
      />
      <WorkflowDialog
        open={workflowDialogOpen}
        onOpenChange={setWorkflowDialogOpen}
        agents={agents}
        workflow={editingWorkflow}
        defaultAgentId={agent.id}
      />
    </div>
  );
}
