import * as React from "react"
import {
  Bot,
  MessageCircle,
  CircleFadingPlus,
  GalleryVerticalEnd,
  ChartColumnBig,
  Wrench,
  BotMessageSquare,
  Rocket,
} from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { NavChats } from "@/components/nav-chats"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { ChatSession, Project } from "@/types"
import {Tabs, TabsList, TabsTrigger} from "@/components/ui/tabs.tsx";



type Tab = "chat" | "agent";

export function AppSidebar({
  sessions,
  agentSessions,
  activeSessionId,
  activeTab,
  onTabChange,
  onSelectSession,
  onNewChat,
  onDeleteChat,
  onSettings,
  onProjects,
  onHistory,
  onComingSoon,
  projects,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  sessions: ChatSession[]
  agentSessions: ChatSession[]
  activeSessionId: string | null
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  onSelectSession: (id: string) => void
  onNewChat: () => void
  onDeleteChat: (id: string) => void
  onSettings?: () => void
  onProjects?: () => void
  onHistory?: () => void
  onComingSoon?: (feature: string) => void
  projects?: Project[]
}) {

  const startDrag = (e: React.MouseEvent) => {
    if (e.button === 0) getCurrentWindow().startDragging();
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <div data-tauri-drag-region onMouseDown={startDrag} className="h-10 w-full shrink-0" />
      <SidebarHeader>
        <Tabs
          value={activeTab}
          onValueChange={(value) => onTabChange(value as Tab)}
          className="w-full group-data-[collapsible=icon]:hidden"
        >
          <TabsList className="w-full">
            <TabsTrigger value="chat">
              <MessageCircle />
              Chat
            </TabsTrigger>
            <TabsTrigger value="agent">
              <Bot />
              Agent
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {activeTab === "chat" ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onNewChat} tooltip="New Chat">
                <CircleFadingPlus />
                <span>New Chat</span>
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
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onNewChat} tooltip="New Agent">
                <BotMessageSquare />
                <span>New Agent</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => onComingSoon?.("Tools")} tooltip="Tools">
                <Wrench />
                <span>Tools</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => onComingSoon?.("Deployments")} tooltip="Deployments">
                <Rocket />
                <span>Deployments</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>

      <SidebarContent>
        {activeTab === "chat" ? (
          <NavChats
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={onSelectSession}
            onDelete={onDeleteChat}
            projects={projects}
            label="Recent"
          />
        ) : (
          <NavChats
            sessions={agentSessions}
            activeSessionId={activeSessionId}
            onSelect={onSelectSession}
            onDelete={onDeleteChat}
            projects={projects}
            label="Recent"
          />
        )}
      </SidebarContent>

      <SidebarFooter>
        <NavUser onSettings={onSettings} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
