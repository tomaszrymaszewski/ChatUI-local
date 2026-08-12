import * as React from "react"
import {
  Bot,
  MessageCircle,
  CircleFadingPlus,
  GalleryVerticalEnd,
  ChartColumnBig,
  BotMessageSquare,
  Settings,
  Sparkles,
  Plug,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { NavChats } from "@/components/nav-chats"
import { NavAgentProjects } from "@/components/nav-agent-projects"
import { SkillsDialog } from "@/components/skills-dialog"
import { McpDialog } from "@/components/mcp-dialog"
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
import { useOpencodeContext } from "@/lib/opencode-context"

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
  onRenameChat,
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
  onRenameChat?: (id: string, title: string) => void
  onSettings?: () => void
  onProjects?: () => void
  onHistory?: () => void
  onComingSoon?: (feature: string) => void
  projects?: Project[]
}) {

  const oc = useOpencodeContext();
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);

  const startDrag = (e: React.MouseEvent) => {
    if (e.button === 0) getCurrentWindow().startDragging();
  };

  const handleNewAgent = () => {
    if (!oc.serving) {
      toast("OpenCode server is not running");
      return;
    }
    oc.selectSession(null);
    oc.clearPendingDir();
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
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setSkillsOpen(true)} tooltip="Skills">
                <Sparkles />
                <span>Skills</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleNewAgent} tooltip="New Session">
                <BotMessageSquare />
                <span>New Session</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => onProjects?.()} tooltip="Projects">
                <ChartColumnBig />
                <span>Projects</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setMcpOpen(true)} tooltip="App Connections">
                <Plug />
                <span>Connections</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setSkillsOpen(true)} tooltip="Skills">
                <Sparkles />
                <span>Skills</span>
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
            onRename={onRenameChat}
            projects={projects}
            label="Recent"
          />
        ) : (
          <NavAgentProjects
            projects={projects ?? []}
            sessions={oc.sessions}
            activeSessionId={oc.activeSessionId}
            onSelectSession={(id) => oc.selectSession(id)}
            onDeleteSession={(id) => oc.deleteSession(id)}
            onRenameSession={(id, title) => oc.renameSession(id, title)}
          />
        )}
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
      <SidebarRail />
      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        activeDirectory={oc.activeDirectory}
      />
      <McpDialog
        open={mcpOpen}
        onOpenChange={setMcpOpen}
        serving={oc.serving}
        activeDirectory={oc.activeDirectory}
      />
    </Sidebar>
  )
}
