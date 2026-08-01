import * as React from "react"
import {
  BookOpen,
  Bot,
  MessageSquare,
  CircleFadingPlus,
  Settings2,
  SquareTerminal,
  GalleryVerticalEnd,
  ChartColumnBig,
  Wrench,
  BotMessageSquare,
  Rocket,
} from "lucide-react"

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
import type { ChatSession } from "@/types"
import {Tabs, TabsList, TabsTrigger} from "@/components/ui/tabs.tsx";
import {useState} from "react";

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "",
  },
  navMain: [
    {
      title: "Playground",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        { title: "History", url: "#" },
        { title: "Starred", url: "#" },
        { title: "Settings", url: "#" },
      ],
    },
    {
      title: "Documentation",
      url: "#",
      icon: BookOpen,
      items: [
        { title: "Introduction", url: "#" },
        { title: "Get Started", url: "#" },
        { title: "Tutorials", url: "#" },
        { title: "Changelog", url: "#" },
      ],
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings2,
      items: [
        { title: "General", url: "#" },
        { title: "Team", url: "#" },
        { title: "Billing", url: "#" },
        { title: "Limits", url: "#" },
      ],
    },
  ],
}

type Tab = "chat" | "agent";

export function AppSidebar({
  sessions,
  agentSessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteChat,
  onSettings,
  onComingSoon,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  sessions: ChatSession[]
  agentSessions: ChatSession[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewChat: () => void
  onDeleteChat: (id: string) => void
  onSettings?: () => void
  onComingSoon?: (feature: string) => void
}) {

  const [activeTab, setActiveTab] = useState<Tab>("chat");

  return (
    <Sidebar collapsible="icon" {...props}>
      <div data-tauri-drag-region className="h-10 w-full shrink-0" />
      <SidebarHeader>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as Tab)}
          className="w-full group-data-[collapsible=icon]:hidden"
        >
          <TabsList className="w-full">
            <TabsTrigger value="chat">
              <MessageSquare />
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
              <SidebarMenuButton onClick={() => onComingSoon?.("Projects")} tooltip="Projects">
                <ChartColumnBig />
                <span>Projects</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => onComingSoon?.("History")} tooltip="History">
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
            label="Your Chats"
          />
        ) : (
          <NavChats
            sessions={agentSessions}
            activeSessionId={activeSessionId}
            onSelect={onSelectSession}
            onDelete={onDeleteChat}
            label="Your Agents"
          />
        )}
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={data.user} onSettings={onSettings} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
