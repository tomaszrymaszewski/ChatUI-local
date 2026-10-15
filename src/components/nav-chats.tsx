import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronRight,
  ListFilter,
  Pencil,
  Trash2,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { loadMessages } from "@/hooks/use-messages"
import type { ChatSession, Project } from "@/types"
import { Spinner } from "@/components/ui/spinner"

type SortMode = "activity" | "created" | "alphabetical"

const SORT_STORAGE_KEY = "chatui:recent-sort"
const GROUP_STORAGE_KEY = "chatui:recent-group-by-date"
const DELETE_CONFIRMATION_STORAGE_KEY = "chatui:skip-delete-confirmation"

function getInitialSkipDeleteConfirmation(): boolean {
  try {
    return localStorage.getItem(DELETE_CONFIRMATION_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

function getInitialSortMode(): SortMode {
  try {
    const value = localStorage.getItem(SORT_STORAGE_KEY)
    if (value === "created" || value === "alphabetical") return value
  } catch {
    // Keep the default in environments without local storage.
  }
  return "activity"
}

function getInitialGroupByDate(): boolean {
  try {
    return localStorage.getItem(GROUP_STORAGE_KEY) !== "false"
  } catch {
    return true
  }
}

function dateGroupFor(date: Date): { key: string; label: string } {
  const day = new Date(date.getTime())
  day.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000)

  if (daysAgo === 0) return { key: day.toISOString(), label: "Today" }
  if (daysAgo === 1) return { key: day.toISOString(), label: "Yesterday" }

  return {
    key: day.toISOString(),
    label: day.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(day.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
    }),
  }
}

function ConversationTitle({ title }: { title: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)
  const [revealing, setRevealing] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const text = titleRef.current
    if (!container || !text) return

    const measure = () => setOverflow(Math.max(0, text.scrollWidth - container.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [title])

  const revealTitle = () => {
    const container = containerRef.current
    const text = titleRef.current
    if (!container || !text) return
    const distance = Math.max(0, text.scrollWidth - container.clientWidth)
    setOverflow(distance)
    setRevealing(distance > 0)
  }

  return (
    <div
      ref={containerRef}
      className="relative min-w-0 flex-1 overflow-hidden"
      style={{
        maskImage: overflow > 0 && !revealing
          ? "linear-gradient(to right, black calc(100% - 14px), transparent)"
          : undefined,
      }}
      onMouseEnter={revealTitle}
      onMouseLeave={() => setRevealing(false)}
    >
      <span
        ref={titleRef}
        className="inline-block whitespace-nowrap"
        style={{
          transform: revealing ? `translateX(-${overflow}px)` : "translateX(0)",
          transition: `transform ${revealing ? "5s" : "200ms"} ease-in-out`,
        }}
      >
        {title}
      </span>
    </div>
  )
}

export function NavChats({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onRename,
  projects = [],
  label = "Recents",
  runningIds,
}: {
  sessions: ChatSession[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename?: (id: string, title: string) => void
  projects?: Project[]
  label?: string
  runningIds?: Set<string>
}) {
  const { isMobile } = useSidebar()
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSortMode)
  const [groupByDate, setGroupByDate] = useState(getInitialGroupByDate)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [skipDeleteConfirmation, setSkipDeleteConfirmation] = useState(getInitialSkipDeleteConfirmation)

  const projectNameFor = (projectId?: string) =>
    projects.find((p) => p.id === projectId)?.name

  const initialsFor = (name: string) =>
    name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3)

  const handleStartRename = (id: string, currentTitle: string) => {
    setRenameTarget({ id, title: currentTitle })
    setRenameDraft(currentTitle)
  }

  const handleCommitRename = () => {
    if (!renameTarget) return
    const trimmed = renameDraft.trim()
    if (trimmed && onRename) {
      onRename(renameTarget.id, trimmed)
    }
    setRenameTarget(null)
    setRenameDraft("")
  }

  const requestDelete = (session: ChatSession) => {
    if (skipDeleteConfirmation) {
      onDelete(session.id)
      return
    }
    setDontAskAgain(false)
    setDeleteTarget({ id: session.id, title: session.title })
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    if (dontAskAgain) {
      setSkipDeleteConfirmation(true)
      try {
        localStorage.setItem(DELETE_CONFIRMATION_STORAGE_KEY, "true")
      } catch {
        // Keep the preference for this app session even if storage is unavailable.
      }
    }
    onDelete(deleteTarget.id)
    setDeleteTarget(null)
    setDontAskAgain(false)
  }

  const handleSortChange = (value: string) => {
    if (value !== "activity" && value !== "created" && value !== "alphabetical") return
    setSortMode(value)
    try {
      localStorage.setItem(SORT_STORAGE_KEY, value)
    } catch {
      // The setting still applies for the current session.
    }
  }

  const handleGroupByDateChange = (checked: boolean | "indeterminate") => {
    const next = checked === true
    setGroupByDate(next)
    try {
      localStorage.setItem(GROUP_STORAGE_KEY, String(next))
    } catch {
      // The setting still applies for the current session.
    }
  }

  // Older chats did not store a creation timestamp. When that sort is selected,
  // use the first saved message as the best available creation date.
  const legacyCreatedAtById = useMemo(() => {
    if (sortMode !== "created") return new Map<string, Date>()
    return new Map(sessions.map((session) => {
      if (session.createdAt) return [session.id, session.createdAt] as const
      const firstMessageAt = loadMessages(session.id)
        .map((message) => message.timestamp)
        .filter((timestamp) => Number.isFinite(timestamp.getTime()))
        .sort((a, b) => a.getTime() - b.getTime())[0]
      return [session.id, firstMessageAt ?? session.updatedAt] as const
    }))
  }, [sessions, sortMode])

  const createdAtFor = (session: ChatSession) =>
    session.createdAt ?? legacyCreatedAtById.get(session.id) ?? session.updatedAt

  const sortedSessions = useMemo(() => sessions.filter((session) => !session.isTemporary).sort((a, b) => {
    if (sortMode === "alphabetical") {
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
    }
    const aDate = sortMode === "created" ? createdAtFor(a) : a.updatedAt
    const bDate = sortMode === "created" ? createdAtFor(b) : b.updatedAt
    return bDate.getTime() - aDate.getTime()
  }), [sessions, sortMode])

  const dateGroups = useMemo(() => {
    const groups = new Map<string, { label: string; sessions: ChatSession[] }>()
    for (const session of sortedSessions) {
      const date = sortMode === "created" ? createdAtFor(session) : session.updatedAt
      const group = dateGroupFor(date)
      const existing = groups.get(group.key)
      if (existing) existing.sessions.push(session)
      else groups.set(group.key, { label: group.label, sessions: [session] })
    }
    return [...groups.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.key.localeCompare(a.key))
  }, [sortedSessions, sortMode])

  const renderSession = (session: ChatSession) => {
    const projectName = projectNameFor(session.projectId)
    return (
      <SidebarMenuItem key={session.id} className="group/conversation">
        <SidebarMenuButton
          isActive={session.id === activeSessionId}
          onClick={() => onSelect(session.id)}
          className={session.movedToAgent ? "opacity-50" : undefined}
          tooltip={session.movedToAgent ? "Moved to the Agents tab" : undefined}
        >
          {session.movedToAgent && (
            <Bot className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <ConversationTitle title={session.title} />
          {runningIds?.has(session.id) && (
            <Spinner className="size-3 shrink-0" />
          )}
          {projectName && !runningIds?.has(session.id) && (
            <Badge
              variant="secondary"
              className="-mr-7 ml-auto text-[10px] max-md:opacity-0 md:group-hover/menu-item:opacity-0 md:group-focus-within/menu-item:opacity-0 md:group-has-data-[state=open]/menu-item:opacity-0"
            >
              {initialsFor(projectName)}
            </Badge>
          )}
        </SidebarMenuButton>
        <div className="pointer-events-none absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/conversation:pointer-events-auto group-hover/conversation:opacity-100 group-focus-within/conversation:pointer-events-auto group-focus-within/conversation:opacity-100">
          {onRename && !session.movedToAgent && (
            <button
              type="button"
              aria-label={`Rename ${session.title}`}
              title="Rename chat"
              className="flex size-6 items-center justify-center rounded-sm bg-sidebar/75 text-muted-foreground hover:bg-sidebar hover:text-sidebar-accent-foreground"
              onClick={() => handleStartRename(session.id, session.title)}
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label={`Delete ${session.title}`}
            title="Delete chat"
            className="flex size-6 items-center justify-center rounded-sm bg-sidebar/75 text-red-500 hover:bg-sidebar hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
            onClick={() => requestDelete(session)}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="sticky top-0 z-20 justify-between bg-sidebar px-2">
        <span>{label}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              aria-label="Filter and sort recent chats"
            >
              Sort
              <ListFilter className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-52 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="start"
          >
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortMode} onValueChange={handleSortChange}>
              <DropdownMenuRadioItem value="activity">Last activity</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="created">Date created</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="alphabetical">Alphabetically</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={groupByDate}
              onCheckedChange={handleGroupByDateChange}
            >
              Group by date
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarGroupLabel>

      {groupByDate ? (
        <SidebarMenu>
          {dateGroups.map((group) => (
            <SidebarMenuItem key={group.key}>
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="group/date-trigger flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[11px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                  <ChevronRight className="size-3 shrink-0 transition-transform duration-150 group-data-[state=open]/date-trigger:rotate-90" />
                  <span>{group.label}</span>
                  <span className="ml-auto text-[10px]">{group.sessions.length}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenu className="mt-1">
                    {group.sessions.map(renderSession)}
                  </SidebarMenu>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      ) : (
        <SidebarMenu>{sortedSessions.map(renderSession)}</SidebarMenu>
      )}

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) { setRenameTarget(null); setRenameDraft(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-5" />
              Rename Chat
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <Input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              placeholder="Chat name"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitRename()
                if (e.key === "Escape") { setRenameTarget(null); setRenameDraft("") }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setRenameTarget(null); setRenameDraft("") }}>Cancel</Button>
              <Button size="sm" disabled={!renameDraft.trim()} onClick={handleCommitRename}>Rename</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDontAskAgain(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete “{deleteTarget?.title}”? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="skip-delete-confirmation" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              id="skip-delete-confirmation"
              checked={dontAskAgain}
              onCheckedChange={(checked) => setDontAskAgain(checked === true)}
            />
            Don’t ask me again
          </label>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null)
                setDontAskAgain(false)
              }}
            >
              No
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>Yes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  )
}
