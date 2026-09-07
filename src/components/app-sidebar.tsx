import * as React from "react"
import {
  ArrowLeft,
  ArrowDownToLine,
  Bot,
  Brain,
  CalendarClock,
  ChartColumnBig,
  CircleFadingPlus,
  Cpu,
  GalleryVerticalEnd,
  KeyRound,
  LayoutDashboard,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Plug,
  Settings,
  Sparkles,
  Trash2,
  User,
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
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { isMacOS } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { NavChats } from "@/components/nav-chats"
import { AgentAvatarRail, NavAgents } from "@/components/nav-agents"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import type { AgentDefinition, ChatSession, Project } from "@/types"
import type { SettingsTab } from "@/pages/settings"
import { Spinner } from "@/components/ui/spinner"

/** Main-content panel selected for the open agent console. */
export type AgentConsoleTab = "general" | "access" | "automations"

const AGENT_TABS: Array<[AgentConsoleTab, string, React.ReactNode]> = [
  ["general", "General", <User className="size-4" />],
  ["access", "Access", <KeyRound className="size-4" />],
  ["automations", "Automations", <CalendarClock className="size-4" />],
]

const SETTINGS_TABS: Array<[SettingsTab, string, React.ReactNode]> = [
  ["general", "General", <User className="size-4" />],
  ["memory", "Memory", <Brain className="size-4" />],
  ["models", "Models & Providers", <Cpu className="size-4" />],
  ["skills", "Skills", <Sparkles className="size-4" />],
  ["connectors", "Connectors", <Plug className="size-4" />],
  ["updates", "Updates", <ArrowDownToLine className="size-4" />],
]

/**
 * Chat | Agents switcher at the top of the sidebar. Expanded: a segmented
 * control; collapsed to the icon rail: a single toggle button.
 */
function ModeSwitcher({
  activeTab,
  onTabChange,
}: {
  activeTab: "chat" | "agent"
  onTabChange: (tab: "chat" | "agent") => void
}) {
  const { state } = useSidebar()

  if (state === "collapsed") {
    const next = activeTab === "chat" ? "agent" : "chat"
    return (
      <SidebarMenu className="px-2 py-1">
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => onTabChange(next)}
            tooltip={activeTab === "chat" ? "Switch to Agents" : "Switch to Chat"}
          >
            {activeTab === "chat" ? <Bot /> : <MessageCircle />}
            <span>{activeTab === "chat" ? "Agents" : "Chat"}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  const tabButton = (
    tab: "chat" | "agent",
    label: string,
    icon: React.ReactNode,
  ) => (
    <button
      onClick={() => onTabChange(tab)}
      aria-pressed={activeTab === tab}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        activeTab === tab
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className="mx-2 mt-1 flex items-center gap-1 rounded-lg bg-muted/70 p-1">
      {tabButton("chat", "Chat", <MessageCircle className="size-3.5" />)}
      {tabButton("agent", "Agents", <Bot className="size-3.5" />)}
    </div>
  )
}

export function AppSidebar({
  sessions,
  activeSessionId,
  view = "chat",
  settingsTab = "general",
  activeTab = "chat",
  onSelectSession,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onSettings,
  onSettingsTabChange,
  onExitSettings,
  onProjects,
  onHistory,
  onComingSoon,
  onTabChange,
  onOpenDashboard,
  onSwitchToAgent,
  agents = [],
  onOpenAgentConsole,
  onStartAgentSession,
  onDeleteAgent,
  onOpenAgentSettings,
  projects,
  runningIds,
  activeAgentConsole,
  agentConsoleTab = "general",
  onAgentConsoleTabChange,
  onExitAgentConsole,
  agentSessions = [],
  onNewAgentSession,
  agentConsoleComposing = false,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  sessions: ChatSession[]
  activeSessionId: string | null
  view?: "chat" | "settings" | "projects" | "history"
  settingsTab?: SettingsTab
  activeTab?: "chat" | "agent"
  onSelectSession: (id: string) => void
  onNewChat: () => void
  onDeleteChat: (id: string) => void
  onRenameChat?: (id: string, title: string) => void
  onSettings?: () => void
  onSettingsTabChange?: (tab: SettingsTab) => void
  onExitSettings?: () => void
  onProjects?: () => void
  onHistory?: () => void
  onComingSoon?: (feature: string) => void
  onTabChange?: (tab: "chat" | "agent") => void
  onOpenDashboard?: () => void
  onSwitchToAgent?: (id: string) => void
  agents?: AgentDefinition[]
  onOpenAgentConsole?: (agentId: string) => void
  onStartAgentSession?: (agentId: string) => void
  onDeleteAgent?: (id: string) => void
  onOpenAgentSettings?: (id: string) => void
  projects?: Project[]
  runningIds?: Set<string>
  /** Agent whose console is open — the sidebar switches to its detail view. */
  activeAgentConsole?: AgentDefinition | null
  agentConsoleTab?: AgentConsoleTab
  onAgentConsoleTabChange?: (tab: AgentConsoleTab) => void
  onExitAgentConsole?: () => void
  /** This agent's sessions, newest first. */
  agentSessions?: ChatSession[]
  onNewAgentSession?: () => void
  /** The console's new-session page is open — nothing else highlights. */
  agentConsoleComposing?: boolean
}) {

  const { isMobile } = useSidebar()

  // Rename dialog state for the agent-console session list.
  const [agentSessionRename, setAgentSessionRename] = React.useState<{ id: string; title: string } | null>(null)
  const [agentSessionRenameDraft, setAgentSessionRenameDraft] = React.useState("")

  const startDrag = (e: React.MouseEvent) => {
    if (e.button === 0) getCurrentWindow().startDragging();
  };

  return (
      <Sidebar collapsible="icon" {...props}>
        {isMacOS && <div data-tauri-drag-region onMouseDown={startDrag} className="h-10 w-full shrink-0" />}

      {view !== "settings" && !activeAgentConsole && (
        <ModeSwitcher
          activeTab={activeTab}
          onTabChange={onTabChange ?? (() => {})}
        />
      )}

      {view !== "settings" && activeAgentConsole ? (
        <div key="agent-detail" className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-left-3 duration-300">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onExitAgentConsole} tooltip="Back to agents">
                  <ArrowLeft />
                  <span>Back to agents</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Preferences</SidebarGroupLabel>
              <SidebarMenu>
                {AGENT_TABS.map(([key, label, icon]) => (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton
                      isActive={agentConsoleTab === key && !agentConsoleComposing}
                      onClick={() => onAgentConsoleTabChange?.(key)}
                      tooltip={label}
                    >
                      {icon}
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup className="group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel>Sessions</SidebarGroupLabel>
              <SidebarGroupAction title="New session" onClick={onNewAgentSession}>
                <Plus className='size-1 text-foreground' />
                <span className="sr-only">New session</span>
              </SidebarGroupAction>
              <SidebarMenu>
                {agentSessions.map((session) => (
                  <SidebarMenuItem key={session.id}>
                    <SidebarMenuButton
                      isActive={session.id === activeSessionId && !agentConsoleComposing}
                      onClick={() => onSelectSession(session.id)}
                      tooltip={session.title}
                      // The kebab floats over the row, so keep the title's
                      // full width (menu actions normally reserve pr-8).
                      className="pr-2!"
                    >
                      <span className="truncate">{session.title}</span>
                      {runningIds?.has(session.id) && (
                        <Spinner className="ml-auto size-3" />
                      )}
                    </SidebarMenuButton>
                    {/* The kebab floats on top of the row (no space is taken
                        from the title); the opaque background keeps it readable
                        over the title text. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover className="bg-background shadow-sm">
                          <MoreHorizontal />
                          <span className="sr-only">More</span>
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="w-44 rounded-lg"
                        side={isMobile ? "bottom" : "right"}
                        align={isMobile ? "end" : "start"}
                      >
                        <DropdownMenuItem
                          onClick={() => {
                            setAgentSessionRename({ id: session.id, title: session.title });
                            setAgentSessionRenameDraft(session.title);
                          }}
                        >
                          <Pencil className="text-muted-foreground" />
                          <span>Rename</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onDeleteChat(session.id)}
                        >
                          <Trash2 className="text-muted-foreground" />
                          <span>Delete Session</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ))}
                {agentSessions.length === 0 && (
                  <span className="px-2 text-xs text-muted-foreground">
                    No sessions yet — tap + to start one.
                  </span>
                )}
              </SidebarMenu>
            </SidebarGroup>
            <AgentAvatarRail
              agents={agents}
              activeAgentId={activeAgentConsole?.id ?? null}
              onOpenAgentConsole={(agentId) => onOpenAgentConsole?.(agentId)}
            />
          </SidebarContent>

          <Dialog
            open={!!agentSessionRename}
            onOpenChange={(open) => {
              if (!open) {
                setAgentSessionRename(null);
                setAgentSessionRenameDraft("");
              }
            }}
          >
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
                  value={agentSessionRenameDraft}
                  onChange={(e) => setAgentSessionRenameDraft(e.target.value)}
                  placeholder="Session name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && agentSessionRename && agentSessionRenameDraft.trim() && onRenameChat) {
                      onRenameChat(agentSessionRename.id, agentSessionRenameDraft.trim());
                      setAgentSessionRename(null);
                      setAgentSessionRenameDraft("");
                    }
                    if (e.key === "Escape") {
                      setAgentSessionRename(null);
                      setAgentSessionRenameDraft("");
                    }
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAgentSessionRename(null);
                      setAgentSessionRenameDraft("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={!agentSessionRenameDraft.trim()}
                    onClick={() => {
                      if (agentSessionRename && onRenameChat) {
                        onRenameChat(agentSessionRename.id, agentSessionRenameDraft.trim());
                      }
                      setAgentSessionRename(null);
                      setAgentSessionRenameDraft("");
                    }}
                  >
                    Rename
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      ) : view !== "settings" ? (
        activeTab === "agent" ? (
          <div key="agent" className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-left-3 duration-300">
            <SidebarHeader>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={onOpenDashboard} tooltip="Dashboard">
                    <LayoutDashboard />
                    <span className="hidden-xs">Dashboard</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
              <NavAgents
                agents={agents}
                sessions={sessions}
                activeSessionId={activeSessionId}
                onOpenAgentConsole={(agentId) => onOpenAgentConsole?.(agentId)}
                onStartAgentSession={(agentId) => onStartAgentSession?.(agentId)}
                onSelectSession={onSelectSession}
                onDeleteSession={onDeleteChat}
                onRenameSession={onRenameChat}
                onDeleteAgent={(id) => onDeleteAgent?.(id)}
                onOpenAgentSettings={(id) => onOpenAgentSettings?.(id)}
                runningIds={runningIds}
              />
            </SidebarContent>
          </div>
        ) : (
        <div key="chat" className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-left-3 duration-300">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onNewChat} tooltip="New Chat">
                  <CircleFadingPlus />
                  <span className="hidden-xs">New Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => onProjects?.()} tooltip="Projects">
                  <ChartColumnBig />
                  <span>Projects</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => onHistory?.()} tooltip="History">
                  <GalleryVerticalEnd />
                  <span>History</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <NavChats
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={onDeleteChat}
              onRename={onRenameChat}
              onSwitchToAgent={onSwitchToAgent}
              projects={projects}
              label="Recent"
              runningIds={runningIds}
            />
          </SidebarContent>
        </div>
        )
      ) : (
        <div key="settings" className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-left-3 duration-300">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onExitSettings} tooltip="Back to chat">
                  <ArrowLeft />
                  <span>Back to chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Settings</SidebarGroupLabel>
              <SidebarMenu>
                {SETTINGS_TABS.map(([key, label, icon]) => (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton
                      isActive={settingsTab === key}
                      onClick={() => onSettingsTabChange?.(key)}
                      tooltip={label}
                    >
                      {icon}
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </div>
      )}

      {view !== "settings" && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onSettings} tooltip="Settings">
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}

      <SidebarRail />
    </Sidebar>
  )
}
