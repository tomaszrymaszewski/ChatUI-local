import * as React from "react"
import {
  ArrowLeft,
  ArrowDownToLine,
  Brain,
  ChartColumnBig,
  CircleFadingPlus,
  Cpu,
  GalleryVerticalEnd,
  Plug,
  Settings,
  Sparkles,
  User,
} from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { NavChats } from "@/components/nav-chats"
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
} from "@/components/ui/sidebar"
import type { ChatSession, Project } from "@/types"
import type { SettingsTab } from "@/pages/settings"

const SETTINGS_TABS: Array<[SettingsTab, string, React.ReactNode]> = [
  ["general", "General", <User className="size-4" />],
  ["memory", "Memory", <Brain className="size-4" />],
  ["models", "Models & Providers", <Cpu className="size-4" />],
  ["skills", "Skills", <Sparkles className="size-4" />],
  ["connectors", "Connectors", <Plug className="size-4" />],
  ["updates", "Updates", <ArrowDownToLine className="size-4" />],
]

export function AppSidebar({
  sessions,
  activeSessionId,
  view = "chat",
  settingsTab = "general",
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
  projects,
  runningIds,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  sessions: ChatSession[]
  activeSessionId: string | null
  view?: "chat" | "settings" | "projects" | "history"
  settingsTab?: SettingsTab
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
  projects?: Project[]
  runningIds?: Set<string>
}) {

  const startDrag = (e: React.MouseEvent) => {
    if (e.button === 0) getCurrentWindow().startDragging();
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <div data-tauri-drag-region onMouseDown={startDrag} className="h-10 w-full shrink-0" />

      {view !== "settings" ? (
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
        </div>
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

      <SidebarRail />
    </Sidebar>
  )
}
