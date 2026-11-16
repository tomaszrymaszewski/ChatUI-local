import { useState } from "react";
import {
  LayoutDashboard,
  MoreHorizontal,
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import type { AgentDefinition, ChatSession } from "@/types"
import { Spinner } from "@/components/ui/spinner"

/**
 * Agent-mode sidebar content: the saved agents (start sessions with them)
 * plus every agent-mode session (standalone tasks and agent chats).
 */
/**
 * Agent avatar rail — rendered only when the sidebar is collapsed to the
 * icon rail (the Agents group above is hidden there). Expanded, this
 * renders nothing.
 */
export function AgentAvatarRail({
  agents,
  activeAgentId,
  onOpenAgentConsole,
}: {
  agents: AgentDefinition[]
  activeAgentId?: string | null
  onOpenAgentConsole: (agentId: string) => void
}) {
  if (agents.length === 0) return null
  return (
    <SidebarGroup className="hidden group-data-[collapsible=icon]:flex">
      <SidebarMenu>
        {agents.map((agent) => (
          <SidebarMenuItem key={agent.id}>
            <SidebarMenuButton
              isActive={agent.id === activeAgentId}
              onClick={() => onOpenAgentConsole(agent.id)}
              tooltip={agent.name}
            >
              <AgentAvatar seed={agent.id} className="size-4" />
              <span>{agent.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

export function NavAgents({
  agents,
  sessions,
  activeSessionId,
  onOpenAgentChat,
  onOpenAgentDashboard,
  onOpenMainDashboard,
  onDeleteAgent,
  onOpenAgentSettings,
  runningIds,
  activeAgentId,
}: {
  agents: AgentDefinition[]
  sessions: ChatSession[]
  activeSessionId: string | null
  /** Click on an agent — open its most recent conversation. */
  onOpenAgentChat: (agentId: string) => void
  /** "Dashboard" in the agent's overflow menu — open its per-agent console. */
  onOpenAgentDashboard: (agentId: string) => void
  /** The "New" button under the agents — open the main fleet dashboard. */
  onOpenMainDashboard: () => void
  onDeleteAgent: (id: string) => void
  onOpenAgentSettings?: (id: string) => void
  runningIds?: Set<string>
  activeAgentId?: string | null
}) {
  const { isMobile } = useSidebar()
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const deleteSessionCount = deleteTarget
    ? sessions.filter((s) => s.agentId === deleteTarget.id).length
    : 0

  const latestSessionFor = (agentId: string) =>
    sessions.find((s) => s.agentId === agentId)?.id ?? null

  const hasRunningSession = (agentId: string) =>
    sessions.some((s) => s.agentId === agentId && runningIds?.has(s.id))

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarMenu className="gap-1.5">
          {agents.map((agent) => {
            const latestId = latestSessionFor(agent.id)
            const running = hasRunningSession(agent.id)
            return (
              <SidebarMenuItem key={agent.id}>
                {/* Large agent button: tall row + big avatar. Clicking opens
                    the agent's most recent conversation. */}
                <SidebarMenuButton
                  isActive={!!latestId && latestId === activeSessionId}
                  onClick={() => onOpenAgentChat(agent.id)}
                  tooltip={agent.purpose || agent.name}
                  className="h-auto items-center gap-3 py-2.5 pr-10"
                >
                  <div className="relative shrink-0">
                    <AgentAvatar seed={agent.id} className="size-9" />
                    {running && (
                      <span className="absolute -right-0.5 -top-0.5 flex size-3 items-center justify-center rounded-full bg-emerald-500 text-emerald-50">
                        <Spinner className="size-2" />
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium leading-tight">
                      {agent.name}
                    </span>
                    {agent.purpose && (
                      <span className="truncate text-xs leading-snug text-muted-foreground">
                        {agent.purpose}
                      </span>
                    )}
                  </div>
                </SidebarMenuButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuAction showOnHover className="top-1/2 -translate-y-1/2">
                      <MoreHorizontal />
                      <span className="sr-only">More</span>
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-44 rounded-lg"
                    side={isMobile ? "bottom" : "right"}
                    align={isMobile ? "end" : "start"}
                  >
                    <DropdownMenuItem onClick={() => onOpenAgentDashboard(agent.id)}>
                      <LayoutDashboard className="text-muted-foreground" />
                      <span>Dashboard</span>
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
                      onClick={() => setDeleteTarget({ id: agent.id, name: agent.name })}
                    >
                      <Trash2 className="text-muted-foreground" />
                      <span>Delete agent</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            )
          })}
          {agents.length === 0 && (
            <span className="px-2 text-xs text-muted-foreground">
              No agents yet
            </span>
          )}

          {/* "New" — opens the main fleet dashboard (create an agent / start a
              session). This is the only entry point to the main dashboard. */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onOpenMainDashboard}
              tooltip="New"
              className="mt-1 justify-center border border-dashed text-muted-foreground hover:text-foreground"
            >
              <Plus />
              <span>New</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      <AgentAvatarRail
        agents={agents}
        activeAgentId={activeAgentId}
        onOpenAgentConsole={onOpenAgentChat}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5" />
              Delete {deleteTarget?.name ?? "agent"}?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes the agent, its workspace and knowledge
              files
              {deleteSessionCount > 0
                ? `, and the ${deleteSessionCount} chat${deleteSessionCount === 1 ? "" : "s"} with it`
                : " (it has no chats yet)"}
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleteTarget) onDeleteAgent(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
