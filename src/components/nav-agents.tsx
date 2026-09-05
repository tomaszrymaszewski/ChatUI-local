import { useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react"
import { AgentAvatar } from "@/components/agent-avatar"

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
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { AgentDefinition, ChatSession } from "@/types"
import { Spinner } from "@/components/ui/spinner"

/**
 * Agent-mode sidebar content: the saved agents (start sessions with them)
 * plus every agent-mode session (standalone tasks and agent chats).
 */
export function NavAgents({
  agents,
  sessions,
  activeSessionId,
  onOpenAgentConsole,
  onStartAgentSession,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onDeleteAgent,
  onOpenAgentSettings,
  runningIds,
}: {
  agents: AgentDefinition[]
  sessions: ChatSession[]
  activeSessionId: string | null
  onOpenAgentConsole: (agentId: string) => void
  onStartAgentSession: (agentId: string) => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onRenameSession?: (id: string, title: string) => void
  onDeleteAgent: (id: string) => void
  onOpenAgentSettings?: (id: string) => void
  runningIds?: Set<string>
}) {
  const { isMobile } = useSidebar()
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState("")

  const agentNameFor = (agentId?: string) =>
    agents.find((a) => a.id === agentId)?.name

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

  const onRename = onRenameSession

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Agents</SidebarGroupLabel>
        <SidebarMenu>
          {agents.map((agent) => (
            <SidebarMenuItem key={agent.id}>
              <SidebarMenuButton
                onClick={() => onOpenAgentConsole(agent.id)}
                tooltip={agent.purpose || agent.name}
              >
                <AgentAvatar seed={agent.id} className="size-4" />
                <span className="truncate">{agent.name}</span>
              </SidebarMenuButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuAction showOnHover>
                    <MoreHorizontal />
                    <span className="sr-only">More</span>
                  </SidebarMenuAction>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-44 rounded-lg"
                  side={isMobile ? "bottom" : "right"}
                  align={isMobile ? "end" : "start"}
                >
                  <DropdownMenuItem onClick={() => onStartAgentSession(agent.id)}>
                    <Plus className="text-muted-foreground" />
                    <span>New session</span>
                  </DropdownMenuItem>
                  {onOpenAgentSettings && (
                    <DropdownMenuItem onClick={() => onOpenAgentSettings(agent.id)}>
                      <Settings2 className="text-muted-foreground" />
                      <span>Settings…</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDeleteAgent(agent.id)}
                  >
                    <Trash2 className="text-muted-foreground" />
                    <span>Delete agent</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          ))}
          {agents.length === 0 && (
            <span className="px-2 text-xs text-muted-foreground">
              No agents yet — click "New Agent" to set one up.
            </span>
          )}
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Tasks & Sessions</SidebarGroupLabel>
        <SidebarMenu>
          {sessions.map((session) => {
            const agentName = agentNameFor(session.agentId)
            return (
              <SidebarMenuItem key={session.id}>
                <SidebarMenuButton
                  isActive={session.id === activeSessionId}
                  onClick={() => onSelectSession(session.id)}
                >
                  <span className="truncate">{session.title}</span>
                  {runningIds?.has(session.id) && (
                    <Spinner className="ml-auto size-3" />
                  )}
                  {session.agentId && !runningIds?.has(session.id) && (
                    <AgentAvatar
                      seed={session.agentId}
                      className="ml-auto -mr-7 size-4 max-md:opacity-0 md:group-hover/menu-item:opacity-0 md:group-focus-within/menu-item:opacity-0 md:group-has-data-[state=open]/menu-item:opacity-0"
                      title={agentName}
                    />
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
                      onClick={() => onDeleteSession(session.id)}
                    >
                      <Trash2 className="text-muted-foreground" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            )
          })}
          {sessions.length === 0 && (
            <span className="px-2 text-xs text-muted-foreground">
              No tasks yet — click "New Task" to start one.
            </span>
          )}
        </SidebarMenu>
      </SidebarGroup>

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) { setRenameTarget(null); setRenameDraft(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-5" />
              Rename
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <Input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              placeholder="Session name"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitRename()
                if (e.key === "Escape") { setRenameTarget(null); setRenameDraft("") }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setRenameTarget(null); setRenameDraft(""); }}>Cancel</Button>
              <Button size="sm" disabled={!renameDraft.trim()} onClick={handleCommitRename}>Rename</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
