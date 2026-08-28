import * as React from "react"
import {
  CircleFadingPlus,
  GalleryVerticalEnd,
  ChartColumnBig,
  Settings,
  Sparkles,
} from "lucide-react"
import { useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { NavChats } from "@/components/nav-chats"
import { SkillsDialog } from "@/components/skills-dialog"
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
import { useOpencodeContext } from "@/lib/opencode-context"

export function AppSidebar({
  sessions,
  activeSessionId,
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
  activeSessionId: string | null
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

  const startDrag = (e: React.MouseEvent) => {
    if (e.button === 0) getCurrentWindow().startDragging();
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <div data-tauri-drag-region onMouseDown={startDrag} className="h-10 w-full shrink-0" />
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
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setSkillsOpen(true)} tooltip="Skills">
              <Sparkles />
              <span>Skills</span>
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
      <SidebarRail />
      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        activeDirectory={oc.activeDirectory}
      />
    </Sidebar>
  )
}
