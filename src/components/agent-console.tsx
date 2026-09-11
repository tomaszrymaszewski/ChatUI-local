import { useEffect, useMemo, useState } from "react";
import { open as openDirectoryPicker } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  ArrowUp,
  BarChart3,
  CalendarClock,
  Check,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Pencil,
  Plus,
  Settings2,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";
import type { AgentDefinition, AgentSchedule, AgentWorkflow, BackgroundPattern, ChatSession, MessageAttachment, Project } from "@/types";
import type { AgentUpdatePatch } from "@/lib/agents";
import { modelLabel } from "@/lib/model-display";
import { describeCadence, deleteSchedule, loadSchedules, subscribeToSchedules, updateSchedule } from "@/lib/schedules";
import { deleteWorkflow, loadWorkflows, subscribeToWorkflows } from "@/lib/workflows";
import { ensureAgentWorkspace } from "@/lib/agent/sandbox";
import { AgentAvatar } from "@/components/agent-avatar";
import type { AgentConsoleTab } from "@/components/app-sidebar";
import { AgentUsageChart } from "@/components/agent-usage-chart";
import { ScheduleDialog } from "@/components/schedule-dialog";
import { WorkflowDialog } from "@/components/workflow-dialog";
import { PatternBackground } from "@/components/background-pattern";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  FolderViewerDialog,
  type FolderViewerTarget,
} from "@/components/folder-viewer-dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadUserSettings, saveUserSettings } from "@/hooks/use-user-settings";
import { scheduleKnowledgeSweep } from "@/lib/knowledge-index";
import { cn } from "@/lib/utils";

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

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
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
 * A clickable folder tile (Access tab). Opens the read-only folder viewer on
 * click; granted folders reveal a revoke X on hover.
 */
