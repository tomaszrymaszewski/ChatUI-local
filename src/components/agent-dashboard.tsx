import { useMemo, useRef, useState } from "react";
import { ArrowUp, Check, FileText, MessageCircle, Plus, X } from "lucide-react";
import type { AgentDefinition, ChatSession, MessageAttachment } from "@/types";
import {
  NEW_AGENT_SUGGESTIONS,
  sessionSuggestionsFor,
} from "@/lib/agent-suggestions";
import { AgentAvatar } from "@/components/agent-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Composer modes: the two ways to start something from the dashboard. */
export type DashboardComposeMode = "agent" | "session";

function formatWhen(date: Date) {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * The Agents tab's default view — a small mission control: every saved agent
 * with its recent sessions, and a composer pinned to the bottom that starts
 * a new-agent setup or a session with an explicitly picked agent. Focusing
 * the composer opens a search-style suggestion dropdown attached above it:
 * agent descriptions in "New Agent" mode, the picked agent's personalized
 * prompts in session mode, or the agent picker when none is chosen yet.
 */
export function AgentDashboard({
  agents,
  sessions,
  runningIds,
  sendOnEnter,
  modelSelect,
  onOpenAgentConsole,
  onSelectSession,
  onSend,
  files = [],
  onRemoveFile,
  promptSuggestions,
  agentSuggestions,
}: {
  agents: AgentDefinition[];
  /** Agent-tab sessions, newest first. */
  sessions: ChatSession[];
  runningIds?: Set<string>;
  sendOnEnter: boolean;
  /** Composer model picker (sessions and new agents run on the composer's model). */
  modelSelect: React.ReactNode;
  onOpenAgentConsole: (agentId: string) => void;
  onSelectSession: (id: string) => void;
  onSend: (mode: DashboardComposeMode, agentId: string | undefined, text: string) => void;
  /** Files dropped/attached for the next send (owned by ChatView's composer state). */
  files?: MessageAttachment[];
  onRemoveFile?: (id: string) => void;
  /** Settings toggles — prompt starters and agent recommendations. */
  promptSuggestions: boolean;
  agentSuggestions: boolean;
}) {
  const [mode, setMode] = useState<DashboardComposeMode>(() =>
    agents.length > 0 ? "session" : "agent",
  );
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [focused, setFocused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionsByAgent = useMemo(() => {
    const map = new Map<string, ChatSession[]>();
    for (const session of sessions) {
      if (!session.agentId) continue;
      const list = map.get(session.agentId) ?? [];
      list.push(session);
      map.set(session.agentId, list);
    }
    return map;
  }, [sessions]);

  const runningCountFor = (agentId: string) =>
    (sessionsByAgent.get(agentId) ?? []).filter((s) => runningIds?.has(s.id)).length;

  // Session mode requires an explicit pick — no silent default. The most
  // recently used agent is only a *suggested* badge in the picker (gated by
  // the agent-suggestions setting).
  const selectedAgent = agents.find((a) => a.id === pickedAgentId) ?? null;

  const suggestedAgentId = useMemo(() => {
    if (!agentSuggestions) return null;
    return (
      sessions.find((s) => s.agentId && agents.some((a) => a.id === s.agentId))
        ?.agentId ?? null
    );
  }, [sessions, agents, agentSuggestions]);

  // Agent order for the picker: most recently used first when agent
  // suggestions are on (so the suggestion is one click away), alphabetical
  // otherwise.
  const orderedAgents = useMemo(() => {
    if (!agentSuggestions) {
      return [...agents].sort((a, b) => a.name.localeCompare(b.name));
    }
    const recentFirst: string[] = [];
    for (const s of sessions) {
      if (s.agentId && !recentFirst.includes(s.agentId)) recentFirst.push(s.agentId);
    }
    const rank = (id: string) => {
      const i = recentFirst.indexOf(id);
      return i === -1 ? recentFirst.length : i;
    };
    return [...agents].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  }, [agents, sessions, agentSuggestions]);

  // Personalized prompt starters for the picked agent (recent session titles
  // with it first). Empty until an agent is chosen.
  const promptList = useMemo(() => {
    if (!promptSuggestions) return [];
    if (mode === "agent") return NEW_AGENT_SUGGESTIONS;
    return selectedAgent ? sessionSuggestionsFor(selectedAgent, sessions) : [];
  }, [mode, promptSuggestions, selectedAgent, sessions]);

  const showAgentList = mode === "session" && !selectedAgent;
  // Suggestions open at the top of the dashboard while the composer is
  // active; the sections below fade until it closes.
  const suggestionsOpen =
    (focused || pickerOpen) &&
    (showAgentList || promptList.length > 0);

  const pickAgent = (id: string) => {
    setPickedAgentId(id);
    textareaRef.current?.focus();
  };

  const canSend =
    (inputText.trim().length > 0 || files.length > 0) &&
    (mode !== "session" || !!selectedAgent);

  const send = () => {
    const text = inputText.trim();
    if (!canSend) return;
    setInputText("");
    onSend(mode, mode === "session" ? selectedAgent!.id : undefined, text);
  };

  const placeholder =
    mode === "agent"
      ? "Describe what this new agent should do and it will set itself up…"
      : selectedAgent
        ? `Message ${selectedAgent.name}…`
        : "Choose an agent to start a session…";

  const fillPrompt = (s: string) => {
    setInputText(s);
    textareaRef.current?.focus();
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 pb-8">
          <div
            className={cn(
              "transition-opacity duration-300",
              suggestionsOpen && "pointer-events-none opacity-0",
            )}
          >
          {/* ─── Your workers ─── */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Your workers</h2>
              <span className="text-xs text-muted-foreground">
                {agents.length === 0
                  ? "no agents yet"
                  : `${agents.length} agent${agents.length === 1 ? "" : "s"} · ${runningIds?.size ?? 0} running`}
              </span>
            </div>
            {agents.length === 0 ? (
              <button
                type="button"
                onClick={() => {
                  setMode("agent");
                  textareaRef.current?.focus();
                }}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-dashed p-5 text-left transition-colors",
                  "hover:border-foreground/30 hover:bg-muted/50",
                  mode === "agent" && "border-foreground/40 bg-muted/50",
                )}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Plus className="size-5" />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">Create your first agent</span>
                </div>
              </button>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {agents.slice(0, 5).map((agent) => {
                  const agentSessions = sessionsByAgent.get(agent.id) ?? [];
                  const last = agentSessions[0];
                  const running = runningCountFor(agent.id);
                  return (
                    <div
                      key={agent.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenAgentConsole(agent.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenAgentConsole(agent.id);
                        }
                      }}
                      className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/50"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="relative shrink-0">
                          <AgentAvatar seed={agent.id} className="size-9" />
                          {running > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex size-3 items-center justify-center rounded-full bg-emerald-500 text-emerald-50">
                              <Spinner className="size-2" />
                            </span>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-semibold leading-tight">
                            {agent.name}
                          </span>
                          <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                            {agent.purpose || "No purpose set"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-auto flex items-center justify-between pt-1 text-[10px] text-muted-foreground/80">
                        <span>
                          {last
                            ? `Last used ${formatWhen(last.updatedAt)}`
                            : "Never used"}
                        </span>
                        {running > 0 && (
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            {running} running
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Trailing card: start a new agent setup */}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setMode("agent");
                    textareaRef.current?.focus();
                  }}
                  className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-4 text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/50 hover:text-foreground"
                >
                  <Plus className="size-5" />
                  <span className="text-sm font-medium">Add agent</span>
                </button>
              </div>
            )}
          </section>

          {/* ─── Recent sessions ─── */}
          <section className="mt-6 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Recent sessions</h2>
              <span className="text-xs text-muted-foreground">
                {sessions.length === 0
                  ? "nothing yet"
                  : `${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sessions.slice(0, 5).map((session) => {
                  const agent = agents.find((a) => a.id === session.agentId) ?? null;
                  const isRunning = runningIds?.has(session.id) ?? false;
                  return (
                    <div
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectSession(session.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectSession(session.id);
                        }
                      }}
                      className="relative flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 pr-9 transition-colors hover:border-foreground/20 hover:bg-muted/50"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span
                          className="truncate text-sm font-semibold leading-tight"
                          title={session.title}
                        >
                          {session.title}
                        </span>
                        <span className="truncate text-xs leading-snug text-muted-foreground">
                          {agent ? agent.name : "Session"}
                        </span>
                      </div>
                      <div className="mt-auto flex items-center pt-1 text-[10px] text-muted-foreground/80">
                        <span>Updated {formatWhen(session.updatedAt)}</span>
                      </div>
                      {agent && (
                        <div className="absolute bottom-2.5 right-2.5">
                          <AgentAvatar
                            seed={agent.id}
                            className="size-5"
                            title={agent.name}
                          />
                          {isRunning && (
                            <span className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-emerald-500 text-emerald-50">
                              <Spinner className="size-2" />
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Trailing card: start a new agent session */}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setMode("session");
                    textareaRef.current?.focus();
                  }}
                  className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-4 text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/50 hover:text-foreground"
                >
                  <Plus className="size-5" />
                  <span className="text-sm font-medium">New session</span>
                </button>
              </div>
          </section>
          </div>
        </div>
      </ScrollArea>

      {/* ─── Composer — pinned to the bottom ─── */}
      <div className="relative shrink-0">
        <div className="mx-auto w-full max-w-5xl px-4 pb-4">
          {/* ─── Suggestions — search-style panel right above the textbox ─── */}
          {suggestionsOpen && (
            <div className="mb-2 animate-in fade-in slide-in-from-bottom-2 overflow-hidden rounded-xl border bg-card shadow-lg duration-200">
              <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                {showAgentList ? (
                  <>
                    <span className="text-xs font-medium">Choose an agent</span>
                    <span className="text-xs text-muted-foreground">
                      {agentSuggestions && suggestedAgentId
                        ? "most recent first"
                        : `${agents.length} agent${agents.length === 1 ? "" : "s"}`}
                    </span>
                  </>
                ) : (
                  <>
                    {mode === "session" && selectedAgent && (
                      <AgentAvatar seed={selectedAgent.id} className="size-4 shrink-0" />
                    )}
                    <span className="text-xs font-medium">
                      {mode === "agent"
                        ? "Describe your new agent"
                        : selectedAgent
                          ? `Prompts for ${selectedAgent.name}`
                          : "Start with a prompt"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      pick one to fill the composer
                    </span>
                  </>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto pb-1">
                {showAgentList ? (
                  agents.length === 0 ? (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setMode("agent")}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60"
                    >
                      <Plus className="size-4 shrink-0 text-muted-foreground" />
                      <span>No agents yet — describe one in New Agent mode</span>
                    </button>
                  ) : (
                    orderedAgents.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickAgent(a.id)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60"
                      >
                        <AgentAvatar seed={a.id} className="size-6 shrink-0" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">{a.name}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {a.purpose || "No purpose set"}
                          </span>
                        </span>
                        {a.id === suggestedAgentId && (
                          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            Suggested
                          </span>
                        )}
                      </button>
                    ))
                  )
                ) : (
                  promptList.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => fillPrompt(s)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60"
                    >
                      {mode === "agent" ? (
                        <Plus className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <MessageCircle className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{s}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
          <InputGroup>
            {files.length > 0 && (
              <InputGroupAddon align="block-start">
                <AttachmentGroup className="w-full">
                  {files.map((file) => (
                    <Attachment key={file.id} size="xs">
                      <AttachmentMedia variant={file.previewUrl ? "image" : "icon"}>
                        {file.previewUrl ? (
                          <img src={file.previewUrl} alt={file.name} />
                        ) : (
                          <FileText />
                        )}
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>{file.name}</AttachmentTitle>
                        <AttachmentDescription>{formatBytes(file.size)}</AttachmentDescription>
                      </AttachmentContent>
                      <AttachmentActions>
                        <AttachmentAction
                          aria-label={`Remove ${file.name}`}
                          onClick={() => onRemoveFile?.(file.id)}
                        >
                          <X />
                        </AttachmentAction>
                      </AttachmentActions>
                    </Attachment>
                  ))}
                </AttachmentGroup>
              </InputGroupAddon>
            )}
            <InputGroupTextarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.currentTarget.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={placeholder}
              className="max-h-40 min-h-12"
            />
            <InputGroupAddon align="block-end">
              {/* Mode switch — bottom left */}
              <div className="flex items-center gap-0.5 rounded-full border p-0.5">
                {(
                  [
                    { key: "agent", label: "New Agent" },
                    { key: "session", label: "New Agent Session" },
                  ] as Array<{ key: DashboardComposeMode; label: string }>
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                      mode === key
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Agent picker — session mode always shows it: a session needs an explicit pick */}
              {mode === "session" && (
                <DropdownMenu onOpenChange={setPickerOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "group flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                        !selectedAgent && "border-dashed text-muted-foreground",
                      )}
                      title={
                        selectedAgent
                          ? `${selectedAgent.name} — ${selectedAgent.purpose || "no purpose set"}`
                          : "Choose an agent for this session"
                      }
                    >
                      {selectedAgent ? (
                        <>
                          <AgentAvatar seed={selectedAgent.id} className="size-4 shrink-0" />
                          <span className="max-w-36 truncate">{selectedAgent.name}</span>
                        </>
                      ) : (
                        <span>Choose agent</span>
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                    {orderedAgents.map((a) => (
                      <DropdownMenuItem
                        key={a.id}
                        onClick={() => pickAgent(a.id)}
                        className={cn(a.id === selectedAgent?.id && "bg-accent")}
                      >
                        <AgentAvatar seed={a.id} className="size-4" />
                        <span className="min-w-0 flex-col">
                          <span className="max-w-48 truncate text-sm">{a.name}</span>
                        </span>
                        {a.id === suggestedAgentId && (
                          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            Suggested
                          </span>
                        )}
                        {a.id === selectedAgent?.id && <Check className="size-3.5" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <div className="flex-1" />

              {mode === "session" && selectedAgent?.model ? (
                  <span
                      className="px-1.5 py-1 text-xs text-muted-foreground"
                      title={`This agent always runs on ${selectedAgent.model}`}
                  >
                  {selectedAgent.model}
                </span>
              ) : (
                  modelSelect
              )}
              <InputGroupButton
                variant="default"
                size="icon-xs"
                className="rounded-lg"
                onClick={send}
                disabled={!canSend}
                aria-label="Send message"
              >
                <ArrowUp />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>
    </div>
  );
}
