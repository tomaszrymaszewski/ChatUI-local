import {
  MoreHorizontal,
  Pencil,
  Share,
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
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import type { ChatSession, Project } from "@/types"

export function NavChats({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  projects = [],
  label = "Recents",
}: {
  sessions: ChatSession[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  projects?: Project[]
  label?: string
}) {
  const { isMobile } = useSidebar()

  const projectNameFor = (projectId?: string) =>
    projects.find((p) => p.id === projectId)?.name

  const initialsFor = (name: string) =>
    name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3)

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
                {projectName && (
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
                  className="w-48 rounded-lg"
                  side={isMobile ? "bottom" : "right"}
                  align={isMobile ? "end" : "start"}
                >
                  <DropdownMenuItem>
                    <Pencil className="text-muted-foreground" />
                    <span>Rename</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Share className="text-muted-foreground" />
                    <span>Share Chat</span>
                  </DropdownMenuItem>
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
    </SidebarGroup>
  )
}
