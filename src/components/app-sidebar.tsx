import * as React from "react"
import {
  ArrowLeft,
  ArrowDownToLine,
  Bot,
  Brain,
  ChartColumnBig,
  CircleFadingPlus,
  Cpu,
  GalleryVerticalEnd,
  MessageSquare,
  Plug,
  Settings,
  Sparkles,
  SquareTerminal,
  User,
} from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { isMacOS } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { NavChats } from "@/components/nav-chats"
import { NavAgents } from "@/components/nav-agents"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import type { AgentDefinition, ChatSession, Project } from "@/types"
import type { SettingsTab } from "@/pages/settings"

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
            {activeTab === "chat" ? <Bot /> : <MessageSquare />}
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
      {tabButton("chat", "Chat", <MessageSquare className="size-3.5" />)}
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
  onNewTask,
  onNewAgent,
  agents = [],
  onStartAgentSession,
  onDeleteAgent,
  projects,
  runningIds,
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
  onNewTask?: () => void
  onNewAgent?: () => void
  agents?: AgentDefinition[]
  onStartAgentSession?: (agentId: string) => void
  onDeleteAgent?: (id: string) => void
  projects?: Project[]
  runningIds?: Set<string>
}) {

  const startDrag = (e: React.MouseEvent) => {
    if (e.button === 0) getCurrentWindow().startDragging();
  };

  return (
      <Sidebar collapsible="icon" {...props}>
        {isMacOS && <div data-tauri-drag-region onMouseDown={startDrag} className="h-10 w-full shrink-0" />}

      {view !== "settings" && (
        <ModeSwitcher
          activeTab={activeTab}
          onTabChange={onTabChange ?? (() => {})}
        />
      )}

      {view !== "settings" ? (
        activeTab === "agent" ? (
          <div key="agent" className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-left-3 duration-300">
            <SidebarHeader>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={onNewTask} tooltip="New Task — standalone task for the manager agent">
                    <SquareTerminal />
                    <span className="hidden-xs">New Task</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={onNewAgent} tooltip="New Agent — set up a saved agent">
                    <Bot />
                    <span className="hidden-xs">New Agent</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
              <NavAgents
                agents={agents}
                sessions={sessions}
                activeSessionId={activeSessionId}
                onStartAgentSession={(agentId) => onStartAgentSession?.(agentId)}
                onSelectSession={onSelectSession}
                onDeleteSession={onDeleteChat}
                onRenameSession={onRenameChat}
                onDeleteAgent={(id) => onDeleteAgent?.(id)}
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
