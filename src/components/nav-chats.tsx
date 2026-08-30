import { useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { ChatSession, Project } from "@/types"
import { Spinner } from "@/components/ui/spinner"

export function NavChats({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onRename,
  projects = [],
  label = "Recents",
  runningIds,
}: {
  sessions: ChatSession[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename?: (id: string, title: string) => void
  projects?: Project[]
  label?: string
  runningIds?: Set<string>
}) {
  const { isMobile } = useSidebar()
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState("")

  const projectNameFor = (projectId?: string) =>
    projects.find((p) => p.id === projectId)?.name

  const initialsFor = (name: string) =>
    name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3)

  const handleStartRename = (id: string, currentTitle: string) => {
    setRenameTarget({ id, title: currentTitle })
    setRenameDraft(currentTitle)
  }

  const handleCommitRename = () => {
    if (!renameTarget) return
    const trimmed = renameDraft.trim()
    if (trimmed && onRename) {
      onRename(renameTarget.id, trimmed)
    }
    setRenameTarget(null)
    setRenameDraft("")
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {sessions.map((session) => {
          const projectName = projectNameFor(session.projectId)
          return (
            <SidebarMenuItem key={session.id}>
              <SidebarMenuButton
                isActive={session.id === activeSessionId}
                onClick={() => onSelect(session.id)}
              >
                <span className="truncate">{session.title}</span>
                {runningIds?.has(session.id) && (
                  <Spinner className="ml-auto size-3" />
                )}
                {projectName && !runningIds?.has(session.id) && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {initialsFor(projectName)}
                  </Badge>
                )}
              </SidebarMenuButton>
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
                  {onRename && (
                    <DropdownMenuItem onClick={() => handleStartRename(session.id, session.title)}>
                      <Pencil className="text-muted-foreground" />
                      <span>Rename</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDelete(session.id)}
                  >
                    <Trash2 className="text-muted-foreground" />
                    <span>Delete Chat</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) { setRenameTarget(null); setRenameDraft(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-5" />
              Rename Chat
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <Input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              placeholder="Chat name"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitRename()
                if (e.key === "Escape") { setRenameTarget(null); setRenameDraft("") }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setRenameTarget(null); setRenameDraft("") }}>Cancel</Button>
              <Button size="sm" disabled={!renameDraft.trim()} onClick={handleCommitRename}>Rename</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  )
}
