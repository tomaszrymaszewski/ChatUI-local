import { useMemo, useRef, useState } from "react";
import { open as openDirectoryPicker } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  KeyRound,
  Pencil,
  Plug,
  ScrollText,
  Sparkles,
  X,
} from "lucide-react";
import type { AgentAttachment, AgentDefinition, ChatSession, Project } from "@/types";
import type { AgentUpdatePatch } from "@/lib/agents";
import { deleteFileBlob, putFileBlob } from "@/lib/attachment-store";
import { extractFileText } from "@/lib/files";
import { MCP_CATALOG } from "@/lib/mcp-catalog";
import { skillIcon } from "@/components/skills-panel";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

type PermissionKey = "web" | "terminal" | "readChats";

type FileView =
  | { kind: "system-prompt" }
  | { kind: "purpose" }
  | { kind: "permission"; key: PermissionKey }
  | { kind: "skill"; name: string; path: string }
  | { kind: "connector"; id: string }
  | { kind: "session"; sessionId: string }
  | { kind: "project"; projectId: string }
  | { kind: "granted-folder"; folder: string }
  | { kind: "workspace" }
  | { kind: "knowledge"; attachmentId: string };

interface TreeFile {
  type: "file";
  id: string;
  name: string;
  view: FileView;
}
interface TreeFolder {
  type: "folder";
  id: string;
  name: string;
  children: TreeFile[];
}

const PERMISSIONS: Array<{
  key: PermissionKey;
  file: string;
  label: string;
  description: string;
}> = [
  {
    key: "web",
    file: "web-access.md",
    label: "Web access",
    description: "Search and fetch the web. Mirrored in Preferences.",
  },
  {
    key: "terminal",
    file: "terminal-coding.md",
    label: "Terminal & coding",
    description: "Run shell commands and delegate coding tasks — each command approved. Mirrored in Preferences.",
  },
  {
    key: "readChats",
    file: "read-past-chats.md",
    label: "Read past chats",
    description: "Search and read your chat history. Mirrored in Preferences.",
  },
];

function permissionChecked(agent: AgentDefinition, key: PermissionKey): boolean {
  if (key === "web") return agent.capabilities.web;
  if (key === "terminal") return agent.capabilities.terminal;
  return agent.readChats ?? false;
}

function fileIcon(view: FileView) {
  switch (view.kind) {
    case "system-prompt":
      return ScrollText;
    case "purpose":
      return Bot;
    case "permission":
      return KeyRound;
    case "skill":
      return Sparkles;
    case "connector":
      return Plug;
    case "session":
      return CalendarClock;
    case "project":
      return Folder;
    case "granted-folder":
      return FolderPlus;
    case "workspace":
      return Folder;
    case "knowledge":
      return FileText;
  }
}

/**
 * The agent's filesystem: everything it can pull into context when needed —
 * instructions, permissions, skills, connectors, sessions, projects, granted
 * folders, knowledge. A virtual tree over the existing records (nothing here
 * is loaded into the model context until the run needs it). Identity and
 * permission entries mirror the General/Preferences tabs; both write through
 * to the same agent record.
 */
