import * as React from "react"
import {
  ArrowLeft,
  ArrowDownToLine,
  Bot,
  Brain,
  CalendarClock,
  ChartColumnBig,
  CircleFadingPlus,
  CloudUpload,
  Cpu,
  GalleryVerticalEnd,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  UserRound,
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { avatarColorStyle, profileInitials, sidebarAccountLabel } from "@/lib/account-profile"
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
import { ACCOUNT_TABS, type AccountTab } from "@/pages/account"
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
  accountTab = "profile",
  activeTab = "chat",
  onSelectSession,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onMoveSessionToAgent,
  onSettings,
  onSettingsTabChange,
  onExitSettings,
  onProjects,
  onHistory,
  onComingSoon,
  onTabChange,
  onOpenDashboard,
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
  accountEmail = null,
  accountName = null,
  accountAvatarUrl = null,
  onOpenAccount,
  onConnectAccount,
  onAccountTabChange,
  onSignOut,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  sessions: ChatSession[]
  activeSessionId: string | null
  view?: "chat" | "settings" | "account" | "projects" | "history"
  settingsTab?: SettingsTab
  accountTab?: AccountTab
  activeTab?: "chat" | "agent"
  onSelectSession: (id: string) => void
  onNewChat: () => void
  onDeleteChat: (id: string) => void
  onRenameChat?: (id: string, title: string) => void
  onMoveSessionToAgent?: (sessionId: string, agentId: string | null) => void
  onSettings?: () => void
  onSettingsTabChange?: (tab: SettingsTab) => void
  onExitSettings?: () => void
  onProjects?: () => void
  onHistory?: () => void
  onComingSoon?: (feature: string) => void
  onTabChange?: (tab: "chat" | "agent") => void
  onOpenDashboard?: () => void
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
  /** Signed-in account email, or null for anonymous mode. */
  accountEmail?: string | null
  /** Display name for the signed-in account footer. */
  accountName?: string | null
  /** Avatar URL for the signed-in account footer. */
  accountAvatarUrl?: string | null
  /** Open the account settings page. */
  onOpenAccount?: () => void
  /** Open the connect-account dialog (signed-out settings footer). */
  onConnectAccount?: () => void
  /** Switch the account view's tab. */
  onAccountTabChange?: (tab: AccountTab) => void
  /** Sign out of the connected account. */
  onSignOut?: () => void
}) {

  const { isMobile } = useSidebar()
  /** Settings + account views share the sidebar chrome, only the tabs differ. */
  const inPrefsView = view === "settings" || view === "account"

  // Rename dialog state for the agent-console session list.
  const [agentSessionRename, setAgentSessionRename] = React.useState<{ id: string; title: string } | null>(null)
  const [agentSessionRenameDraft, setAgentSessionRenameDraft] = React.useState("")
  const [privacyOpen, setPrivacyOpen] = React.useState(false)

  const startDrag = (e: React.MouseEvent) => {
    if (e.button === 0) getCurrentWindow().startDragging();
  };

  return (
      <Sidebar collapsible="icon" {...props}>
        {isMacOS && <div data-tauri-drag-region onMouseDown={startDrag} className="h-10 w-full shrink-0" />}

      {!inPrefsView && !activeAgentConsole && (
        <ModeSwitcher
          activeTab={activeTab}
          onTabChange={onTabChange ?? (() => {})}
        />
      )}

      {!inPrefsView && activeAgentConsole ? (
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
      ) : !inPrefsView ? (
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
                onMoveSessionToAgent={onMoveSessionToAgent}
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
              projects={projects}
              label="Recent"
              runningIds={runningIds}
            />
          </SidebarContent>
        </div>
        )
      ) : (
        <div key={view} className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-left-3 duration-300">
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
              <SidebarGroupLabel>{view === "account" ? "Account" : "Settings"}</SidebarGroupLabel>
              <SidebarMenu>
                {view === "account"
                  ? ACCOUNT_TABS.map((t) => (
                      <SidebarMenuItem key={t.id}>
                        <SidebarMenuButton
                          isActive={accountTab === t.id}
                          onClick={() => onAccountTabChange?.(t.id)}
                          tooltip={t.label}
                        >
                          <t.icon className="size-4" />
                          <span>{t.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))
                  : SETTINGS_TABS.map(([key, label, icon]) => (
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

      {!inPrefsView ? (
        <SidebarFooter>
          <SidebarMenu>
            {accountEmail ? (
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton size="lg" tooltip={accountEmail}>
                      <Avatar size="sm">
                        {accountAvatarUrl && (
                          <AvatarImage
                            src={accountAvatarUrl}
                            alt={accountName ?? accountEmail}
                          />
                        )}
                        <AvatarFallback style={avatarColorStyle(accountEmail)}>
                          {profileInitials(accountName ?? "", accountEmail)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">
                        {sidebarAccountLabel({
                          email: accountEmail,
                          name: accountName ?? accountEmail,
                          avatarUrl: accountAvatarUrl,
                        })}
                      </span>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-56 rounded-lg"
                    side={isMobile ? "bottom" : "top"}
                    align={isMobile ? "end" : "start"}
                  >
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <Avatar size="sm">
                        {accountAvatarUrl && (
                          <AvatarImage
                            src={accountAvatarUrl}
                            alt={accountName ?? accountEmail}
                          />
                        )}
                        <AvatarFallback style={avatarColorStyle(accountEmail)}>
                          {profileInitials(accountName ?? "", accountEmail)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col">
                        {accountName && (
                          <span className="truncate text-sm font-medium">{accountName}</span>
                        )}
                        <span className="truncate text-xs text-muted-foreground">
                          {accountEmail}
                        </span>
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onSettings}>
                      <Settings />
                      <span>App settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onOpenAccount}>
                      <UserRound />
                      <span>Account</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPrivacyOpen(true)}>
                      <ShieldCheck />
                      <span>Privacy &amp; terms</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={onSignOut}>
                      <LogOut />
                      <span>Sign out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            ) : (
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onSettings} tooltip="Settings">
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarFooter>
      ) : view === "settings" && !accountEmail ? (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={onConnectAccount}
                tooltip="Connect account"
              >
                <CloudUpload />
                <span className="truncate">Connect account</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : null}

      <PrivacyTermsDialog open={privacyOpen} onOpenChange={setPrivacyOpen} />

      <SidebarRail />
    </Sidebar>
  )
}

/** What the app stores, where it goes, and on what terms — no legalese. */
function PrivacyTermsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            Privacy &amp; terms
          </DialogTitle>
          <DialogDescription>
            The short version of how your data is handled.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm leading-relaxed">
          <p>
            <span className="font-medium">Local-first.</span> Your chats, agents,
            projects, and settings live on this device. The app works fully
            offline and anonymous — no account needed.
          </p>
          <p>
            <span className="font-medium">Sync.</span> When you sign in, those
            same items are mirrored to your account&apos;s cloud database so
            your devices merge instead of overwriting each other. A copy always
            stays on this device, and signing out never deletes it.
          </p>
          <p>
            <span className="font-medium">Keys.</span> Provider API keys live
            in this app&apos;s storage (mirrored with the rest of your data
            while signed in) and are never committed to source code. Message
            text is sent to whichever AI provider you chose when you send it.
          </p>
          <p>
            <span className="font-medium">Deletion.</span> Account settings
            lets you erase your synced data and everything on this device at
            any time. That action can&apos;t be undone.
          </p>
          <p className="text-xs text-muted-foreground">
            The app is provided as-is for personal use. If a provider or sync
            endpoint changes its terms, that provider&apos;s terms apply to the
            data you send it.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