function FolderBox({
  title,
  displayPath,
  workspace,
  onOpen,
  onRevoke,
}: {
  title: string;
  displayPath: string;
  workspace?: boolean;
  onOpen: () => void;
  onRevoke?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="group relative flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {workspace ? (
        <HardDrive className="size-5 shrink-0 text-muted-foreground" />
      ) : (
        <Folder className="size-5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate text-xs font-medium">{title}</span>
      <span className="truncate font-mono text-[10px] text-muted-foreground">
        {displayPath}
      </span>
      {onRevoke && (
        <button
          aria-label={`Revoke ${title}`}
          className="absolute right-1.5 top-1.5 rounded-full p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRevoke();
          }}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Segmented Off / All / Selected control for the external chats scope. */
function ScopeControl({
  value,
  onChange,
}: {
  value: "off" | "all" | "selected";
  onChange: (value: "off" | "all" | "selected") => void;
}) {
  const options: Array<{ key: "off" | "all" | "selected"; label: string }> = [
    { key: "off", label: "Off" },
    { key: "selected", label: "Select" },
    { key: "all", label: "All" },
  ];
  return (
    <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted/70 p-1">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={value === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === opt.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The agent page (sidebar agent click): header + the panel selected in the
 * sidebar (General / Access / Automations) above a composer pinned to the
 * bottom (like the dashboard).
 * - General: the agent's profile — avatar, name, purpose, system prompt
 *   (first lines + fade, expandable to edit), token usage.
 * - Access: local folders (boxes + read-only file viewer modal), internet /
 *   terminal capabilities, visible chats & projects.
 * - Automations: schedules and workflows.
 * Past sessions live in the sidebar's Sessions section.
 */
export function AgentConsole({
  agent,
  agents,
  sessions,
  allSessions,
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
  files = [],
  onRemoveFile,
}: {
  agent: AgentDefinition;
  /** All saved agents (for schedule/workflow step pickers). */
  agents: AgentDefinition[];
  /** This agent's sessions, newest first. */
  sessions: ChatSession[];
  /** Every session in the app — the external chats/tasks picker. */
  allSessions: ChatSession[];
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
  /** Files dropped/attached for the new session (owned by ChatView's composer state). */
  files?: MessageAttachment[];
  onRemoveFile?: (id: string) => void;
}) {
  const [inputText, setInputText] = useState("");
  const [schedules, setSchedules] = useState<AgentSchedule[]>(loadSchedules());
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>(loadWorkflows());
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<AgentSchedule | null>(null);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<AgentWorkflow | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerTarget, setViewerTarget] = useState<FolderViewerTarget | null>(null);
  /** Confirm before granting "read every chat in the app" (embedding cost). */
  const [allChatsConfirm, setAllChatsConfirm] = useState(false);
  /** Confirm before granting "work in every project's folder". */
  const [allProjectsConfirm, setAllProjectsConfirm] = useState(false);

  // Identity drafts (General tab) — resync when the record changes
  // externally (e.g. the agent editing itself mid-chat).
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [purposeDraft, setPurposeDraft] = useState(agent.purpose);
  const [instructionsDraft, setInstructionsDraft] = useState(agent.systemPrompt);
  const [editingInstructions, setEditingInstructions] = useState(false);

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

  /** Grant "all" after the user confirmed the embedding/token cost. */
  const allowAllChats = () => {
    setAllChatsConfirm(false);
    update({ externalChats: "all" });
    // The granted chats are retrieved through the knowledge index — make sure
    // chat embedding is on and sweep now so the embeddings exist.
    const s = loadUserSettings();
    if (!s.knowledgeEnabled || !s.knowledgeSources.chats) {
      saveUserSettings({
        ...s,
        knowledgeEnabled: true,
        knowledgeSources: { ...s.knowledgeSources, chats: true },
      });
    }
    scheduleKnowledgeSweep(0);
  };

  const send = () => {
    const text = inputText.trim();
    if (!text && files.length === 0) return;
    setInputText("");
    onComposingChange(false);
    onSend(text);
  };

  const pinnedModel = agent.model
    ? models.find((m) => m.name === agent.model)
    : undefined;

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

  // Project access as a scope: "all projects" wins; a defined allowedProjects
  // list (even empty) means "selected"; undefined means nothing granted yet.
  const projectScope: "off" | "all" | "selected" = (agent.allProjects
    ? "all"
    : agent.allowedProjects !== undefined
      ? "selected"
      : "off");

  // Candidate sessions for the external chats/tasks picker: everything in
  // the app that isn't this agent's own and isn't a throwaway chat.
  const externalCandidates = useMemo(
    () =>
      allSessions.filter(
        (s) => !s.isTemporary && s.agentId !== agent.id && !s.isSetup,
      ),
    [allSessions, agent.id],
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

  const openFolderViewer = (target: FolderViewerTarget) => {
    setViewerTarget(target);
    setViewerOpen(true);
  };

  const openWorkspaceViewer = async () => {
    const workspace = await ensureAgentWorkspace(agent.id).catch(() => undefined);
    if (!workspace) {
      toast.error("Folder viewer is only available in the desktop app");
      return;
    }
    openFolderViewer({ title: "Private workspace", path: workspace, isWorkspace: true });
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
          <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-4 px-4 pt-4 pb-24">
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
                {/* ─── Profile header — this tab is the agent's profile ─── */}
                <div className="flex items-center gap-4 pt-1">
                  <AgentAvatar seed={agent.id} className="size-16 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Input
                      id={`agent-name-${agent.id}`}
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={commitName}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitName(); } }}
                      placeholder="Agent name"
                      aria-label="Agent name"
                      className="h-auto rounded-md border-0 bg-transparent px-1.5 text-xl font-semibold shadow-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-1"
                    />
                    <Input
                      id={`agent-purpose-${agent.id}`}
                      value={purposeDraft}
                      onChange={(e) => setPurposeDraft(e.target.value)}
                      onBlur={commitPurpose}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitPurpose(); } }}
                      placeholder="One-line purpose shown in the sidebar"
                      aria-label="Agent purpose"
                      className="h-auto rounded-md border-0 bg-transparent px-1.5 text-sm font-normal text-muted-foreground shadow-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-1"
                    />
                  </div>
                </div>

                {/* ─── Identity (system prompt) ─── */}
                <SectionCard
                  icon={<Pencil className="size-3.5 text-muted-foreground" />}
                  title="Identity"
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`agent-instructions-${agent.id}`}>System prompt</Label>
                      <Button
                        variant="outline"
                        size="xs"
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
                        {editingInstructions ? (
                          <>
                            <Check className="size-3" />
                            Done
                          </>
                        ) : (
                          <>
                            <Pencil className="size-3" />
                            Edit system prompt
                          </>
                        )}
                      </Button>
                    </div>
                    {editingInstructions ? (
                      <Textarea
                        id={`agent-instructions-${agent.id}`}
                        autoFocus
                        value={instructionsDraft}
                        onChange={(e) => setInstructionsDraft(e.target.value)}
                        onBlur={commitInstructions}
                        rows={10}
                        placeholder="The agent's own system prompt — identity, how it works, its limits…"
                      />
                    ) : agent.systemPrompt ? (
                      // Preview: roughly the first five lines; the rest fades
                      // out — click "Edit system prompt" to see and edit it all.
                      <div className="relative max-h-36 overflow-hidden rounded-lg border bg-muted/30 p-3">
                        <MarkdownRenderer content={agent.systemPrompt} className="break-words text-sm" />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        (No system prompt set — click "Edit system prompt" to write one)
                      </p>
                    )}
                  </div>
                </SectionCard>

                {/* ─── Usage ─── */}
                <SectionCard
                  icon={<BarChart3 className="size-3.5 text-muted-foreground" />}
                  title="Usage"
                >
                  <AgentUsageChart agentId={agent.id} />
                </SectionCard>
              </>
            )}

            {tab === "access" && (
              <>

                {/* ─── Folders ─── */}
                <SectionCard
                  icon={<FolderPlus className="size-3.5 text-muted-foreground" />}
                  title="Folders"
                  action={
                    <Button variant="outline" size="xs" onClick={() => void addFolder()}>
                      <FolderPlus className="size-3" />
                      Add folder
                    </Button>
                  }
                >
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <FolderBox
                      title="Private workspace"
                      displayPath={`~/Documents/chatUI/agents/${agent.id}`}
                      workspace
                      onOpen={() => void openWorkspaceViewer()}
                    />
                    {(agent.allowedFolders ?? []).map((folder) => (
                      <FolderBox
                        key={folder}
                        title={folder.split("/").filter(Boolean).pop() ?? folder}
                        displayPath={folder.replace(/^\/Users\/[^/]+/, "~")}
                        onOpen={() =>
                          openFolderViewer({
                            title: folder.split("/").filter(Boolean).pop() ?? folder,
                            path: folder,
                          })
                        }
                        onRevoke={() =>
                          update({
                            allowedFolders: (agent.allowedFolders ?? []).filter(
                              (f) => f !== folder,
                            ),
                          })
                        }
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Granted folders are trusted — file access inside them runs without
                    approval cards. Click a folder to browse what the agent can see.
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
                  <p className="text-xs text-muted-foreground">
                    {agent.name} can always search and read its own past sessions
                    ({sessions.length} so far). Chats from the Chat tab and other
                    agents' tasks are granted below.
                  </p>

                  {/* External chats & tasks from the rest of the app */}
                  <div className="flex flex-col gap-2 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">Read other chats & tasks</span>
                        <span className="text-xs text-muted-foreground">
                          Chats from the Chat tab and tasks from the Agents tab that aren't {agent.name}'s own
                        </span>
                      </div>
                      <ScopeControl
                        value={agent.externalChats ?? "off"}
                        onChange={(scope) => {
                          if (scope === "all" && (agent.externalChats ?? "off") !== "all") {
                            // Wide grant — confirm (every chat gets embedded).
                            setAllChatsConfirm(true);
                            return;
                          }
                          update({
                            externalChats: scope === "off" ? undefined : scope,
                          });
                        }}
                      />
                    </div>
                    {(agent.externalChats ?? "off") === "all" && (
                      <p className="text-xs text-muted-foreground">
                        Every chat and task is readable — {externalCandidates.length} so far,
                        including ones created later.
                      </p>
                    )}
                    {(agent.externalChats ?? "off") === "selected" && (
                      <div className="flex flex-col gap-1.5">
                        {externalCandidates.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No other chats or tasks yet.
                          </p>
                        ) : (
                          <ScrollArea className="h-44 rounded-lg border p-1">
                            <div className="flex flex-col">
                              {externalCandidates.map((session) => {
                                const checked = (agent.allowedExternalSessions ?? []).includes(
                                  session.id,
                                );
                                return (
                                  <button
                                    key={session.id}
                                    type="button"
                                    onClick={() =>
                                      toggleListValue(
                                        agent.allowedExternalSessions ?? [],
                                        session.id,
                                        (allowedExternalSessions) =>
                                          update({ allowedExternalSessions }),
                                      )
                                    }
                                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                                  >
                                    <Checkbox
                                      checked={checked}
                                      tabIndex={-1}
                                      className="pointer-events-none"
                                    />
                                    <span className="min-w-0 flex-1 truncate text-xs">
                                      {session.title || "untitled"}
                                    </span>
                                    <span className="shrink-0 rounded-full border px-1.5 py-px text-[9px] text-muted-foreground">
                                      {session.type === "agent" ? "Task" : "Chat"}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-muted-foreground">
                                      {new Date(session.updatedAt).toLocaleDateString([], {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">Work in projects</span>
                        <span className="text-xs text-muted-foreground">
                          Project folders {agent.name} may read and write in — granted folders are trusted, no approval cards
                        </span>
                      </div>
                      <ScopeControl
                        value={projectScope}
                        onChange={(scope) => {
                          if (scope === "all") {
                            if (projectScope !== "all") {
                              // Wide grant — confirm.
                              setAllProjectsConfirm(true);
                            }
                            return;
                          }
                          update({
                            allProjects: false,
                            allowedProjects: scope === "selected" ? (agent.allowedProjects ?? []) : undefined,
                          });
                        }}
                      />
                    </div>
                    {projectScope === "all" && (
                      <p className="text-xs text-muted-foreground">
                        Every project's folder is accessible — {projects.length} so far,
                        including ones created later.
                      </p>
                    )}
                    {projectScope === "selected" && (
                      <div className="flex flex-col gap-1.5">
                        {projects.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No projects yet — create one in the Projects view.
                          </p>
                        ) : (
                          <ScrollArea className="h-44 rounded-lg border p-1">
                            <div className="flex flex-col">
                              {projects.map((project) => {
                                const checked = (agent.allowedProjects ?? []).includes(project.id);
                                return (
                                  <button
                                    key={project.id}
                                    type="button"
                                    onClick={() =>
                                      toggleListValue(agent.allowedProjects ?? [], project.id, (allowedProjects) =>
                                        update({ allowedProjects }),
                                      )
                                    }
                                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                                  >
                                    <Checkbox
                                      checked={checked}
                                      tabIndex={-1}
                                      className="pointer-events-none"
                                    />
                                    <span className="min-w-0 flex-1 truncate text-xs">
                                      {project.name}
                                    </span>
                                    <span className="max-w-44 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                                      {project.directory?.replace(/^\/Users\/[^/]+/, "~") ?? "no folder linked"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        )}
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

      {/* ─── Start button / composer — pinned over the scrolling content,
           fading it out under the gradient (pointer-events pass through the
           fade zone so content beneath stays clickable) ─── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background via-background/60 to-transparent pt-10">
        <div className="pointer-events-auto mx-auto w-full max-w-6xl px-4 pb-4">
          {composing ? (
            <InputGroup
              key="composer"
              className="animate-in fade-in slide-in-from-bottom-3 bg-card duration-500"
            >
              {files.length > 0 && (
                <InputGroupAddon align="block-start">
                  <AttachmentGroup className="w-full">
                    {files.map((file) => (
                      <Attachment key={file.id} size="xs">
                        <AttachmentMedia variant={file.previewUrl ? "image" : "icon"}>
                          {file.previewUrl ? (
                            <img src={file.previewUrl} alt={file.name} />
                          ) : (
                            <FileText />
                          )}
                        </AttachmentMedia>
                        <AttachmentContent>
                          <AttachmentTitle>{file.name}</AttachmentTitle>
                          <AttachmentDescription>{formatBytes(file.size)}</AttachmentDescription>
                        </AttachmentContent>
                        <AttachmentActions>
                          <AttachmentAction
                            aria-label={`Remove ${file.name}`}
                            onClick={() => onRemoveFile?.(file.id)}
                          >
                            <X />
                          </AttachmentAction>
                        </AttachmentActions>
                      </Attachment>
                    ))}
                  </AttachmentGroup>
                </InputGroupAddon>
              )}
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
                  disabled={!inputText.trim() && files.length === 0}
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

      <Dialog open={allChatsConfirm} onOpenChange={setAllChatsConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Read every chat and task?</DialogTitle>
            <DialogDescription>
              {agent.name} will be able to search and read every chat in the app —
              your Chat-tab conversations and other agents' tasks included. For
              cheap retrieval, every chat is embedded into the knowledge index,
              which uses more tokens. Pick "Selected" instead to grant specific
              chats one by one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAllChatsConfirm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={allowAllChats}>
              Allow all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={allProjectsConfirm} onOpenChange={setAllProjectsConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Work in every project?</DialogTitle>
            <DialogDescription>
              {agent.name} will be able to read and write files in every project's
              folder — including projects created later. Pick "Selected" instead to
              grant specific projects one by one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAllProjectsConfirm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => { setAllProjectsConfirm(false); update({ allProjects: true }); }}>
              Allow all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
      <FolderViewerDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        target={viewerTarget}
      />
    </div>
  );
}
