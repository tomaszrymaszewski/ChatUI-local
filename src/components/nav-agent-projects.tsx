import { useState } from "react";
import {
  ChevronRight,
  Folder,
  MoreHorizontal,
  Pencil,
  Trash2,
  Globe,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Project } from "@/types";
import type { SessionMetadata } from "@/lib/opencode";

function SessionRow({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
  standalone,
}: {
  session: SessionMetadata;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  standalone?: boolean;
}) {
  const { isMobile } = useSidebar();

  const dropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction showOnHover>
          <MoreHorizontal />
          <span className="sr-only">More</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-40 rounded-lg"
        side={isMobile ? "bottom" : "right"}
        align={isMobile ? "end" : "start"}
      >
        <DropdownMenuItem
          onClick={() => onRename(session.title)}
        >
          <Pencil className="text-muted-foreground" />
          <span>Rename</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={onDelete}
        >
          <Trash2 className="text-muted-foreground" />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (standalone) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={isActive}
          onClick={onSelect}
          className="cursor-pointer"
        >
          <Globe className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{session.title}</span>
        </SidebarMenuButton>
        {dropdown}
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={isActive}
        onClick={onSelect}
        className="cursor-pointer"
      >
        <span className="truncate text-xs">{session.title}</span>
      </SidebarMenuSubButton>
      {dropdown}
    </SidebarMenuSubItem>
  );
}

export function NavAgentProjects({
  projects,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
}: {
  projects: Project[];
  sessions: SessionMetadata[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
}) {
  const [openProjects, setOpenProjects] = useState<Set<string>>(() => {
    return new Set();
  });
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const toggleProject = (id: string) => {
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sessionsForProject = (projectDir: string | null | undefined) =>
    projectDir
      ? sessions
          .filter((s) => s.directory === projectDir)
          .sort((a, b) => b.updated_at - a.updated_at)
      : [];

  const standaloneSessions = sessions
    .filter(
      (s) => !s.directory || !projects.some((p) => p.directory === s.directory),
    )
    .sort((a, b) => b.updated_at - a.updated_at);

  const projectsWithSessions = projects.filter(
    (p) => sessionsForProject(p.directory).length > 0,
  );

  const handleStartRename = (id: string, currentTitle: string) => {
    setRenameTarget({ id, title: currentTitle });
    setRenameDraft(currentTitle);
  };

  const handleCommitRename = () => {
    if (!renameTarget) return;
    const trimmed = renameDraft.trim();
    if (trimmed && renameTarget) {
      onRenameSession(renameTarget.id, trimmed);
    }
    setRenameTarget(null);
    setRenameDraft("");
  };

  const renderSessionRow = (s: SessionMetadata, standalone?: boolean) => (
    <SessionRow
      key={s.id}
      session={s}
      isActive={s.id === activeSessionId}
      onSelect={() => onSelectSession(s.id)}
      onDelete={() => onDeleteSession(s.id)}
      onRename={(title) => handleStartRename(s.id, title)}
      standalone={standalone}
    />
  );

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Sessions</SidebarGroupLabel>
      <SidebarMenu>
        {standaloneSessions.map((s) => renderSessionRow(s, true))}

        {projectsWithSessions.map((project) => {
          const projectSessions = sessionsForProject(project.directory);
          const isOpen = openProjects.has(project.id);

          return (
            <Collapsible
              key={project.id}
              open={isOpen}
              onOpenChange={() => toggleProject(project.id)}
              asChild
            >
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => toggleProject(project.id)}
                  tooltip={project.name}
                >
                  <ChevronRight
                    className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleProject(project.id);
                    }}
                  />
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{project.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {projectSessions.length}
                  </span>
                </SidebarMenuButton>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {projectSessions.map((s) => renderSessionRow(s))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        })}

        {projectsWithSessions.length === 0 && standaloneSessions.length === 0 && (
          <SidebarMenuItem>
            <span className="px-2 py-1 text-xs text-muted-foreground">
              No sessions yet. Start a new session to begin.
            </span>
          </SidebarMenuItem>
        )}
      </SidebarMenu>

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) { setRenameTarget(null); setRenameDraft(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-5" />
              Rename Session
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <Input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              placeholder="Session name"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitRename();
                if (e.key === "Escape") {
                  setRenameTarget(null);
                  setRenameDraft("");
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRenameTarget(null);
                  setRenameDraft("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!renameDraft.trim()}
                onClick={handleCommitRename}
              >
                Rename
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  );
}
