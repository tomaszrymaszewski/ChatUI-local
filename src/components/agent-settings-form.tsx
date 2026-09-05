import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDirectoryPicker } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Check, ChevronDown, FileText, FolderPlus, Image as ImageIcon, Pencil, Plug, Sparkles, X } from "lucide-react";
import type { AgentAttachment, AgentDefinition, Project } from "@/types";
import type { AgentUpdatePatch } from "@/lib/agents";
import { listInstalledSkills } from "@/lib/skills-library";
import { MCP_CATALOG } from "@/lib/mcp-catalog";
import { deleteFileBlob, getFileBlob, putFileBlob } from "@/lib/attachment-store";
import { extractFileText } from "@/lib/files";
import { modelLabel } from "@/lib/model-display";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_MODEL_VALUE = "__default__";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
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
 * The agent's full settings surface, shared by the settings dialog and the
 * agent console's right panel. Everything saves immediately (the app's
 * settings convention): text fields commit on blur/Enter, toggles and lists
 * on change. Folder/project/knowledge access is user-only — the agent can
 * never widen it via chat.
 */
export function AgentSettingsForm({
  agent,
  onUpdate,
  projects,
  models,
}: {
  agent: AgentDefinition;
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
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [purposeDraft, setPurposeDraft] = useState(agent.purpose);
  const [instructionsDraft, setInstructionsDraft] = useState(agent.systemPrompt);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [installedSkills, setInstalledSkills] = useState<Array<{ name: string; path: string }>>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createdUrlsRef = useRef<Set<string>>(new Set());

  const update = (patch: AgentUpdatePatch) => onUpdate(agent.id, patch);

  // Keep text drafts in sync with the agent record (external changes — e.g.
  // the agent editing itself mid-chat — show up here too).
  useEffect(() => {
    setNameDraft(agent.name);
    setPurposeDraft(agent.purpose);
    setInstructionsDraft(agent.systemPrompt);
  }, [agent]);

  useEffect(() => {
    void listInstalledSkills("global").then(setInstalledSkills).catch(() => setInstalledSkills([]));
  }, []);

  // Rehydrate image previews from the persistent file store (skip ones we
  // already have previews for — freshly-added files keep theirs while their
  // async blob write lands).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const a of agent.attachments ?? []) {
        if (!a.storageId || !a.type.startsWith("image/")) continue;
        if (imageUrls[a.id]) continue;
        const blob = await getFileBlob(a.storageId);
        if (cancelled || !blob) continue;
        const url = URL.createObjectURL(blob);
        createdUrlsRef.current.add(url);
        setImageUrls((prev) => ({ ...prev, [a.id]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.attachments]);

  // Revoke every preview URL this form created, on unmount only.
  useEffect(() => {
    const created = createdUrlsRef.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);

  const groupedModels = useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const m of models) {
      const list = map.get(m.providerName) ?? [];
      list.push(m);
      map.set(m.providerName, list);
    }
    return Array.from(map.entries());
  }, [models]);

  // Installed skills plus any saved-but-uninstalled names (so they stay visible/removable).
  const skillRows = useMemo(() => {
    const names = new Set(installedSkills.map((s) => s.name));
    const extra = agent.skills.filter((n) => !names.has(n)).map((n) => ({ name: n, path: "" }));
    return [...installedSkills, ...extra];
  }, [installedSkills, agent.skills]);

  const toggleListValue = (list: string[], value: string, patch: (next: string[]) => void) => {
    patch(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

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

  const handleFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length === 0) return;
    void (async () => {
      const next: AgentAttachment[] = [...(agent.attachments ?? [])];
      for (const file of picked) {
        const id = crypto.randomUUID();
        if (file.type.startsWith("image/")) {
          void putFileBlob(id, file).catch(() => {});
          const url = URL.createObjectURL(file);
          createdUrlsRef.current.add(url);
          setImageUrls((prev) => ({ ...prev, [id]: url }));
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

  const removeAttachment = (att: AgentAttachment) => {
    void deleteFileBlob(att.storageId ?? att.id);
    const url = imageUrls[att.id];
    if (url) {
      URL.revokeObjectURL(url);
      createdUrlsRef.current.delete(url);
      setImageUrls((prev) => {
        const next = { ...prev };
        delete next[att.id];
        return next;
      });
    }
    update({
      attachments: (agent.attachments ?? []).filter((a) => a.id !== att.id),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Instructions */}
      <div className="flex flex-col gap-3">
        <SectionTitle>Instructions</SectionTitle>
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
              onChange={(e) => setInstructionsDraft(e.currentTarget.value)}
              onBlur={commitInstructions}
              rows={6}
              placeholder="The agent's own system prompt — identity, how it works, its limits…"
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-muted/30 p-3">
              {agent.systemPrompt ? (
                <MarkdownRenderer content={agent.systemPrompt} className="text-sm break-words" />
              ) : (
                <p className="text-xs text-muted-foreground">
                  (No system prompt set — click the pencil to write one)
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Preferences — collapsed by default */}
      <Collapsible open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between">
            <SectionTitle>Preferences</SectionTitle>
            <ChevronDown
              className={`size-3.5 text-muted-foreground transition-transform ${
                preferencesOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pt-3">
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
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Skills</span>
          </div>
          {skillRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No installed skills yet — install some in Settings → Skills.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {skillRows.map((skill) => (
                <div
                  key={skill.name}
                  className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
                >
                  <span className="truncate font-mono text-xs">{skill.name}</span>
                  <Switch
                    checked={agent.skills.includes(skill.name)}
                    onCheckedChange={() =>
                      toggleListValue(agent.skills, skill.name, (skills) => update({ skills }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Plug className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Connectors</span>
          </div>
          <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto rounded-lg border p-2">
            {MCP_CATALOG.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 p-1"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{entry.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.tagline}
                  </span>
                </div>
                <Switch
                  checked={agent.connectors.includes(entry.id)}
                  onCheckedChange={() =>
                    toggleListValue(agent.connectors, entry.id, (connectors) => update({ connectors }))
                  }
                />
              </div>
            ))}
            {agent.connectors
              .filter((id) => !MCP_CATALOG.some((c) => c.id === id))
              .map((id) => (
                <div key={id} className="flex items-center justify-between gap-3 p-1">
                  <span className="truncate font-mono text-xs">{id}</span>
                  <Switch
                    checked={agent.connectors.includes(id)}
                    onCheckedChange={() =>
                      toggleListValue(agent.connectors, id, (connectors) => update({ connectors }))
                    }
                  />
                </div>
              ))}
          </div>
        </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* Access */}
      <div className="flex flex-col gap-3">
        <SectionTitle>Access</SectionTitle>
        <p className="text-xs text-muted-foreground">
          Sandboxed by default: the agent can only touch its private workspace
          plus the folders and projects you grant here. Every local action
          still shows an approve/deny card.
        </p>
        <PermissionRow
          label="Web access"
          description="Search and fetch the web"
          checked={agent.capabilities.web}
          onCheckedChange={(web) => update({ capabilities: { web } })}
        />
        <PermissionRow
          label="Local files"
          description="Read/write files in its workspace and the folders below — each access approved"
          checked={agent.capabilities.files}
          onCheckedChange={(files) => update({ capabilities: { files } })}
        />
        <PermissionRow
          label="Terminal & coding"
          description="Run shell commands and delegate coding tasks — each command approved"
          checked={agent.capabilities.terminal}
          onCheckedChange={(terminal) => update({ capabilities: { terminal } })}
        />
        <PermissionRow
          label="Read past chats"
          description="Search and read your chat history"
          checked={agent.readChats ?? false}
          onCheckedChange={(readChats) => update({ readChats })}
        />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Folders</Label>
            <Button variant="outline" size="sm" onClick={() => void addFolder()}>
              <FolderPlus className="size-4" />
              Add folder
            </Button>
          </div>
          {(agent.allowedFolders ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No folders granted yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(agent.allowedFolders ?? []).map((folder) => (
                <Badge key={folder} variant="secondary" className="gap-1 pr-1 font-mono text-[11px]">
                  <span className="max-w-64 truncate">{folder}</span>
                  <button
                    aria-label={`Remove ${folder}`}
                    className="rounded-full p-0.5 hover:bg-accent"
                    onClick={() =>
                      update({
                        allowedFolders: (agent.allowedFolders ?? []).filter((f) => f !== folder),
                      })
                    }
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
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
      </div>

      <Separator />

      {/* Knowledge */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Knowledge files &amp; images</SectionTitle>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <FileText className="size-4" />
            Add files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFilesPicked}
          />
        </div>
        {(agent.attachments ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Files and images attached here are sent with every run of this agent.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {(agent.attachments ?? []).map((att) => (
              <Attachment key={att.id} size="sm">
                <AttachmentMedia
                  variant={imageUrls[att.id] ? "image" : "icon"}
                >
                  {imageUrls[att.id] ? (
                    <img src={imageUrls[att.id]} alt={att.name} />
                  ) : att.type.startsWith("image/") ? (
                    <ImageIcon />
                  ) : (
                    <FileText />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{att.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {formatBytes(att.size)}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Remove ${att.name}`}
                    onClick={() => removeAttachment(att)}
                  >
                    <X />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