export function AgentAccess({
  agent,
  projects,
  sessions,
  installedSkills,
  onUpdateAgent,
  onSelectSession,
}: {
  agent: AgentDefinition;
  projects: Project[];
  /** This agent's sessions, newest first. */
  sessions: ChatSession[];
  installedSkills: Array<{ name: string; path: string }>;
  onUpdateAgent: (id: string, patch: AgentUpdatePatch) => void;
  onSelectSession: (id: string) => void;
}) {
  const update = (patch: AgentUpdatePatch) => onUpdateAgent(agent.id, patch);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState("file:system-prompt");
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(agent.systemPrompt);
  const [purposeDraft, setPurposeDraft] = useState(agent.purpose);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tree: TreeFolder[] = useMemo(() => {
    const sessionFiles: TreeFile[] = sessions.map((s) => ({
      type: "file",
      id: `file:session:${s.id}`,
      name: `${s.title.slice(0, 40) || "untitled"}.md`,
      view: { kind: "session", sessionId: s.id },
    }));
    const connectorFiles: TreeFile[] = [
      ...MCP_CATALOG.map((entry) => ({
        type: "file" as const,
        id: `file:connector:${entry.id}`,
        name: `${entry.id}.json`,
        view: { kind: "connector" as const, id: entry.id },
      })),
      ...agent.connectors
        .filter((id) => !MCP_CATALOG.some((c) => c.id === id))
        .map((id) => ({
          type: "file" as const,
          id: `file:connector:${id}`,
          name: `${id}.json`,
          view: { kind: "connector" as const, id },
        })),
    ];
    return [
      {
        type: "folder",
        id: "instructions",
        name: "instructions",
        children: [
          { type: "file", id: "file:system-prompt", name: "system-prompt.md", view: { kind: "system-prompt" } },
          { type: "file", id: "file:purpose", name: "purpose.txt", view: { kind: "purpose" } },
        ],
      },
      {
        type: "folder",
        id: "permissions",
        name: "permissions",
        children: PERMISSIONS.map((p) => ({
          type: "file",
          id: `file:permission:${p.key}`,
          name: p.file,
          view: { kind: "permission", key: p.key } as FileView,
        })),
      },
      {
        type: "folder",
        id: "skills",
        name: "skills",
        children: installedSkills.map((s) => ({
          type: "file",
          id: `file:skill:${s.name}`,
          name: `${s.name}.md`,
          view: { kind: "skill", name: s.name, path: s.path } as FileView,
        })),
      },
      { type: "folder", id: "connectors", name: "connectors", children: connectorFiles },
      { type: "folder", id: "sessions", name: "sessions", children: sessionFiles },
      {
        type: "folder",
        id: "projects",
        name: "projects",
        children: projects.map((p) => ({
          type: "file",
          id: `file:project:${p.id}`,
          name: `${p.name}.json`,
          view: { kind: "project", projectId: p.id } as FileView,
        })),
      },
      {
        type: "folder",
        id: "folders",
        name: "folders",
        children: [
          { type: "file", id: "file:workspace", name: "workspace.md", view: { kind: "workspace" } },
          ...(agent.allowedFolders ?? []).map((folder) => ({
            type: "file" as const,
            id: `file:granted-folder:${folder}`,
            name: folder.replace(/^\/Users\/[^/]+/, "~"),
            view: { kind: "granted-folder" as const, folder },
          })),
        ],
      },
      {
        type: "folder",
        id: "knowledge",
        name: "knowledge",
        children: (agent.attachments ?? []).map((a) => ({
          type: "file",
          id: `file:knowledge:${a.id}`,
          name: a.name,
          view: { kind: "knowledge", attachmentId: a.id } as FileView,
        })),
      },
    ];
  }, [agent, projects, sessions, installedSkills]);

  const selected: TreeFile | null = useMemo(() => {
    for (const folder of tree) {
      const found = folder.children.find((f) => f.id === selectedId);
      if (found) return found;
    }
    return tree[0]?.children[0] ?? null;
  }, [tree, selectedId]);

  const toggleFolder = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const handleKnowledgePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length === 0) return;
    void (async () => {
      const next: AgentAttachment[] = [...(agent.attachments ?? [])];
      for (const file of picked) {
        const id = crypto.randomUUID();
        if (file.type.startsWith("image/")) {
          void putFileBlob(id, file).catch(() => {});
        } else {
          void extractFileText(file)
            .then((text) => putFileBlob(id, file, { extractedText: text }))
            .catch(() => putFileBlob(id, file).catch(() => {}));
        }
        next.push({ id, name: file.name, size: file.size, type: file.type, storageId: id });
      }
      update({ attachments: next });
    })();
  };

  const commitPrompt = () => {
    if (promptDraft !== agent.systemPrompt) update({ systemPrompt: promptDraft });
    setEditingPrompt(false);
  };

  const commitPurpose = () => {
    if (purposeDraft !== agent.purpose) update({ purpose: purposeDraft });
    else setPurposeDraft(agent.purpose);
  };

  return (
    <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
      {/* ─── Tree ─── */}
      <div className="flex flex-col gap-0.5 rounded-xl border bg-card/60 p-2">
        {tree.map((folder) => {
          const isCollapsed = collapsed.has(folder.id);
          const FolderIcon = isCollapsed ? Folder : FolderOpen;
          return (
            <div key={folder.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleFolder(folder.id)}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-medium hover:bg-accent"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono">{folder.name}/</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {folder.children.length}
                </span>
              </button>
              {!isCollapsed && (
                <div className="flex flex-col gap-px pb-1 pl-5">
                  {folder.children.length === 0 ? (
                    <span className="px-1.5 py-1 text-[11px] italic text-muted-foreground">
                      empty
                    </span>
                  ) : (
                    folder.children.map((file) => {
                      const Icon = fileIcon(file.view);
                      const active = selected?.id === file.id;
                      return (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => setSelectedId(file.id)}
                          title={file.name}
                          className={cn(
                            "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent",
                            active ? "bg-accent font-medium" : "text-muted-foreground",
                          )}
                        >
                          <Icon className="size-3.5 shrink-0" />
                          <span className="truncate font-mono">{file.name}</span>
                        </button>
                      );
                    })
                  )}
                  {folder.id === "folders" && (
                    <button
                      type="button"
                      onClick={() => void addFolder()}
                      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-accent"
                    >
                      <FolderPlus className="size-3.5 shrink-0" />
                      <span>Add folder…</span>
                    </button>
                  )}
                  {folder.id === "knowledge" && (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-accent"
                      >
                        <FileText className="size-3.5 shrink-0" />
                        <span>Add files…</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleKnowledgePicked}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Detail ─── */}
      <div className="min-w-0 rounded-xl border bg-card/60 p-4">
        {selected && (
          <FileDetail
            file={selected}
            agent={agent}
            projects={projects}
            sessions={sessions}
            editingPrompt={editingPrompt}
            setEditingPrompt={setEditingPrompt}
            promptDraft={promptDraft}
            setPromptDraft={setPromptDraft}
            purposeDraft={purposeDraft}
            setPurposeDraft={setPurposeDraft}
            onCommitPrompt={commitPrompt}
            onCommitPurpose={commitPurpose}
            onUpdate={update}
            onSelectSession={onSelectSession}
          />
        )}
      </div>
    </div>
  );
}

function DetailHeader({ path, title }: { path: string; title: string }) {
  return (
    <div className="mb-3 flex min-w-0 flex-col gap-0.5">
      <span className="truncate font-mono text-[11px] text-muted-foreground">{path}</span>
      <span className="truncate text-sm font-semibold">{title}</span>
    </div>
  );
}

function FileDetail({
  file,
  agent,
  projects,
  sessions,
  editingPrompt,
  setEditingPrompt,
  promptDraft,
  setPromptDraft,
  purposeDraft,
  setPurposeDraft,
  onCommitPrompt,
  onCommitPurpose,
  onUpdate,
  onSelectSession,
}: {
  file: TreeFile;
  agent: AgentDefinition;
  projects: Project[];
  sessions: ChatSession[];
  editingPrompt: boolean;
  setEditingPrompt: (v: boolean) => void;
  promptDraft: string;
  setPromptDraft: (v: string) => void;
  purposeDraft: string;
  setPurposeDraft: (v: string) => void;
  onCommitPrompt: () => void;
  onCommitPurpose: () => void;
  onUpdate: (patch: AgentUpdatePatch) => void;
  onSelectSession: (id: string) => void;
}) {
  const view = file.view;

  if (view.kind === "system-prompt") {
    return (
      <div>
        <DetailHeader path="instructions/system-prompt.md" title="System prompt" />
        <p className="mb-3 text-xs text-muted-foreground">
          The agent's core instructions — also editable on the General tab.
        </p>
        <div className="mb-2 flex items-center justify-end">
          <Button
            variant="ghost"
            size="icon-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (editingPrompt) onCommitPrompt();
              else {
                setPromptDraft(agent.systemPrompt);
                setEditingPrompt(true);
              }
            }}
            aria-label={editingPrompt ? "Save system prompt" : "Edit system prompt"}
          >
            {editingPrompt ? <Check /> : <Pencil />}
          </Button>
        </div>
        {editingPrompt ? (
          <Textarea
            autoFocus
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            onBlur={onCommitPrompt}
            rows={10}
            placeholder="The agent's own system prompt — identity, how it works, its limits…"
          />
        ) : agent.systemPrompt ? (
          <div className="overflow-x-auto rounded-lg border bg-muted/30 p-3">
            <MarkdownRenderer content={agent.systemPrompt} className="break-words text-sm" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            (No system prompt set — click the pencil to write one)
          </p>
        )}
      </div>
    );
  }

  if (view.kind === "purpose") {
    return (
      <div>
        <DetailHeader path="instructions/purpose.txt" title="Purpose" />
        <p className="mb-3 text-xs text-muted-foreground">
          One-line purpose shown in the sidebar — also editable on the General tab.
        </p>
        <Label htmlFor="access-purpose">Purpose</Label>
        <Input
          id="access-purpose"
          value={purposeDraft}
          onChange={(e) => setPurposeDraft(e.target.value)}
          onBlur={onCommitPurpose}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommitPurpose();
            }
          }}
          placeholder="One-line description shown in the sidebar"
        />
      </div>
    );
  }

  if (view.kind === "permission") {
    const meta = PERMISSIONS.find((p) => p.key === view.key)!;
    const checked = permissionChecked(agent, view.key);
    const apply = (next: boolean) => {
      if (view.key === "web") onUpdate({ capabilities: { web: next } });
      else if (view.key === "terminal") onUpdate({ capabilities: { terminal: next } });
      else onUpdate({ readChats: next });
    };
    return (
      <div>
        <DetailHeader path={`permissions/${meta.file}`} title={meta.label} />
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{checked ? "Granted" : "Denied"}</span>
            <span className="text-xs text-muted-foreground">{meta.description}</span>
          </div>
          <Switch checked={checked} onCheckedChange={apply} />
        </div>
      </div>
    );
  }

  if (view.kind === "skill") {
    const { Icon, tile } = skillIcon(view.name);
    return (
      <div>
        <DetailHeader path={`skills/${view.name}.md`} title={view.name} />
        <div className="flex items-center gap-2">
          <span className={cn("flex size-7 items-center justify-center rounded-md", tile)}>
            <Icon className="size-4" />
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">{view.path}</span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Skills auto-invoke when a task needs them — the agent pulls this in via
          search only when relevant. Nothing to toggle.
        </p>
      </div>
    );
  }

  if (view.kind === "connector") {
    const entry = MCP_CATALOG.find((c) => c.id === view.id);
    const enabled = agent.connectors.includes(view.id);
    const toggle = () =>
      onUpdate({
        connectors: enabled
          ? agent.connectors.filter((c) => c !== view.id)
          : [...agent.connectors, view.id],
      });
    return (
      <div>
        <DetailHeader path={`connectors/${view.id}.json`} title={entry?.name ?? view.id} />
        {entry && (
          <p className="mb-3 text-xs text-muted-foreground">{entry.tagline}</p>
        )}
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="text-sm font-medium">{enabled ? "Connected" : "Not connected"}</span>
          <Switch checked={enabled} onCheckedChange={toggle} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Toggling adds/removes this app from the agent's filesystem. Install and
          sign in once in Settings → Connectors.
        </p>
        {!entry && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() =>
              onUpdate({ connectors: agent.connectors.filter((c) => c !== view.id) })
            }
          >
            <X className="size-3" />
            Remove custom connector
          </Button>
        )}
      </div>
    );
  }

  if (view.kind === "session") {
    const session = sessions.find((s) => s.id === view.sessionId);
    if (!session) return <p className="text-xs text-muted-foreground">Session not found.</p>;
    return (
      <div>
        <DetailHeader path={`sessions/${file.name}`} title={session.title} />
        <p className="mb-3 text-xs text-muted-foreground">
          Last active{" "}
          {session.updatedAt.toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          . Past chats stay out of context unless the agent searches them.
        </p>
        <Button variant="outline" size="sm" onClick={() => onSelectSession(session.id)}>
          Open session
        </Button>
      </div>
    );
  }

  if (view.kind === "project") {
    const project = projects.find((p) => p.id === view.projectId);
    if (!project) return <p className="text-xs text-muted-foreground">Project not found.</p>;
    const allowed = (agent.allowedProjects ?? []).includes(project.id);
    return (
      <div>
        <DetailHeader path={`projects/${project.name}.json`} title={project.name} />
        <p className="mb-3 font-mono text-[11px] text-muted-foreground">
          {project.directory ?? "no folder linked"}
        </p>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="text-sm font-medium">{allowed ? "Granted" : "Not granted"}</span>
          <Switch
            checked={allowed}
            onCheckedChange={() => {
              const list = agent.allowedProjects ?? [];
              onUpdate({
                allowedProjects: allowed
                  ? list.filter((id) => id !== project.id)
                  : [...list, project.id],
              });
            }}
          />
        </div>
      </div>
    );
  }

  if (view.kind === "granted-folder") {
    return (
      <div>
        <DetailHeader path={`folders/${file.name}`} title={view.folder} />
        <p className="mb-3 text-xs text-muted-foreground">
          Trusted folder — the agent works here freely, no approval cards.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onUpdate({
              allowedFolders: (agent.allowedFolders ?? []).filter((f) => f !== view.folder),
            })
          }
        >
          <X className="size-3" />
          Revoke folder
        </Button>
      </div>
    );
  }

  if (view.kind === "workspace") {
    return (
      <div>
        <DetailHeader path="folders/workspace.md" title="Private workspace" />
        <p className="mb-3 font-mono text-[11px] text-muted-foreground">
          ~/Documents/chatUI/agents/{agent.id}
        </p>
        <p className="text-xs text-muted-foreground">
          Always available to the agent and created on its first run. Files the
          agent writes here persist between sessions.
        </p>
      </div>
    );
  }

  // knowledge
  const att = (agent.attachments ?? []).find((a) => a.id === view.attachmentId);
  if (!att) return <p className="text-xs text-muted-foreground">File not found.</p>;
  return (
    <div>
      <DetailHeader path={`knowledge/${att.name}`} title={att.name} />
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        {att.type.startsWith("image/") ? (
          <ImageIcon className="size-4" />
        ) : (
          <FileText className="size-4" />
        )}
        <span>
          {formatBytes(att.size)} · {att.type || "unknown type"}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Sent with every run of this agent.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void deleteFileBlob(att.storageId ?? att.id);
          onUpdate({
            attachments: (agent.attachments ?? []).filter((a) => a.id !== att.id),
          });
        }}
      >
        <X className="size-3" />
        Remove file
      </Button>
    </div>
  );
}
