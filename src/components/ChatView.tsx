import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowUp,
  ArrowLeft,
  Bot,
  ChevronDown,
  MessageCircle,
  Paperclip,
  Check,
  ClockFading,
  Copy,
  ChevronRight,
  Image as ImageIcon,
  Microscope,
  MoreHorizontal,
  Pencil,
  Plus,
  SquarePen,
  ScrollText,
  Search,
  FolderPlus,
  FileText,
  Folder,
  FileCode,
  Trash2,
  X,
  RotateCcw,
  ChevronLeft,
  SquareTerminal,
  GraduationCap,
  Menu,
  UsersRound,
  Download,
  File as FileIcon,
  FileSpreadsheet,
  ArrowDownToLine,
  TriangleAlert,
  PackagePlus,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppSidebar, type AgentConsoleTab } from "@/components/app-sidebar";
import { ApprovalCard } from "@/components/approval-card";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentConsole } from "@/components/agent-console";
import { AgentDashboard, type DashboardComposeMode } from "@/components/agent-dashboard";
import { AgentSettingsDialog } from "@/components/agent-settings-dialog";
import { AccountSettings, AccountView, type AccountTab } from "@/pages/account";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { MessageStream } from "@/components/message-stream";
import { SettingsView, type SettingsTab } from "@/pages/settings";
import { PatternBackground } from "@/components/background-pattern";
import { ArtifactPanel } from "@/components/artifact-panel";
import { StructuredInputForm } from "@/components/structured-input-form";
import { SuggestionCard, installSkillByName } from "@/components/suggestion-card";
import { type Artifact } from "@/lib/artifacts";
import { downloadSharedFile } from "@/lib/local-file";
import { mergeSessionFiles } from "@/lib/shared-files";
import { checkForUpdate, loadUpdateSettings, isUpdaterAvailable } from "@/lib/updater";
import { detectModeTrigger } from "@/lib/mode-triggers";
import { followUpSuggestion } from "@/lib/agent-suggestions";
import { modelLabel, modelLabelWithCatalog } from "@/lib/model-display";
import { ProviderLogo } from "@/components/provider-logos";
import { getProviderMeta } from "@/lib/provider-meta";
import { OpenCodeProvider } from "@/lib/opencode-context";
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
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import type {
  Message as ChatMessage,
  MessageAttachment,
  AgentConfigPatch,
  AgentDefinition,
  Provider,
  ReasoningEffort,
} from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { getAccountProfile } from "@/lib/account-profile";
import { useSessions, getSessionChatMode, getSessionTemporary, agentSessionIds, deleteStoredSessions } from "@/hooks/use-sessions";
import { useMessages, loadMessages } from "@/hooks/use-messages";
import { findActiveRunMessage, isRunRecordActive } from "@/lib/run-state";
import { useProjects } from "@/hooks/use-projects";
import { useProviders } from "@/hooks/use-providers";
import { useUserSettings } from "@/hooks/use-user-settings";
import { scheduleKnowledgeSweep } from "@/lib/knowledge-index";
import {
  ensureBundledSkillsInstalled,
  ensureCuratedSkillContent,
  globalSkillsDirectory,
} from "@/lib/skills-library";
import { fetchRegistrySkills } from "@/lib/skill-registry";
import { useAgents } from "@/hooks/use-agents";
import { useAgentController, getAgentController, useRunningSessionIds, disposeAgentController, type AgentControllerApi } from "@/hooks/use-deep-agent";
import { useScheduler } from "@/hooks/use-scheduler";
import type { ActivityItem, AgentMode, AgentRunResult, SharedFile, TodoItem } from "@/lib/agent/types";
import { WidgetStack, TasksWidget, FilesWidget, ContextWidget } from "@/components/agent-widgets";
import { ConversationSearch } from "@/components/conversation-search";
// Suggestion cards temporarily hidden.
// import { PromptSuggestionChips, pickPromptSuggestions, type PromptSuggestion } from "@/components/prompt-suggestions";
import { ConnectorsChip } from "@/components/connectors-chip";
import { ConnectorsPage } from "@/components/connectors-panel";
import { resolveWidgetsHidden, widgetsStorageKey } from "@/lib/widget-visibility";
import type { AgentSandbox } from "@/lib/agent/sandbox";
import { ensureAgentWorkspace, removeAgentWorkspace } from "@/lib/agent/sandbox";
import { applyAgentConfigPatch } from "@/lib/agent/tools";
import { flattenAgentError } from "@/lib/agent/subagent-error-capture";
import {
  buildLearnSystemPrompt,
  loadLearnPreferences,
  type LearnLevel,
  type LearnSubject,
} from "@/lib/learn-mode";
import { generateChatTitle, instantChatTitle, generateFollowUpSuggestion, generateQuestionOptions, type ContentPart, type FollowUpTranscriptEntry } from "@/lib/llm";
import { generatePostRunSuggestion, collectSuggestionOptions } from "@/lib/agent/suggestions";
import type { AgentMessage } from "@/lib/agent/runtime";
import { toHistoryMessage } from "@/lib/agent/history";
import {
  loadSessionCompaction,
  saveSessionCompaction,
  compactHistoryMessages,
  compactionAnchorIndex,
  transcriptFromMessages,
  summarizeConversation,
} from "@/lib/agent/session-compact";
import { CompactionDivider } from "@/components/compaction-divider";
import {
  buildMessageTree,
  getActivePath,
  getSiblings,
} from "@/lib/message-tree";
import { prepareAttachmentContext, rebuildAttachmentContent, buildProjectFilesContext } from "@/lib/attachment-context";
import { getFileBlob, putFileBlob, deleteFileBlob } from "@/lib/attachment-store";
import { extractFileText } from "@/lib/files";
import { ensureDeliverablesDir } from "@/lib/deliverables";
import { getModelCapabilities, getModelCapabilitiesSync, getModelDisplayNameSync, getModelReasoning, getModelReasoningSync, getModelsDevCatalog, reasoningEffortRank, reasoningToggleProtocolForBaseUrl, resolveDefaultReasoningEffort, sanitizeReasoningEffort, type ModelReasoningSupport } from "@/lib/model-capabilities";
import { buildMemoryContext, extractAndSaveMemory, loadMemory } from "@/lib/memory";

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

/** models.dev input modality an attachment maps to (text is the universal one). */
function fileModality(file: { type: string }): string {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  if (t === "application/pdf") return "pdf";
  return "text";
}

const MODALITY_LABELS: Record<string, string> = {
  image: "images",
  pdf: "PDFs",
  audio: "audio",
  video: "video",
  text: "text",
};

/** Display label for a models.dev reasoning effort value. */
function reasoningLabel(effort: string): string {
  const known: Record<string, string> = {
    // "default" only reaches the UI as a toggle-only model's explicit "on".
    default: "",
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
  };
  return known[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);
}

/**
 * Cheap change signature of a run's streaming snapshot. The periodic
 * crash-safety save skips ticks where nothing moved, so a run sitting in a
 * long tool call or approval wait doesn't re-serialize and re-write the
 * whole session to localStorage every 2.5s.
 */
function streamSaveSignature(ctrl: AgentControllerApi): string {
  return [
    ctrl.streamingContent.length,
    ctrl.streamingReasoning.length,
    ctrl.artifacts.length,
    ctrl.files.length,
    ctrl.activities.map((a) => `${a.id}:${a.status}`).join(","),
    ctrl.reasoningStreams.map((s) => `${s.id}:${s.text.length}`).join(","),
    ctrl.workStartedAt ?? "",
    ctrl.workSegments.map((segment) => `${segment.id}:${segment.endedAt ?? ""}:${segment.endTextOffset ?? ""}:${segment.thinking?.length ?? 0}`).join(","),
  ].join("|");
}

type PendingFile = MessageAttachment & { file?: File };

/**
 * Single chat mode — at most one active at a time. Temporary is NOT a mode:
 * it's a whole-chat flag (temporary below) that can coexist with any mode.
 */
type ChatMode = "none" | "learn" | "research" | "council";

const WELCOME_PROMPTS = [
  "What do you want to know?",
  "What's on your mind?",
  "Something you want to learn?",
  "What are we tackling today?",
  "Curious about something?",
  "What's brewing in that brain of yours?",
  "Hit me with your best question.",
  "What's the next big idea?",
  "Ready when you are. What's up?",
  "What mystery shall we unravel?",
  "Got a question? Fire away.",
  "What's keeping you up at night?",
  "Ready to bend some neurons?",
  "What existential crisis are we solving today?",
  "Let's go down a rabbit hole. Which one?",
  "What's the riddle today?",
  "What's worth exploring right now?",
  "Ask away, the floor is yours.",
];

// The chat column must keep at least this much width so the composer and
// messages never overflow. The artifact panel's max width is derived from it:
// max artifact width = container content width - overhead - CHAT_MIN_WIDTH_PX.
// Sized to fit the composer's worst-case bottom row: add button, project chip
// (capped at max-w-20), four mode toggles, model label at max-w-48 with
// provider logo and reasoning icon, send button, gaps, and padding.
const CHAT_MIN_WIDTH_PX = 600;
/** Drag handle (6px) + two flex gaps (2 × 8px) in the chat/artifact row. */
const ARTIFACT_ROW_OVERHEAD_PX = 22;
/** The session container's p-2 padding (2 × 8px). */
const CONTAINER_PADDING_PX = 16;
/** Right-hand space the widget stack needs when it reserves room (18rem widget + 2 × 0.75rem). */
const WIDGETS_RESERVED_PX = 312;
/** Composer rows before it stops growing and scrolls instead. */
const MAX_COMPOSER_LINES = 12;

// Which chat/agent session was open, per tab — local-only UI state (never
// synced) so a real reload (e.g. macOS reclaiming the webview) reopens where
// the user left off instead of dropping to the homescreen.
const ACTIVE_TAB_KEY = "chatui:active-tab";
const ACTIVE_SESSION_BY_TAB_KEY = "chatui:active-session-by-tab";

function loadActiveTab(): "chat" | "agent" {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY) === "agent" ? "agent" : "chat";
  } catch {
    return "chat";
  }
}

function loadActiveSessionByTab(): Record<"chat" | "agent", string | null> {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_BY_TAB_KEY);
    if (!raw) return { chat: null, agent: null };
    const parsed = JSON.parse(raw) as { chat?: unknown; agent?: unknown };
    return {
      chat: typeof parsed.chat === "string" ? parsed.chat : null,
      agent: typeof parsed.agent === "string" ? parsed.agent : null,
    };
  } catch {
    return { chat: null, agent: null };
  }
}

export function ChatView() {
  const [activeTab, setActiveTab] = useState<"chat" | "agent">(loadActiveTab);
  const { sessions, allSessions, createSession, deleteSession, updateSession, moveToChatTab } =
    useSessions(activeTab);
  const { projects, createProject, updateProject, deleteProject, addProjectFile, deleteProjectFile, addProjectImage, deleteProjectImage, refetch: refetchProjects } =
    useProjects();
  const { providers, refetch: refetchProviders } = useProviders();
  const { settings } = useUserSettings();
  const { agents, deleteAgent, updateAgent } = useAgents();
  const isAgentTab = activeTab === "agent";

  const [activeSessionByTab, setActiveSessionByTab] = useState<
    Record<"chat" | "agent", string | null>
  >(loadActiveSessionByTab);
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
    } catch {
      // private-mode quota — the session just won't survive a reload
    }
  }, [activeTab]);
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_SESSION_BY_TAB_KEY, JSON.stringify(activeSessionByTab));
    } catch {
      // private-mode quota — the session just won't survive a reload
    }
  }, [activeSessionByTab]);
  const activeSessionId = activeSessionByTab[activeTab] ?? null;
  const setActiveSessionId = useCallback(
    (id: string | null) =>
      setActiveSessionByTab((prev) => ({ ...prev, [activeTab]: id })),
    [activeTab],
  );
  const { messages, addMessage, updateMessage, deleteMessage, deleteTemporaryMessages, markMessagesPermanent } = useMessages(activeSessionId);
  const agent = useAgentController(activeSessionId);
  const runningIds = useRunningSessionIds();
  // Fires due agent schedules (scheduler/workflows) while the app is open.
  useScheduler();
  // Maps sessionId → in-progress assistant message id so the persisted message can
  // be hidden from the tree while its live streaming bubble is shown instead.
  const inProgressMsgIds = useRef<Map<string, string>>(new Map());
  const [inputText, setInputText] = useState("");
  const sessionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const emptyTextareaRef = useRef<HTMLTextAreaElement>(null);
  // The composers grow with their content up to MAX_COMPOSER_LINES lines,
  // then scroll. `field-sizing` is unreliable in the Tauri webview, so the
  // height is derived from scrollHeight on every change; the line height is
  // read from computed style so it holds at both the text-base (mobile) and
  // text-sm breakpoints.
  const resizeComposerEl = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const maxHeight = lineHeight * MAX_COMPOSER_LINES + padding;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);
  const resizeComposer = useCallback(() => {
    resizeComposerEl(sessionTextareaRef.current);
    resizeComposerEl(emptyTextareaRef.current);
  }, [resizeComposerEl]);
  useLayoutEffect(() => {
    resizeComposer();
  }, [inputText, resizeComposer]);
  useEffect(() => {
    window.addEventListener("resize", resizeComposer);
    return () => window.removeEventListener("resize", resizeComposer);
  }, [resizeComposer]);
  // Warm the models.dev catalog once so the Thinking menu and the model
  // capability disclaimers can read real options synchronously; the tick
  // re-renders them once the (possibly cached) catalog resolves.
  const [, setCatalogTick] = useState(0);
  useEffect(() => {
    void getModelsDevCatalog()
      .then(() => setCatalogTick((t) => t + 1))
      .catch(() => {});
  }, []);
  // Follow-up ghost text in the session composer: which suggestion was
  // taken or dismissed (keyed by session + last assistant message so a
  // fresh exchange brings a fresh ghost).
  const [dismissedGhostKey, setDismissedGhostKey] = useState<string | null>(null);
  // LLM-generated ghosts, keyed like above. Filled in the background after
  // each run; the heuristic below covers the gap (and offline mode).
  const ghostCache = useRef(new Map<string, string>());
  const ghostInflight = useRef(new Set<string>());
  // Tappable answers for the assistant's clarifying questions, same keys.
  const optionCache = useRef(new Map<string, string[]>());
  const optionInflight = useRef(new Set<string>());
  const [, bumpGhost] = useState(0);

  const capCache = <T,>(map: Map<string, T>) => {
    if (map.size > 30) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  };

  const requestFollowUpGhost = (
    sessionId: string,
    assistantId: string,
    ghostProvider: Provider,
    modelName: string,
    transcript: FollowUpTranscriptEntry[],
    title?: string,
  ) => {
    if (!settings.promptSuggestions) return;
    const key = `${sessionId}:${assistantId}`;
    if (ghostCache.current.has(key) || ghostInflight.current.has(key)) return;
    ghostInflight.current.add(key);
    void generateFollowUpSuggestion(ghostProvider, modelName, transcript, title)
      .then((suggestion) => {
        if (suggestion) {
          ghostCache.current.set(key, suggestion);
          capCache(ghostCache.current);
          bumpGhost((n) => n + 1);
        }
      })
      .catch(() => {})
      .finally(() => {
        ghostInflight.current.delete(key);
      });
  };

  const requestQuestionOptions = (
    sessionId: string,
    assistantId: string,
    optionsProvider: Provider,
    modelName: string,
    question: string,
    transcript: FollowUpTranscriptEntry[],
  ) => {
    if (!settings.promptSuggestions) return;
    const key = `${sessionId}:${assistantId}`;
    if (optionCache.current.has(key) || optionInflight.current.has(key)) return;
    optionInflight.current.add(key);
    void generateQuestionOptions(optionsProvider, modelName, question, transcript)
      .then((options) => {
        if (options.length > 0) {
          optionCache.current.set(key, options);
          capCache(optionCache.current);
          bumpGhost((n) => n + 1);
        }
      })
      .catch(() => {})
      .finally(() => {
        optionInflight.current.delete(key);
      });
  };

  /**
   * Post-run capability card: a separate model call (never the agent) over
   * the finished exchange decides whether the user's next step needs a
   * skill/connector/mode card. Best-effort, non-blocking, and never stacks on
   * an unanswered card or a running turn.
   */
  const requestPostRunSuggestion = (
    sessionId: string,
    suggestionProvider: Provider,
    modelName: string,
    transcript: FollowUpTranscriptEntry[],
    opts: { allowModes: boolean },
  ) => {
    if (!settings.promptSuggestions) return;
    const ctrl = getAgentController(sessionId);
    if (ctrl.pendingSuggestion) return;
    void (async () => {
      try {
        const { skills, connectors } = await collectSuggestionOptions();
        const suggestion = await generatePostRunSuggestion({
          provider: suggestionProvider,
          model: modelName,
          transcript,
          skills,
          connectors,
          allowModes: opts.allowModes,
        });
        if (!suggestion) return;
        // The user may have sent a new message (or another card appeared)
        // while the suggestion call was in flight — never interrupt that.
        if (ctrl.isRunning || ctrl.pendingSuggestion) return;
        ctrl.showSuggestion(suggestion);
      } catch {
        // best-effort — no card on failure
      }
    })();
  };
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  // Full-screen drag & drop overlay shown while files hover over the window.
  const [fileDropOverlay, setFileDropOverlay] = useState(false);
  const fileDropCounter = useRef(0);
  // Web fetch toggle — its UI (the + menu's Skills submenu) is removed for
  // now; the flag still drives runs. Re-add a control to let users change it.
  const [webFetchEnabled] = useState(true);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [welcomePrompt, setWelcomePrompt] = useState(
    () => WELCOME_PROMPTS[Math.floor(Math.random() * WELCOME_PROMPTS.length)],
  );
  const [chatMode, setChatMode] = useState<ChatMode>("none");
  // Whole-chat temporary flag — orthogonal to the mode (a chat can be both
  // temporary and research). Locked once the conversation has messages.
  const [temporary, setTemporary] = useState(false);
  const isTemporary = temporary;
  const [learnLevel] = useState<LearnLevel>(() => loadLearnPreferences().level);
  const [learnSubject] = useState<LearnSubject>(() => loadLearnPreferences().subject);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  // Agents-tab pending context for the next session created on send: which
  // saved agent it belongs to, or whether it's an agent-builder setup chat.
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [pendingSetup, setPendingSetup] = useState(false);
  // Agent whose settings dialog is open (gear menu in the sidebar).
  const [agentSettingsId, setAgentSettingsId] = useState<string | null>(null);
  // Agent whose console is open (clicking the agent in the sidebar).
  const [activeAgentConsoleId, setActiveAgentConsoleId] = useState<string | null>(null);
  // Panel shown in the agent console's main area — owned by the sidebar.
  const [agentConsoleTab, setAgentConsoleTab] = useState<AgentConsoleTab>("general");
  // New-session compose mode inside the agent console — the sidebar and the
  // console's start button both enter it; sending or navigating away exits.
  const [agentConsoleComposing, setAgentConsoleComposing] = useState(false);
  // What the console's main area shows when a session is open: the session
  // itself, or the sidebar-selected Preferences panel. Clicking a session
  // focuses it; clicking a Preferences tab focuses the panel.
  const [agentConsoleFocus, setAgentConsoleFocus] = useState<"session" | "panel">("session");
  // The Agents tab's default view: the fleet dashboard (agent grid + smart
  // composer). "New Task"/"New Agent" swap it for the plain composer.
  const [agentDashboardOpen, setAgentDashboardOpen] = useState(true);
  const [view, setView] = useState<"chat" | "settings" | "account" | "projects" | "history" | "connectors">("chat");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [accountTab, setAccountTab] = useState<AccountTab>("profile");
  const { user: accountUser, signOut: signAccountOut } = useAuth();
  const accountProfile = getAccountProfile(accountUser);
  const [accountOpen, setAccountOpen] = useState(false);
  const openSettings = () => setView("settings");
  const handleAccountSignOut = useCallback(() => {
    void signAccountOut().then(() => {
      toast.success("Signed out — your data stays on this device");
    });
  }, [signAccountOut]);
  // A fresh sign-in from the connect modal lands on the account settings
  // page. Gated on the modal being open so restored sessions (and sign-outs)
  // never yank the view around.
  const prevAccountUserId = useRef<string | null>(null);
  useEffect(() => {
    const id = accountUser?.id ?? null;
    if (accountOpen && prevAccountUserId.current === null && id !== null) {
      setAccountOpen(false);
      setView("account");
    }
    prevAccountUserId.current = id;
  }, [accountUser, accountOpen]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historySelectedIds, setHistorySelectedIds] = useState<Set<string>>(new Set());
  const [renamingHistory, setRenamingHistory] = useState<{ id: string; title: string } | null>(null);
  const [historyRenameDraft, setHistoryRenameDraft] = useState("");
  // Session id for the "this conversation moved to the Agents tab" notice.
  const [movedNoticeId, setMovedNoticeId] = useState<string | null>(null);
  // Interrupted navigation away from a temporary chat: the leave warning is
  // showing and this holds where the user was headed.
  const [pendingLeave, setPendingLeave] = useState<{ sessionId: string; proceed: () => void } | null>(null);
  // After an agent-builder run creates an agent, offer to delete the setup chat.
  const [deleteSetupDialog, setDeleteSetupDialog] = useState<{ sessionId: string; agentName: string } | null>(null);
  const [projectInputText, setProjectInputText] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  // Starter-prompt chips for the empty chat screen: three of the pool at a
  // time, reshuffled every time the welcome screen comes back.
  // Suggestion cards temporarily hidden.
  // const [promptPicks, setPromptPicks] = useState<PromptSuggestion[]>(() =>
  //   pickPromptSuggestions(3),
  // );
  // Reasoning effort for the current session ("default" sends nothing).
  // Seeded from the active session when switching chats; changes persist to
  // the session so they survive reloads.
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("default");
  const [resolvedReasoningSupport, setResolvedReasoningSupport] = useState<{
    key: string;
    support: ModelReasoningSupport | null;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [selectedChildMap, setSelectedChildMap] = useState<
    Map<string | null, string>
  >(new Map());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  // Composer draft stashed when an edit starts and restored on save/cancel,
  // so editing a message never eats an in-progress draft.
  const editDraftRef = useRef<{ text: string; files: PendingFile[] } | null>(null);
  const editSessionRef = useRef<string | null>(null);
  const [showRawOutput, setShowRawOutput] = useState<Set<string>>(new Set());
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const projectImageInputRef = useRef<HTMLInputElement>(null);
  const [editingProjectField, setEditingProjectField] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectInstructionsDraft, setProjectInstructionsDraft] = useState("");
  const [showNewProjectCard, setShowNewProjectCard] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectInstructions, setNewProjectInstructions] = useState("");
  const [artifactPanel, setArtifactPanel] = useState<{ artifacts: Artifact[]; activeIndex: number } | null>(null);
  const [artifactWindowMode, setArtifactWindowMode] = useState<"open" | "minimized" | "expanded">("open");
  const [artifactWidth, setArtifactWidth] = useState<number | null>(null);
  // Master show/hide for the session widget stack (hamburger in the header),
  // stored per tab: hidden by default in chat, open by default in agent (see
  // src/lib/widget-visibility.ts).
  const [widgetsHiddenByTab, setWidgetsHiddenByTab] = useState<Record<"chat" | "agent", boolean>>(() => {
    const next = { chat: resolveWidgetsHidden("chat"), agent: resolveWidgetsHidden("agent") };
    localStorage.setItem(widgetsStorageKey("chat"), next.chat ? "1" : "0");
    localStorage.setItem(widgetsStorageKey("agent"), next.agent ? "1" : "0");
    localStorage.removeItem("chatui:widgets-hidden");
    return next;
  });
  const widgetsHidden = widgetsHiddenByTab[activeTab];
  const toggleWidgetsHidden = () =>
    setWidgetsHiddenByTab((prev) => {
      const next = { ...prev, [activeTab]: !prev[activeTab] };
      localStorage.setItem(widgetsStorageKey(activeTab), next[activeTab] ? "1" : "0");
      return next;
    });
  // Sidebar open state (user-controlled; the widget stack floats over the
  // chat and never squeezes the layout, so it no longer auto-collapses it).
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Session id currently being compacted (context widget's Compact button).
  const [compactingSessionId, setCompactingSessionId] = useState<string | null>(null);
  // Bumped whenever the active session's compaction record changes, so the
  // divider re-reads it from storage (records live in localStorage, not state).
  const [compactionTick, setCompactionTick] = useState(0);
  // Find-in-conversation bar (⌘F), browser-style.
  const [findOpen, setFindOpen] = useState(false);
  const sessionContainerRef = useRef<HTMLDivElement>(null);
  const autoOpenedArtifacts = useRef<Set<string>>(new Set());
  const autoModeRef = useRef<ChatMode>("none");

  useEffect(() => {
    if (settings.temporaryByDefault) {
      setTemporary(true);
    }
  }, [settings.temporaryByDefault]);

  // ⌘F opens the find-in-conversation bar over the open chat. Browser find
  // stays native everywhere else (settings, welcome screen, …).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        if (!activeSessionId || view !== "chat") return;
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSessionId, view]);

  // Leaving the conversation closes the find bar.
  useEffect(() => {
    setFindOpen(false);
  }, [activeSessionId, view]);

  // Knowledge index: first sweep shortly after launch (debounced triggers in
  // use-deep-agent re-index after each run). Bundled skills install at launch
  // (no network); catalog/registry skills install on demand — the agent finds
  // them via RAG and search_skills installs a match on the spot. The registry
  // fetch warms the catalog cache; catalog bodies prefetch in the background
  // (30-day cache) so full instructions are searchable before any install.
  useEffect(() => {
    scheduleKnowledgeSweep(15_000);
    void (async () => {
      await ensureBundledSkillsInstalled();
      const registrySkills = await fetchRegistrySkills();
      await ensureCuratedSkillContent(registrySkills);
      scheduleKnowledgeSweep(2_000);
    })().catch(() => {});
  }, []);

  // Check for app updates once on launch (silently).
  useEffect(() => {
    if (!isUpdaterAvailable()) return;
    const updateSettings = loadUpdateSettings();
    if (!updateSettings.autoCheck) return;
    if (document.readyState === "complete") {
      void checkForUpdate().then((result) => {
        if (result.available && result.info) {
          if (updateSettings.skippedVersion === result.info.version) return;
          toast(`Update available — v${result.info.version}`, {
            action: {
              label: "View",
              onClick: () => {
                setSettingsTab("updates");
                setView("settings");
              },
            },
          });
        }
      }).catch(() => { /* silent failure on launch */ });
    }
  }, []);

  // Auto-detect chat mode from the first word(s) typed in the composer.
  // "discuss…" → council, "teach me…"/"i want to learn…" → learn,
  // "research…" → research. Deleting the trigger word reverts the mode.
  // A manual toggle always wins: once the user changes the mode by hand,
  // the auto-detection stops fighting them. Chat modes are chat-tab only.
  useEffect(() => {
    if (isAgentTab) return;
    const detected = detectModeTrigger(inputText);
    const detectedMode: ChatMode = detected ?? "none";

    if (detectedMode !== autoModeRef.current) {
      const prevAuto = autoModeRef.current;
      autoModeRef.current = detectedMode;
      if (detectedMode === "none") {
        if (chatMode === prevAuto) setChatMode("none");
      } else {
        if (chatMode === prevAuto || chatMode === "none") setChatMode(detectedMode);
      }
    }
  }, [inputText, chatMode, isAgentTab]);

  // Settings manages its own provider state; refresh ours when leaving it.
  useEffect(() => {
    if (view !== "settings") {
      void refetchProviders();
    }
  }, [view, refetchProviders]);

  useEffect(() => {
    if (!selectedModel && settings.defaultModel) {
      setSelectedModel(settings.defaultModel);
    }
  }, [settings.defaultModel, selectedModel]);

  const allModels = providers.flatMap((p) =>
    p.models.map((m) => ({
      id: m.id,
      name: m.name,
      displayName: m.displayName,
      providerId: p.id,
      providerName: p.name,
      baseUrl: p.baseUrl,
      builtinKey: p.builtinKey,
    }))
  );

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Seed the composer's reasoning effort from the active session when
  // switching between chats; a fresh session starts at "default".
  useEffect(() => {
    setReasoningEffort(activeSession?.reasoningEffort ?? "default");
  }, [activeSession?.id]);
  const currentProjectId =
    activeSession?.projectId ?? pendingProjectId ?? undefined;
  const currentProjectName = projects.find(
    (p) => p.id === currentProjectId,
  )?.name;
  const currentProjectInstructions = projects.find(
    (p) => p.id === currentProjectId,
  )?.instructions;
  const currentProjectDirectory =
    projects.find((p) => p.id === currentProjectId)?.directory ?? null;

  // Agent-mode context: the saved agent behind the active (or pending) session.
  const currentAgentDef = activeSession?.agentId
    ? agents.find((a) => a.id === activeSession?.agentId)
    : undefined;
  const pendingAgentName = pendingAgentId
    ? agents.find((a) => a.id === pendingAgentId)?.name
    : undefined;
  // The console only lives on the Agents tab; sessions and projects win over
  // it in the render chain below. A session with an agent assigned always
  // lives in that agent's console, no matter where it was opened from.
  const activeAgentConsole = isAgentTab
    ? agents.find((a) => a.id === (activeSession?.agentId ?? activeAgentConsoleId))
    : undefined;
  // This agent's sessions for the console sidebar, newest first.
  const activeAgentSessions = useMemo(
    () =>
      activeAgentConsole
        ? sessions
            .filter((s) => s.agentId === activeAgentConsole.id)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        : [],
    [sessions, activeAgentConsole],
  );

  /**
   * Agent-style run context: saved-agent sessions run sandboxed on the
   * agent's own prompt/skills/connectors, restricted to its workspace +
   * user-granted folders/projects; setup chats run the builder; no agent
   * (every chat-tab send outside the special learn/research/council modes)
   * runs the full task-manager agent.
   *
   * Async because resolving the sandbox touches the filesystem (workspace).
   */
  const agentRunContext = async (desc: {
    agentId?: string;
    isSetup?: boolean;
  }): Promise<{
    mode: AgentMode;
    webFetch: boolean;
    instructions?: string;
    taskProfile: {
      toolProfile: "task" | "setup";
      enableCommandTools: boolean;
      enableFileTools: boolean;
      enableComputerUse: boolean;
      skillNames?: string[];
      mcpNames?: string[];
      sandbox?: AgentSandbox;
    };
    agent?: AgentDefinition;
    /** The agent's own model, or undefined to use the composer's model. */
    model?: string;
  }> => {
    const agentDef = desc.agentId ? agents.find((a) => a.id === desc.agentId) : undefined;
    const instructions = agentDef
      ? [
          `You are "${agentDef.name}", a personal agent. Purpose: ${agentDef.purpose}`,
          agentDef.systemPrompt,
        ]
        .filter(Boolean)
        .join("\n\n")
      : currentProjectInstructions || undefined;

    // Filesystem sandbox for saved agents: private workspace + the shared
    // skills folder + granted folders + granted projects' codebase folders.
    // Standalone tasks and builder chats run unrestricted (approval-gated as
    // before).
    let sandbox: AgentSandbox | undefined;
    if (agentDef) {
      const workspace = await ensureAgentWorkspace(agentDef.id).catch(() => undefined);
      const skillsDir = await globalSkillsDirectory().catch(() => undefined);
      const projectDirs = agentDef.allProjects
        ? projects.map((p) => p.directory).filter((d): d is string => !!d)
        : (agentDef.allowedProjects ?? [])
            .map((pid) => projects.find((p) => p.id === pid)?.directory)
            .filter((d): d is string => !!d);
      sandbox = {
        agentId: agentDef.id,
        workspace,
        allowedDirectories: [
          ...(workspace ? [workspace] : []),
          ...(skillsDir ? [skillsDir] : []),
          ...(agentDef.allowedFolders ?? []),
          ...projectDirs,
        ],
        externalChats: agentDef.externalChats,
        allowedExternalSessions: agentDef.allowedExternalSessions,
      };
    }

    return {
      mode: "task" as AgentMode,
      webFetch: webFetchEnabled && (agentDef?.capabilities.web ?? true),
      instructions,
      taskProfile: {
        toolProfile: (desc.isSetup ? "setup" : "task") as "task" | "setup",
        enableCommandTools: agentDef ? agentDef.capabilities.terminal : true,
        enableComputerUse: agentDef ? agentDef.capabilities.computerUse : true,
        // Folders-only access model: saved agents always get the file tools;
        // the sandbox (workspace + granted folders + granted projects) is the
        // authorization — granted folders are trusted, no approval cards.
        enableFileTools: !!agentDef,
        // Skills are auto-discovered: every agent sees all installed skills
        // and pulls them in via search_skills when needed. Connectors: an
        // agent with no explicit selection gets every connected server.
        mcpNames:
          agentDef && agentDef.connectors.length > 0 ? agentDef.connectors : undefined,
        sandbox,
      },
      agent: agentDef,
      model: agentDef?.model,
    };
  };

  // Composer copy per tab/session kind.
  const chatComposerPlaceholder = isAgentTab
    ? currentAgentDef
      ? `Message ${currentAgentDef.name}…`
      : "Describe the task and the agent will start working..."
    : isTemporary
      ? "This whole chat will be forgotten when you leave it"
      : "Ask anything...";
  const emptyComposerPlaceholder = isAgentTab
    ? pendingSetup
      ? "Describe what this agent should do…"
      : pendingAgentName
        ? `Message ${pendingAgentName}…`
        : "Describe the task and the agent will start working..."
    : isTemporary
      ? "This whole chat will be forgotten when you leave it"
      : "Ask anything...";
  const emptyStateHeading = !isAgentTab
    ? welcomePrompt
    : pendingSetup
      ? "What should this agent do?"
      : pendingAgentName
        ? `What can ${pendingAgentName} do for you?`
        : "What do you want done?";

  const displayMessages: ChatMessage[] = activeSessionId
    ? messages
    : ([] as ChatMessage[]);

  const { roots, nodeMap } = useMemo(
    () => buildMessageTree(displayMessages),
    [displayMessages],
  );

  const activePath = useMemo(
    () => getActivePath(roots, nodeMap, selectedChildMap),
    [roots, nodeMap, selectedChildMap],
  );
  const hasFolderAttachment = files.some((file) => !!file.folderPath) || activePath.some(
    (node) => node.message.attachments?.some((attachment) => !!attachment.folderPath),
  );

  // The session's compaction record (if any) and the active-path index of
  // its anchor — the divider renders directly after that message. -1 hides
  // it: no compaction, or the anchor left the path (same condition under
  // which replay ignores the compaction).
  const compactionRecord = useMemo(() => {
    // Tick bump re-reads the record after a fresh compaction is saved.
    void compactionTick;
    return activeSessionId ? loadSessionCompaction(activeSessionId) : null;
  }, [activeSessionId, compactionTick]);
  const compactionAnchor = useMemo(
    () =>
      compactionAnchorIndex(
        activePath.map((n) => n.message.id),
        compactionRecord,
      ),
    [activePath, compactionRecord],
  );

  // Agent-task view = an agent-mode session (task) is open in the main area.
  const agentTaskView = isAgentTab && !!activeSession?.agentId;

  // Follow-up ghost text for the session composer, personalized to the
  // chat. Null when there is nothing worth suggesting (no reply yet, the
  // agent just asked a question, suggestions off, or input already typed).
  const lastAssistantId = [...activePath]
    .reverse()
    .find((n) => n.message.role === "assistant")?.message.id;
  const followUpGhostKey = activeSessionId && lastAssistantId
    ? `${activeSessionId}:${lastAssistantId}`
    : null;
  const followUpGhost = useMemo(
    () =>
      followUpSuggestion(
        activePath.map((n) => ({ role: n.message.role, content: n.message.content })),
      ),
    [activePath],
  );
  // The LLM ghost wins when it has arrived; the heuristic covers the gap
  // (and offline mode with no provider key).
  const llmGhost = followUpGhostKey
    ? ghostCache.current.get(followUpGhostKey)
    : undefined;
  const ghostSuggestion =
    settings.promptSuggestions &&
    followUpGhostKey &&
    dismissedGhostKey !== followUpGhostKey &&
    inputText === "" &&
    files.length === 0 &&
    !editingMessageId &&
    !agent?.isRunning
      ? (llmGhost ?? followUpGhost)
      : null;

  // Current todo list for the tasks widget: the live run's todos, else the
  // todo activities of the newest message that has them (persisted state).
  const sessionTodos: TodoItem[] = (() => {
    if (agent?.todos && agent.todos.length > 0) return agent.todos;
    for (let i = activePath.length - 1; i >= 0; i--) {
      const todos = (activePath[i]?.message.activities ?? []).filter(
        (a) => a.kind === "todo",
      );
      if (todos.length > 0) {
        return todos.map((a) => ({
          content: a.name,
          status:
            a.status === "done"
              ? ("completed" as const)
              : a.status === "running"
                ? ("in_progress" as const)
                : ("pending" as const),
        }));
      }
    }
    return [];
  })();

  // Files generated during this session for the files widget: shared files
  // and write_local_file results — the live run first, then the persisted
  // active path. Same-path entries merge (a later known size wins); a stale
  // activity trace of a file that was shared under another path collapses so
  // the widget shows the actual file once (see mergeSessionFiles).
  const sessionFiles: SharedFile[] = (() => {
    const sources: Array<{ shares: SharedFile[]; activities: ActivityItem[] }> = [];
    if (agent?.isRunning) {
      sources.push({ shares: agent.files, activities: agent.activities });
    }
    for (const node of activePath) {
      sources.push({ shares: node.message.files ?? [], activities: node.message.activities ?? [] });
    }
    return mergeSessionFiles(sources);
  })();

  // Widgets shown = stack slid in. The stack itself auto-closes when the
  // cards don't fit the available height (reported via onFitChange), and the
  // chat column reserves right-hand space for it whenever that still leaves
  // the chat at its minimum width — the widgets only float over the text
  // when the two genuinely cannot fit side by side.
  const sessionViewActive = !!activeSession && (!isAgentTab || agentConsoleFocus === "session");
  const widgetsVisible = sessionViewActive && !artifactPanel && !widgetsHidden;
  const [widgetsFit, setWidgetsFit] = useState(true);
  const [sessionWidth, setSessionWidth] = useState(0);
  useEffect(() => {
    const el = sessionContainerRef.current;
    if (!el) return;
    const update = () => setSessionWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sessionViewActive]);
  const reserveWidgetsSpace =
    widgetsVisible &&
    widgetsFit &&
    sessionWidth > 0 &&
    sessionWidth - CONTAINER_PADDING_PX - WIDGETS_RESERVED_PX >= CHAT_MIN_WIDTH_PX;

  useEffect(() => {
    // Leaving a session mid-edit cancels it and brings back the stashed draft.
    if (editSessionRef.current) {
      const draft = editDraftRef.current;
      editDraftRef.current = null;
      editSessionRef.current = null;
      setInputText(draft?.text ?? "");
      setFiles(draft?.files ?? []);
    }
    setSelectedChildMap(new Map());
    setEditingMessageId(null);
    setShowRawOutput(new Set());
    setArtifactPanel(null);
    setArtifactWindowMode("open");
    autoOpenedArtifacts.current = new Set();
  }, [activeSessionId]);

  // Escape leaves edit mode from anywhere (the textarea handler only fires
  // while the composer has focus; popups that consume Escape win).
  useEffect(() => {
    if (!editingMessageId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      handleCancelEdit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingMessageId]);

  // Fresh starter-prompt chips whenever the empty chat screen appears.
  // Suggestion cards temporarily hidden.
  // useEffect(() => {
  //   if (!activeSessionId) setPromptPicks(pickPromptSuggestions(3));
  // }, [activeSessionId]);

  // Auto-open the artifact panel the moment a new artifact is emitted during a
  // run (create_artifact mid-run, or research/discuss synthesis at the end).
  // Each artifact id is opened only once — tracked in a ref Set that persists
  // across session switches (ids are globally unique via Date.now + counter).
  useEffect(() => {
    if (!agent) return;
    const fresh = agent.artifacts.filter((a) => !autoOpenedArtifacts.current.has(a.id));
    if (fresh.length === 0) return;
    fresh.forEach((a) => autoOpenedArtifacts.current.add(a.id));
    setArtifactPanel({ artifacts: agent.artifacts, activeIndex: agent.artifacts.length - 1 });
    setArtifactWindowMode("open");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
  }, [agent?.artifacts]);

  // Rehydrated image previews for persisted message attachments. Blob URLs
  // die on reload, so previews are rebuilt from the IndexedDB file store.
  const [attachmentPreviews, setAttachmentPreviews] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const pending = displayMessages.flatMap((m) =>
      (m.attachments ?? []).filter(
        (a) =>
          a.storageId &&
          a.type.startsWith("image/") &&
          !a.previewUrl &&
          !attachmentPreviews.has(a.id),
      ),
    );
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const a of pending) {
        const blob = await getFileBlob(a.storageId!);
        if (cancelled) return;
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        setAttachmentPreviews((prev) => new Map(prev).set(a.id, url));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [displayMessages, attachmentPreviews]);

  const comingSoon = (feature: string) => toast(`${feature} is coming soon`);

  const startArtifactDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = sessionContainerRef.current;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    const startX = e.clientX;
    const startWidth = artifactWidth ?? containerWidth * 0.7;
    // Never let the artifact grow past the point where the chat column drops
    // below its minimum width.
    const maxWidth = Math.max(
      containerWidth * 0.4,
      containerWidth - CONTAINER_PADDING_PX - ARTIFACT_ROW_OVERHEAD_PX - CHAT_MIN_WIDTH_PX,
    );
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const newWidth = Math.max(containerWidth * 0.25, Math.min(maxWidth, startWidth + delta));
      setArtifactWidth(newWidth);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Stable identity: it is passed to memoized MarkdownRenderer/MessageStream
  // below, where a fresh closure per render would defeat the memo and
  // re-parse every message's markdown on every keystroke.
  const handleOpenArtifactFromContent = useCallback((content: string, language: string) => {
    const title = language.charAt(0).toUpperCase() + language.slice(1);
    const artifact: Artifact = {
      id: `inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      language,
      content,
      index: 0,
    };
    setArtifactPanel({ artifacts: [artifact], activeIndex: 0 });
    setArtifactWindowMode("open");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
  }, []);

  const handleDownloadSharedFile = async (path: string) => {
    try {
      const name = await downloadSharedFile(path);
      toast.success(`Downloaded ${name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleOpenSharedFile = async (path: string) => {
    try {
      await openPath(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open file");
    }
  };

  const handleRevealSharedFile = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reveal file");
    }
  };

  /**
   * Manual context compaction (context widget's Compact button): summarize
   * the conversation up to its newest message and store the summary as the
   * session's compaction record — subsequent runs replay the summary in
   * place of the older turns (see compactHistoryMessages). The messages
   * themselves are untouched.
   */
  const handleCompactContext = async () => {
    if (!activeSessionId || !activeSession || agent?.isRunning || activePath.length === 0) return;
    const arc = isAgentTab
      ? await agentRunContext({
          agentId: activeSession.agentId,
          isSetup: activeSession.isSetup === true,
        })
      : null;
    const runModelName = arc?.model ?? selectedModel;
    const provider = runModelName ? findProviderForModel(runModelName) : null;
    if (!provider || !runModelName) {
      toast.error("No provider configured. Add one in Settings.");
      openSettings();
      return;
    }
    setCompactingSessionId(activeSessionId);
    try {
      const transcript = transcriptFromMessages(
        activePath.map((n) => ({ role: n.message.role, content: n.message.content })),
      );
      if (!transcript) {
        toast.error("Nothing to compact yet.");
        return;
      }
      const summary = await summarizeConversation(provider, runModelName, transcript);
      if (!summary) throw new Error("The model returned no summary.");
      saveSessionCompaction(activeSessionId, {
        summary,
        upToId: activePath[activePath.length - 1].message.id,
        at: Date.now(),
      });
      setCompactionTick((t) => t + 1);
      toast.success("Context compacted — older turns will be sent as a summary.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Compaction failed");
    } finally {
      setCompactingSessionId(null);
    }
  };

  const startDrag = (e: React.MouseEvent) => {
    if (e.button === 0) getCurrentWindow().startDragging();
  };

  const startEditingTitle = () => {
    if (!activeSession) return;
    setTitleDraft(activeSession.title);
    setIsEditingTitle(true);
  };

  const commitTitle = () => {
    if (!isEditingTitle) return;
    const trimmed = titleDraft.trim();
    if (trimmed && activeSessionId) {
      updateSession(activeSessionId, { title: trimmed });
    }
    setIsEditingTitle(false);
  };

  const cancelTitleEdit = () => {
    setIsEditingTitle(false);
  };

  const addFiles = (selected: File[]) => {
    if (selected.length === 0) return;
    setFiles((prev) => {
      // One drop can reach this twice (the composer and window listeners, or
      // the Tauri native drop racing the webview's) — collapse repeats of
      // files already pending instead of stacking two identical chips.
      const seen = new Set(prev.map((file) => `${file.name}\u0000${file.size}`));
      const fresh = selected.filter((file) => {
        const key = `${file.name}\u0000${file.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (fresh.length === 0) return prev;
      return [
        ...prev,
        ...fresh.map((file) => {
          const id = generateId();
          // Persist the bytes (plus eagerly extracted text for documents) so
          // the attachment survives restarts and stays in context on replay.
          if (file.type.startsWith("image/")) {
            void putFileBlob(id, file);
          } else {
            void extractFileText(file)
              .then((text) => putFileBlob(id, file, { extractedText: text }))
              .catch(() => {});
          }
          return {
            id,
            name: file.name,
            size: file.size,
            type: file.type,
            previewUrl: file.type.startsWith("image/")
              ? URL.createObjectURL(file)
              : undefined,
            file,
          };
        }),
      ];
    });
  };

  const addFolderPath = (path: string) => {
    const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
    setFiles((prev) => {
      // The same folder drop can arrive via both the native and webview paths.
      if (prev.some((file) => file.folderPath === path)) return prev;
      return [...prev, {
        id: generateId(), name, size: 0, type: "inode/directory", folderPath: path,
      }];
    });
  };

  const pickFolder = async () => {
    try {
      const path = await openDialog({ directory: true, multiple: false });
      if (typeof path === "string") addFolderPath(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add folder");
    }
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  /**
   * Full-screen drag & drop: any Finder drag over the window raises the
   * overlay; dropping anywhere attaches the files to the composer. Uses a
   * nested-enter counter so moving between child elements never flickers the
   * overlay, and a ref to addFiles so the listeners attach exactly once.
   */
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    const hasFiles = (dt: DataTransfer | null) =>
      !!dt && Array.prototype.includes.call(dt.types || [], "Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      fileDropCounter.current += 1;
      setFileDropOverlay(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      // Continuously allow the drop (dragover must be prevented to accept it).
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      fileDropCounter.current = Math.max(0, fileDropCounter.current - 1);
      if (fileDropCounter.current === 0) {
        setFileDropOverlay(false);
        setDraggingFiles(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      // A composer already handled this drop (it preventDefaults and stops
      // propagation) — never attach the same files twice.
      if (e.defaultPrevented) return;
      e.preventDefault();
      fileDropCounter.current = 0;
      setFileDropOverlay(false);
      setDraggingFiles(false);
      if (e.dataTransfer?.files?.length) {
        addFilesRef.current(Array.from(e.dataTransfer.files));
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    let unlistenNative: (() => void) | undefined;
    let unlistenCancelled = false;
    if ("__TAURI_INTERNALS__" in window) {
      void getCurrentWindow().onDragDropEvent(async (event) => {
        const payload = event.payload;
        // Native drag & drop: the webview's HTML5 drop events are disabled
        // (tauri.conf dragDropEnabled), so the drop overlay is driven from
        // these window events instead of the DOM listeners above.
        if (payload.type === "enter" || payload.type === "over") {
          setFileDropOverlay(true);
          return;
        }
        if (payload.type === "leave") {
          setFileDropOverlay(false);
          setDraggingFiles(false);
          return;
        }
        if (payload.type !== "drop") return;
        fileDropCounter.current = 0;
        setFileDropOverlay(false);
        setDraggingFiles(false);
        for (const path of payload.paths) {
          try {
            const isDirectory = await invoke<boolean>("path_is_directory", { path });
            if (isDirectory) {
              addFolderPath(path);
            } else {
              const raw = await invoke<{ name: string; size: number; contentBase64: string }>("read_shared_file", { path });
              const binary = atob(raw.contentBase64);
              const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
              addFiles([new File([bytes], raw.name, { type: "application/octet-stream" })]);
            }
          } catch (error) {
            toast.error(error instanceof Error ? error.message : `Could not attach ${path}`);
          }
        }
      }).then((unlisten) => {
        // The effect can unmount while the listener promise is still pending
        // (StrictMode double-mount) — tear the late listener down instead of
        // leaking a second one that would fire every drop twice.
        if (unlistenCancelled) unlisten();
        else unlistenNative = unlisten;
      });
    }
    return () => {
      unlistenCancelled = true;
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      unlistenNative?.();
    };
  }, []);

  /** HTML5 drag & drop from Finder onto a composer (browser dev; the Tauri build drops natively). */
  const composerDropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDraggingFiles(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDraggingFiles(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      // Keep the window listener from handling (and double-adding) this drop.
      e.stopPropagation();
      setDraggingFiles(false);
      addFiles(Array.from(e.dataTransfer?.files ?? []));
    },
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((file) => file.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((file) => file.id !== id);
    });
    // While editing, the blob still belongs to the message on the branch
    // (and to the original branch sibling) — keep it.
    if (!editingMessageId) void deleteFileBlob(id);
  };

  const findProviderForModel = (modelName: string) => {
    const model = allModels.find((m) => m.name === modelName);
    if (!model) return null;
    return providers.find((p) => p.id === model.providerId) ?? null;
  };

  const handleSend = async (
    overrideText?: string,
    /** Agent-context overrides for sends that bypass the pending states — the fleet dashboard's composer. */
    overrides?: { agentId?: string | null; setup?: boolean },
  ) => {
    const text = (overrideText ?? inputText).trim();
    if ((!text && files.length === 0) || agent?.isRunning) return;
    if (blockIfRunActiveElsewhere(activeSessionId)) return;

    // Agent-style runs — every chat-tab send except the special learn/
    // research/council modes, plus every agent-tab session — run the full
    // agentic task context, isolated from universal memory.
    const arc = isAgentTab
      ? await agentRunContext({
          agentId:
            overrides?.agentId !== undefined
              ? (overrides.agentId ?? undefined)
              : (pendingAgentId ?? activeSession?.agentId ?? activeAgentConsole?.id),
          isSetup: overrides
            ? !!overrides.setup
            : pendingSetup || activeSession?.isSetup === true,
        })
      : chatMode === "learn" || chatMode === "research" || chatMode === "council"
        ? null
        : await agentRunContext({});
    if (arc?.taskProfile.sandbox && hasFolderAttachment) {
      arc.taskProfile.sandbox.allowedDirectories = [...new Set([
        ...(arc.taskProfile.sandbox.allowedDirectories ?? []),
        ...activePath.flatMap((node) => node.message.attachments ?? []).filter((a) => !!a.folderPath).map((a) => a.folderPath!),
        ...files.filter((a) => !!a.folderPath).map((a) => a.folderPath!),
      ])];
    }
    // Saved agents may pin their own model; otherwise the composer's model.
    const runModelName = arc?.model ?? selectedModel;
    const provider = runModelName ? findProviderForModel(runModelName) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      openSettings();
      return;
    }

    // Pin an auto-detected mode at send time: the message goes out with this
    // mode, so it becomes the session's mode and survives the composer
    // clearing (Learn stays on until the user turns it off manually).
    if (autoModeRef.current !== "none" && chatMode === autoModeRef.current) {
      autoModeRef.current = "none";
    }

    const mode: AgentMode = arc
      ? arc.mode
      : chatMode === "research"
        ? "research"
        : chatMode === "council"
          ? "council"
          : "chat";

    // Vision check: block image attachments for non-vision models
    const hasImages = files.some((f) => f.type.startsWith("image/"));
    if (hasImages) {
      const caps = await getModelCapabilities(provider, runModelName);
      if (!caps.vision) {
        toast.error(
          `${selectedModelLabel ? modelLabel(selectedModelLabel) : runModelName} doesn't support image input. Remove the image or switch to a vision-capable model.`,
        );
        return;
      }
    }

    const attachments = files.length > 0 ? files : undefined;
    const folderAttachments = (attachments ?? []).filter((attachment) => !!attachment.folderPath);
    const documentAttachments = (attachments ?? []).filter((attachment) => !attachment.folderPath);
    setInputText("");
    setFiles([]);

    let sessionId = activeSessionId;
    let sessionPersisted = Promise.resolve();
    let isNewSession = false;

    if (!sessionId) {
      const newSession = createSession(
        instantChatTitle(text || "Attachments"),
        pendingProjectId ?? undefined,
        isAgentTab
          ? {
              agentId:
                overrides?.agentId !== undefined
                  ? (overrides.agentId ?? undefined)
                  : (pendingAgentId ?? activeAgentConsole?.id ?? undefined),
              isSetup:
                (overrides ? !!overrides.setup : pendingSetup) || undefined,
              isTemporary: !isAgentTab && isTemporary,
            }
          : undefined,
      );
      sessionId = newSession.id;
      setActiveSessionId(newSession.id);
      // A freshly sent session opens focused — even one born in a console
      // that was showing a Preferences panel.
      setAgentConsoleFocus("session");
      setPendingProjectId(null);
      setPendingAgentId(null);
      setPendingSetup(false);
      sessionPersisted = newSession.persisted;
      isNewSession = true;
    }

    if (!sessionId) throw new Error("Failed to create session");

    const userAttachments = attachments?.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      type: a.type,
      ...(a.folderPath ? { folderPath: a.folderPath } : { storageId: a.id }),
    }));

    try {
      await sessionPersisted;
      const parentId = activePath.length > 0
        ? activePath[activePath.length - 1].message.id
        : null;
      const userMsg = await addMessage(
        sessionId,
        "user",
        text,
        undefined,
        userAttachments,
        parentId,
        isTemporary,
      );

      updateSession(sessionId, { chat_mode: chatMode, is_temporary: isTemporary });

      const modelLabelStr = selectedModelLabel
        ? modelLabel(selectedModelLabel)
        : runModelName;
      // Agent runs (agent tab + task mode) get attachment files materialized
      // in the run's deliverables folder and expressed as paths the agent can
      // read; plain chat keeps inlining extracted text (no file tools there).
      const agentFilesDir = arc?.taskProfile
        ? await ensureDeliverablesDir(sessionId)
        : undefined;
      const prep = await prepareAttachmentContext(documentAttachments, text, provider, runModelName, modelLabelStr, { filePathsDir: agentFilesDir });
      if (prep.blocked) {
        toast.error(prep.warning ?? "This model doesn't support images.");
        return;
      }
      const folderContext = folderAttachments.length
        ? `Attached folders (read files directly from disk; do not embed or re-upload the folder):\n${folderAttachments.map((folder) => `- ${folder.folderPath}`).join("\n")}`
        : "";
      const userContent: string | ContentPart[] = folderContext
        ? typeof prep.content === "string"
          ? [prep.content, folderContext].filter(Boolean).join("\n\n")
          : [...prep.content, { type: "text", text: folderContext }]
        : prep.content;

      // Agent-mode sessions are isolated: no universal memory in or out, and
      // they run on the task/agent prompt instead of the chat-tab mode prompts.
      const memoryContext =
        !arc && settings.autoMemory
          ? await buildMemoryContext(currentProjectId ?? null, text)
          : "";
      const learnContext =
        !arc && chatMode === "learn" ? buildLearnSystemPrompt(learnLevel, learnSubject) : "";

      // Project uploads (persisted files/images) are part of the context of
      // EVERY conversation in that project.
      let projectFilesText = "";
      let projectImageUrls: string[] = [];
      if (currentProjectId) {
        const project = projects.find((p) => p.id === currentProjectId);
        if (project && (project.files.length > 0 || project.images.length > 0)) {
          const filesCtx = await buildProjectFilesContext(
            project.files,
            project.images,
            text,
            provider,
            runModelName,
          );
          projectFilesText = filesCtx.text;
          if (filesCtx.skippedImages.length > 0) {
            projectFilesText += `\n\n[Project images not attached — ${modelLabelStr} has no vision: ${filesCtx.skippedImages.join(", ")}]`;
          }
          projectImageUrls = filesCtx.imageDataUrls;
        }
      }

      // Saved-agent knowledge files/images ride with EVERY run of the agent
      // (same mechanism as project files).
      let agentFilesText = "";
      let agentImageUrls: string[] = [];
      if (arc?.agent?.attachments?.length) {
        const agentAttachments = arc.agent.attachments;
        const filesCtx = await buildProjectFilesContext(
          agentAttachments.filter((a) => !a.type.startsWith("image/")),
          agentAttachments.filter((a) => a.type.startsWith("image/")),
          text,
          provider,
          runModelName,
        );
        agentFilesText = filesCtx.text;
        if (filesCtx.skippedImages.length > 0) {
          agentFilesText += `\n\n[Agent images not attached — ${modelLabelStr} has no vision: ${filesCtx.skippedImages.join(", ")}]`;
        }
        agentImageUrls = filesCtx.imageDataUrls;
      }

      const effectiveInstructions = arc
        ? [arc.instructions, projectFilesText, agentFilesText].filter(Boolean).join("\n\n") || undefined
        : [currentProjectInstructions, projectFilesText, learnContext, memoryContext]
            .filter(Boolean).join("\n\n") || undefined;

      // Rebuild attachment context for replayed history so files keep working
      // across the whole chat, not just the send they arrived on.
      const historyMessages: AgentMessage[] = [];
      for (const n of activePath) {
        if (n.message.role === "user" && (n.message.attachments?.length ?? 0) > 0) {
          const rebuilt = await rebuildAttachmentContent(n.message, provider, runModelName);
          historyMessages.push(toHistoryMessage(n.message, rebuilt ?? undefined));
        } else {
          historyMessages.push(toHistoryMessage(n.message));
        }
      }

      // Project/agent images ride along on the outgoing user message (vision models).
      let outgoingContent: string | ContentPart[] = userContent;
      const extraImageUrls = [...projectImageUrls, ...agentImageUrls];
      if (extraImageUrls.length > 0) {
        outgoingContent = [
          ...(typeof userContent === "string"
            ? [{ type: "text" as const, text: userContent }]
            : userContent),
          ...extraImageUrls.map((url) => ({
            type: "image_url" as const,
            image_url: { url, detail: "high" as const },
          })),
        ];
      }

      // Manual compaction: the summarized prefix is swapped for one summary
      // turn before the outgoing message (no-op without a compaction record).
      const runHistory = compactHistoryMessages(
        activePath.map((n) => n.message.id),
        historyMessages,
        loadSessionCompaction(sessionId),
      );

      const completionMessages: AgentMessage[] = [
        ...runHistory,
        { role: "user" as const, content: outgoingContent },
      ];

      const ctrl = getAgentController(sessionId);

      // Add the assistant message to the tree immediately and refresh it on an
      // interval so partial output survives an app crash/restart mid-run. It is
      // hidden from rendering while the live streaming bubble shows progress.
      const assistantMsg = await addMessage(
        sessionId,
        "assistant",
        "",
        runModelName,
        undefined,
        userMsg.id,
        isTemporary,
      );
      inProgressMsgIds.current.set(sessionId, assistantMsg.id);
      ctrl.inProgressMessageId = assistantMsg.id;
      let lastSaveSig = "";
      const saveInterval = setInterval(() => {
        const sig = streamSaveSignature(ctrl);
        if (sig === lastSaveSig) return;
        lastSaveSig = sig;
        updateMessage(sessionId, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          workStartedAt: ctrl.workStartedAt,
          workEndedAt: ctrl.workEndedAt,
          workDurationMs: ctrl.workDurationMs,
          workSegments: ctrl.workSegments.length ? [...ctrl.workSegments] : undefined,
          artifacts: ctrl.artifacts.length ? [...ctrl.artifacts] : undefined,
          files: ctrl.files.length ? [...ctrl.files] : undefined,
        });
      }, 2500);

      let result: AgentRunResult;
      try {
        result = await ctrl.run({
          provider,
          modelName: runModelName,
          messages: completionMessages,
          instructions: effectiveInstructions,
          mode,
          webFetchEnabled: arc ? arc.webFetch : webFetchEnabled,
          projectDir: currentProjectDirectory,
          taskProfile: arc?.taskProfile,
          availableModels: allModels.map((m) => ({ name: m.name, providerId: m.providerId, displayName: m.displayName })),
          providers,
        });
      } finally {
        clearInterval(saveInterval);
        updateMessage(sessionId, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          workStartedAt: ctrl.workStartedAt,
          workEndedAt: ctrl.workEndedAt,
          workDurationMs: ctrl.workDurationMs,
          workSegments: ctrl.workSegments.length ? [...ctrl.workSegments] : undefined,
        });
        inProgressMsgIds.current.delete(sessionId);
      }

      // An agent-builder run that created an agent: the setup conversation is
      // no longer useful, so offer to delete it.
      if (ctrl.createdAgent && sessionId) {
        setDeleteSetupDialog({ sessionId, agentName: ctrl.createdAgent.agentName });
      }

      if ((mode === "research" || mode === "council") && result.completed) {
        setChatMode("none");
        if (sessionId) updateSession(sessionId, { chat_mode: "none" });
      }

      const hasOutput = result.content || (result.activities?.length ?? 0) > 0 || (result.reasoningStreams?.length ?? 0) > 0 || (result.reasoning?.length ?? 0) > 0 || (result.artifacts?.length ?? 0) > 0 || (result.files?.length ?? 0) > 0;
      if (hasOutput) {
        updateMessage(sessionId, assistantMsg.id, {
          content: result.content,
          reasoning: result.reasoning || undefined,
          activities: result.activities,
          reasoningStreams: result.reasoningStreams,
          workStartedAt: result.workStartedAt,
          workEndedAt: result.workEndedAt,
          workDurationMs: result.workDurationMs,
          workSegments: result.workSegments,
          artifacts: result.artifacts?.length ? result.artifacts : undefined,
          files: result.files?.length ? result.files : undefined,
        });
      } else {
        deleteMessage(sessionId, assistantMsg.id);
      }

      // Title seed: for research runs result.content is only a 1-2 sentence
      // summary ("I generated a report…"), which makes the LLM title wrong.
      // Prefer the report artifact — its opening restates the topic faithfully.
      const titleSeed =
        result.artifacts?.find((a) => a.language === "markdown")?.content ||
        result.content ||
        "";

      // Title the chat on the first reply, then refresh the title every 8
      // messages so it keeps tracking where the conversation went.
      const messageCount = sessionId ? loadMessages(sessionId).length : 0;
      if (
        titleSeed &&
        (isNewSession || (messageCount > 0 && messageCount % 8 === 0))
      ) {
        generateChatTitle(provider, runModelName, text, titleSeed)
          .then((title) => {
            if (title && sessionId) {
              updateSession(sessionId, { title });
            }
          })
          .catch(() => {});
      }

      // Next-message ghost + question options: personalized by the model
      // in the background. Research mode keeps its own flow (no options).
      if (result.content && sessionId) {
        const ghostTranscript: FollowUpTranscriptEntry[] = [
          ...activePath
            .slice(-6)
            .map((n) => ({ role: n.message.role, content: n.message.content })),
          { role: "user", content: text },
          { role: "assistant", content: result.content },
        ];
        requestFollowUpGhost(
          sessionId,
          assistantMsg.id,
          provider,
          runModelName,
          ghostTranscript,
          activeSession?.title,
        );
        if (result.content.trim().endsWith("?") && chatMode !== "research") {
          requestQuestionOptions(
            sessionId,
            assistantMsg.id,
            provider,
            runModelName,
            result.content,
            ghostTranscript,
          );
        }
        requestPostRunSuggestion(sessionId, provider, runModelName, ghostTranscript, {
          allowModes: !isAgentTab,
        });
      }

      // Auto-extract durable memories (background, best-effort). Agent-mode
      // sessions never write to universal memory — they stay sandboxed.
      if (!arc && settings.autoMemory && !isTemporary && result.content) {
        void extractAndSaveMemory(provider, selectedModel, text, result.content, "global", loadMemory("global"), sessionId).catch(() => {});
        if (currentProjectId) {
          void extractAndSaveMemory(provider, selectedModel, text, result.content, currentProjectId, loadMemory(currentProjectId), sessionId).catch(() => {});
        }
      }
    } catch (err) {
      toast.error(
        flattenAgentError(err) || "Failed to send message",
      );
    }
  };

  const handleStop = () => {
    agent?.stop();
  };

  /**
   * Refuse to start a run while another app context is mid-run in this chat:
   * its in-progress record is fresh and unfinalized (another window/instance,
   * or a device syncing in). Starting anyway would interleave two runs into
   * one session. Returns true when the send was blocked.
   */
  const blockIfRunActiveElsewhere = (sessionId: string | null | undefined): boolean => {
    if (!sessionId) return false;
    if (!findActiveRunMessage(loadMessages(sessionId))) return false;
    toast.error(
      "This chat is already running in another app window or on another device — wait for it to finish, or stop it there first.",
    );
    return true;
  };

  // Sending while a structured-input form is pending switches back to free
  // text: the interrupted run is cancelled, the typed message waits for the
  // next send click. While editing a message, the send action saves the edit.
  const handleModeSend = () => {
    if (agent?.pendingInput) {
      agent?.skipInput();
      return;
    }
    if (editingMessageId) {
      const msg = activePath.find((n) => n.message.id === editingMessageId)?.message;
      if (msg) void handleSaveEdit(msg);
      return;
    }
    handleSend();
  };

  const handleProjectModeSend = (text: string) => {
    handleProjectSend(text);
  };

  const handleCopyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  /**
   * Editing happens in the regular composer: the message's text and
   * attachments move into the composer, the rest of the conversation fades
   * (see renderMessage), and the bubble mirrors the composer live. The
   * draft that was in the composer is stashed and restored afterwards.
   */
  const handleStartEdit = async (msg: ChatMessage) => {
    // The composer must be the regular textarea for an edit (not a pending
    // approval/input card), and only one run may be in flight.
    if (
      agent?.isRunning ||
      !!agent?.pendingInput ||
      (agent?.pendingApprovals.length ?? 0) > 0 ||
      !!agent?.pendingSuggestion
    ) {
      return;
    }
    editDraftRef.current = { text: inputText, files };
    editSessionRef.current = msg.id;
    setEditingMessageId(msg.id);
    setInputText(msg.content);
    requestAnimationFrame(() => sessionTextareaRef.current?.focus());
    // Rehydrate stored attachments into real Files so the edit re-run can
    // prepare them exactly like a fresh send (cached previews are reused).
    const rehydrated: PendingFile[] = [];
    for (const a of msg.attachments ?? []) {
      if (a.folderPath) {
        rehydrated.push({ ...a });
        continue;
      }
      const storageId = a.storageId ?? a.id;
      let file: File | undefined;
      try {
        const blob = await getFileBlob(storageId);
        if (blob) file = new File([blob], a.name, { type: a.type || blob.type });
      } catch {
        // Blob missing (evicted) — keep the chip, save will skip its bytes.
      }
      rehydrated.push({
        ...a,
        storageId,
        previewUrl: a.previewUrl ?? attachmentPreviews.get(a.id),
        file,
      });
    }
    if (editSessionRef.current !== msg.id) return;
    setFiles(rehydrated);
  };

  const handleCancelEdit = () => {
    const draft = editDraftRef.current;
    editDraftRef.current = null;
    editSessionRef.current = null;
    setEditingMessageId(null);
    setInputText(draft?.text ?? "");
    setFiles(draft?.files ?? []);
  };

  const handleSaveEdit = async (msg: ChatMessage) => {
    const text = inputText.trim();
    if (!text || !activeSessionId) return;
    if (blockIfRunActiveElsewhere(activeSessionId)) return;
    const editedFiles = files;

    const arc = isAgentTab
      ? await agentRunContext({
          agentId: activeSession?.agentId,
          isSetup: activeSession?.isSetup === true,
        })
      : chatMode === "learn" || chatMode === "research" || chatMode === "council"
        ? null
        : await agentRunContext({});
    const runModelName = arc?.model ?? selectedModel;
    const provider = runModelName ? findProviderForModel(runModelName) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      openSettings();
      return;
    }

    // Attachment context for the re-run, prepared like a fresh send.
    const attachments = editedFiles.length > 0 ? editedFiles : undefined;
    const folderAttachments = (attachments ?? []).filter((attachment) => !!attachment.folderPath);
    const documentAttachments = (attachments ?? []).filter((attachment) => !attachment.folderPath);
    const modelLabelStr = selectedModelLabel
      ? modelLabel(selectedModelLabel)
      : runModelName;
    const agentFilesDir = arc?.taskProfile
      ? await ensureDeliverablesDir(activeSessionId)
      : undefined;
    const prep = await prepareAttachmentContext(
      documentAttachments,
      text,
      provider,
      runModelName,
      modelLabelStr,
      { filePathsDir: agentFilesDir },
    );
    if (prep.blocked) {
      toast.error(prep.warning ?? "This model doesn't support images.");
      return;
    }
    const userAttachments = attachments?.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      type: a.type,
      ...(a.folderPath ? { folderPath: a.folderPath } : { storageId: a.storageId ?? a.id }),
    }));

    // Commit: the composer contents become the edited message and the
    // stashed draft returns; the conversation unfades.
    const draft = editDraftRef.current;
    editDraftRef.current = null;
    editSessionRef.current = null;
    setEditingMessageId(null);
    setInputText(draft?.text ?? "");
    setFiles(draft?.files ?? []);

    try {
      const parentId = msg.parent_id ?? null;
      const userMsg = await addMessage(
        activeSessionId,
        "user",
        folderAttachments.length
          ? `${text}\n\nAttached folders (read directly from disk):\n${folderAttachments.map((folder) => `- ${folder.folderPath}`).join("\n")}`
          : text,
        undefined,
        userAttachments,
        parentId,
        isTemporary,
      );

      updateSession(activeSessionId, { chat_mode: chatMode, is_temporary: isTemporary });

      const completionMessages: AgentMessage[] = [];
      const pathToParent = activePath.slice(
        0,
        activePath.findIndex((n) => n.message.id === msg.id),
      );
      for (const n of pathToParent) {
        if (n.message.role === "user" && (n.message.attachments?.length ?? 0) > 0) {
          const rebuilt = await rebuildAttachmentContent(n.message, provider, runModelName);
          completionMessages.push(toHistoryMessage(n.message, rebuilt ?? undefined));
        } else {
          completionMessages.push(toHistoryMessage(n.message));
        }
      }
      const runHistory = compactHistoryMessages(
        pathToParent.map((n) => n.message.id),
        completionMessages,
        loadSessionCompaction(activeSessionId),
      );
      const editedFolderContext = folderAttachments.length
        ? `Attached folders (read directly from disk):\n${folderAttachments.map((folder) => `- ${folder.folderPath}`).join("\n")}`
        : "";
      runHistory.push({ role: "user" as const, content: editedFolderContext
        ? typeof prep.content === "string"
          ? `${prep.content}\n\n${editedFolderContext}`
          : [...prep.content, { type: "text", text: editedFolderContext }]
        : prep.content });

      const ctrl = getAgentController(activeSessionId!);
      const assistantMsg = await addMessage(
        activeSessionId,
        "assistant",
        "",
        runModelName,
        undefined,
        userMsg.id,
        isTemporary,
      );
      inProgressMsgIds.current.set(activeSessionId, assistantMsg.id);
      ctrl.inProgressMessageId = assistantMsg.id;
      let lastSaveSig = "";
      const saveInterval = setInterval(() => {
        const sig = streamSaveSignature(ctrl);
        if (sig === lastSaveSig) return;
        lastSaveSig = sig;
        updateMessage(activeSessionId, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          workStartedAt: ctrl.workStartedAt,
          workEndedAt: ctrl.workEndedAt,
          workDurationMs: ctrl.workDurationMs,
          workSegments: ctrl.workSegments.length ? [...ctrl.workSegments] : undefined,
          artifacts: ctrl.artifacts.length ? [...ctrl.artifacts] : undefined,
          files: ctrl.files.length ? [...ctrl.files] : undefined,
        });
      }, 2500);

      let result: AgentRunResult;
      try {
        result = await ctrl.run({
          provider,
          modelName: runModelName,
          reasoningEffort,
          messages: runHistory,
          instructions: arc ? arc.instructions : currentProjectInstructions || undefined,
          mode: arc?.mode,
          webFetchEnabled: arc ? arc.webFetch : webFetchEnabled,
          projectDir: currentProjectDirectory,
          taskProfile: arc?.taskProfile,
        });
      } finally {
        clearInterval(saveInterval);
        updateMessage(activeSessionId, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          workStartedAt: ctrl.workStartedAt,
          workEndedAt: ctrl.workEndedAt,
          workDurationMs: ctrl.workDurationMs,
          workSegments: ctrl.workSegments.length ? [...ctrl.workSegments] : undefined,
        });
        inProgressMsgIds.current.delete(activeSessionId);
      }

      const hasOutput = result.content || (result.activities?.length ?? 0) > 0 || (result.reasoningStreams?.length ?? 0) > 0 || (result.reasoning?.length ?? 0) > 0 || (result.artifacts?.length ?? 0) > 0 || (result.files?.length ?? 0) > 0;
      if (hasOutput) {
        updateMessage(activeSessionId, assistantMsg.id, {
          content: result.content,
          reasoning: result.reasoning || undefined,
          activities: result.activities,
          reasoningStreams: result.reasoningStreams,
          workStartedAt: result.workStartedAt,
          workEndedAt: result.workEndedAt,
          workDurationMs: result.workDurationMs,
          workSegments: result.workSegments,
          artifacts: result.artifacts?.length ? result.artifacts : undefined,
          files: result.files?.length ? result.files : undefined,
        });
      } else {
        deleteMessage(activeSessionId, assistantMsg.id);
      }
    } catch (err) {
      toast.error(
        flattenAgentError(err) || "Failed to regenerate response",
      );
    }
  };

  const handleRegenerate = async (msg: ChatMessage) => {
    if (!activeSessionId || agent?.isRunning) return;
    if (blockIfRunActiveElsewhere(activeSessionId)) return;

    const arc = isAgentTab
      ? await agentRunContext({
          agentId: activeSession?.agentId,
          isSetup: activeSession?.isSetup === true,
        })
      : chatMode === "learn" || chatMode === "research" || chatMode === "council"
        ? null
        : await agentRunContext({});
    const runModelName = arc?.model ?? selectedModel;
    const provider = runModelName ? findProviderForModel(runModelName) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      openSettings();
      return;
    }

    try {
      const parentId = msg.parent_id ?? null;
      const msgIsTemporary = msg.is_temporary ?? false;

      const completionMessages: AgentMessage[] = [];
      const pathToParent = activePath.slice(
        0,
        activePath.findIndex((n) => n.message.id === msg.id),
      );
      for (const n of pathToParent) {
        if (n.message.role === "user" && (n.message.attachments?.length ?? 0) > 0) {
          const rebuilt = await rebuildAttachmentContent(n.message, provider, runModelName);
          completionMessages.push(toHistoryMessage(n.message, rebuilt ?? undefined));
        } else {
          completionMessages.push(toHistoryMessage(n.message));
        }
      }
      // A cut-off reply (empty text, but thought process / findings /
      // artifacts recorded) rides along so the new run continues the thinking
      // instead of starting blind. Non-empty replies stay excluded —
      // regenerating those means redoing the answer, not continuing it.
      if (
        !msg.content.trim() &&
        (msg.reasoning ||
          (msg.reasoningStreams?.length ?? 0) > 0 ||
          (msg.activities?.length ?? 0) > 0 ||
          (msg.artifacts?.length ?? 0) > 0)
      ) {
        completionMessages.push(toHistoryMessage(msg));
      }

      // Manual compaction: the summarized prefix is swapped for one summary
      // turn (no-op without a compaction record, or when its anchor is not
      // within the replayed path).
      const runHistory = compactHistoryMessages(
        pathToParent.map((n) => n.message.id),
        completionMessages,
        loadSessionCompaction(activeSessionId),
      );

      const ctrl = getAgentController(activeSessionId);
      const assistantMsg = await addMessage(
        activeSessionId,
        "assistant",
        "",
        runModelName,
        undefined,
        parentId,
        msgIsTemporary,
      );
      inProgressMsgIds.current.set(activeSessionId, assistantMsg.id);
      ctrl.inProgressMessageId = assistantMsg.id;
      let lastSaveSig = "";
      const saveInterval = setInterval(() => {
        const sig = streamSaveSignature(ctrl);
        if (sig === lastSaveSig) return;
        lastSaveSig = sig;
        updateMessage(activeSessionId, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          workStartedAt: ctrl.workStartedAt,
          workEndedAt: ctrl.workEndedAt,
          workDurationMs: ctrl.workDurationMs,
          workSegments: ctrl.workSegments.length ? [...ctrl.workSegments] : undefined,
          artifacts: ctrl.artifacts.length ? [...ctrl.artifacts] : undefined,
          files: ctrl.files.length ? [...ctrl.files] : undefined,
        });
      }, 2500);

      let result: AgentRunResult;
      try {
        result = await ctrl.run({
          provider,
          modelName: runModelName,
          reasoningEffort,
          messages: runHistory,
          instructions: arc ? arc.instructions : currentProjectInstructions || undefined,
          mode: arc?.mode,
          webFetchEnabled: arc ? arc.webFetch : webFetchEnabled,
          projectDir: currentProjectDirectory,
          taskProfile: arc?.taskProfile,
        });
      } finally {
        clearInterval(saveInterval);
        updateMessage(activeSessionId, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          workStartedAt: ctrl.workStartedAt,
          workEndedAt: ctrl.workEndedAt,
          workDurationMs: ctrl.workDurationMs,
          workSegments: ctrl.workSegments.length ? [...ctrl.workSegments] : undefined,
        });
        inProgressMsgIds.current.delete(activeSessionId);
      }

      const hasOutput = result.content || (result.activities?.length ?? 0) > 0 || (result.reasoningStreams?.length ?? 0) > 0 || (result.reasoning?.length ?? 0) > 0 || (result.artifacts?.length ?? 0) > 0 || (result.files?.length ?? 0) > 0;
      if (hasOutput) {
        updateMessage(activeSessionId, assistantMsg.id, {
          content: result.content,
          reasoning: result.reasoning || undefined,
          activities: result.activities,
          reasoningStreams: result.reasoningStreams,
          workStartedAt: result.workStartedAt,
          workEndedAt: result.workEndedAt,
          workDurationMs: result.workDurationMs,
          workSegments: result.workSegments,
          artifacts: result.artifacts?.length ? result.artifacts : undefined,
          files: result.files?.length ? result.files : undefined,
        });
      } else {
        deleteMessage(activeSessionId, assistantMsg.id);
      }
      updateSession(activeSessionId, {});
    } catch (err) {
      toast.error(
        flattenAgentError(err) || "Failed to regenerate response",
      );
    }
  };

  const handleBranchNavigate = (msg: ChatMessage, direction: "prev" | "next") => {
    const { siblings, currentIndex } = getSiblings(nodeMap, msg, roots);
    if (siblings.length <= 1) return;

    let newIndex: number;
    if (direction === "prev") {
      newIndex = currentIndex > 0 ? currentIndex - 1 : siblings.length - 1;
    } else {
      newIndex = currentIndex < siblings.length - 1 ? currentIndex + 1 : 0;
    }

    const newSibling = siblings[newIndex];
    setSelectedChildMap((prev) => {
      const next = new Map(prev);
      next.set(msg.parent_id ?? null, newSibling.message.id);
      return next;
    });
  };

  const toggleRawOutput = (msgId: string) => {
    setShowRawOutput((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  // Restore the per-session composer mode (Learn stays on until turned off).
  // Called imperatively on navigation — NOT from an effect — so creating a
  // session inside handleSend can never race the restore.
  const applySessionChatMode = (sessionId: string | null) => {
    const stored = getSessionChatMode(sessionId);
    // "temporary" used to be stored as the chat mode; it's a whole-chat flag
    // now, orthogonal to the mode. "task" (the removed Agentic toggle) maps
    // back to the default mode — every send is agentic now.
    setTemporary(stored === "temporary" || getSessionTemporary(sessionId));
    setChatMode(
      stored && stored !== "temporary" && stored !== "task" ? stored : "none",
    );
    // New empty chat: honor "temporary chats by default".
    if (!sessionId && settings.temporaryByDefault) setTemporary(true);
    autoModeRef.current = "none";
  };

  // Whole-chat temporary flag (the + composer menu switch). Only settable
  // while the chat has no messages — it locks once the conversation starts.
  const toggleTemporary = (on: boolean) => {
    setTemporary(on);
    if (activeSessionId) {
      void updateSession(activeSessionId, { is_temporary: on });
    }
  };

  // ── Leaving a temporary chat ─────────────────────────────────────────────
  // Temporary is a whole-chat property: the toggle locks once the
  // conversation starts, and leaving the conversation forgets it unless it's
  // explicitly saved as a normal chat. Every navigation away from the active
  // session goes through this gate.

  const withTemporaryLeaveWarning = (proceed: () => void) => {
    if (activeSessionId && messages.some((m) => m.is_temporary)) {
      setPendingLeave({ sessionId: activeSessionId, proceed });
      return;
    }
    proceed();
  };

  const stayInTemporaryChat = () => setPendingLeave(null);

  const saveChatAndLeave = () => {
    if (!pendingLeave) return;
    const { sessionId, proceed } = pendingLeave;
    // Keep every message (clear the temporary flags) and store the chat as a
    // normal one, then continue the interrupted navigation. The navigation's
    // own deleteTemporaryMessages becomes a no-op.
    markMessagesPermanent(sessionId);
    updateSession(sessionId, { chat_mode: "none", is_temporary: false });
    setPendingLeave(null);
    proceed();
  };

  const discardChatAndLeave = () => {
    if (!pendingLeave) return;
    const { sessionId, proceed } = pendingLeave;
    setPendingLeave(null);
    // Remove the in-memory session as well as its temporary messages. This
    // also prevents a title-only entry from surviving in the current sidebar.
    void deleteSession(sessionId);
    proceed();
  };

  const handleNewChat = () => {
    withTemporaryLeaveWarning(() => {
    if (activeSessionId) {
      deleteTemporaryMessages(activeSessionId);
    }
    setActiveSessionId(null);
    setActiveProjectId(null);
    setPendingProjectId(null);
    applySessionChatMode(null);
    setView("chat");
    setWelcomePrompt(
      WELCOME_PROMPTS[Math.floor(Math.random() * WELCOME_PROMPTS.length)],
    );
    });
  };

  const selectSession = (id: string) => {
    // Sessions moved to the Agents tab stay listed in the chat sidebar
    // (grayed out); clicking one shows the redirect notice instead.
    if (!isAgentTab) {
      const target = sessions.find((s) => s.id === id);
      if (target?.movedToAgent) {
        setMovedNoticeId(id);
        return;
      }
    }
    withTemporaryLeaveWarning(() => {
      if (activeSessionId && activeSessionId !== id) {
        deleteTemporaryMessages(activeSessionId);
      }
      setActiveSessionId(id);
      setActiveProjectId(null);
      // A selected session defines its own agent context — drop any pending
      // one (e.g. from an open agent console or "New session").
      setPendingAgentId(null);
      setPendingSetup(false);
      setAgentConsoleComposing(false);
      setAgentConsoleFocus("session");
      applySessionChatMode(id);
      setView("chat");
    });
  };

  const handleDeleteSession = async (id: string) => {
    try {
      // Clean up the session's stored attachment bytes along with it.
      for (const m of loadMessages(id)) {
        for (const a of m.attachments ?? []) {
          if (a.storageId) void deleteFileBlob(a.storageId);
        }
      }
      disposeAgentController(id);
      await deleteSession(id);
      if (activeSessionId === id) {
        setActiveSessionId(null);
        applySessionChatMode(null);
      }
    } catch (err) {
      toast.error("Failed to delete chat");
    }
  };

  const handleDeleteSelectedSessions = async () => {
    for (const id of historySelectedIds) {
      await handleDeleteSession(id);
    }
    setHistorySelectedIds(new Set());
  };

  // ── Agents tab navigation ───────────────────────────────────────────────

  /**
   * Assign an agent-tab session to an agent — or unassign it ("Remove from
   * agent"), which moves the session to the Chat tab as a task-mode chat:
   * the Agents tab only holds sessions with an agent assigned. The user
   * follows a moved session to its new home.
   */
  const handleMoveSessionToAgent = async (sessionId: string, agentId: string | null) => {
    if (agentId) {
      await updateSession(sessionId, { agent_id: agentId });
      return;
    }
    const target = sessions.find((s) => s.id === sessionId);
    if (!target || target.type !== "agent" || !target.agentId) return;
    if (runningIds.has(sessionId)) {
      toast.error("Wait for the current run to finish before moving it.");
      return;
    }
    await moveToChatTab(sessionId);
    setActiveSessionByTab((prev) => ({
      chat: sessionId,
      agent: prev.agent === sessionId ? null : prev.agent,
    }));
    setPendingAgentId(null);
    setPendingSetup(false);
    setActiveAgentConsoleId(null);
    setActiveTab("chat");
    setAgentConsoleFocus("session");
    applySessionChatMode(sessionId);
    setView("chat");
    toast.success("Moved to Chats as a task");
  };

  /** Open a moved session from the chat-tab redirect notice. */
  const openMovedSession = (id: string) => {
    withTemporaryLeaveWarning(() => {
      if (activeSessionId && activeSessionId !== id) {
        deleteTemporaryMessages(activeSessionId);
      }
      setActiveSessionByTab((prev) => ({
        chat: prev.chat === id ? null : prev.chat,
        agent: id,
      }));
      setPendingProjectId(null);
      setPendingAgentId(null);
      setPendingSetup(false);
      setActiveTab("agent");
      setAgentConsoleFocus("session");
      setChatMode("none");
      autoModeRef.current = "none";
      setView("chat");
    });
  };

  const switchTab = (tab: "chat" | "agent") => {
    if (tab === activeTab) return;
    withTemporaryLeaveWarning(() => {
      if (activeSessionId) {
        deleteTemporaryMessages(activeSessionId);
      }
      setPendingAgentId(null);
      setPendingSetup(false);
      setActiveTab(tab);
      setAgentConsoleFocus("session");
      setAgentDashboardOpen(tab === "agent");
      // Each tab keeps its own active session; restore that session's mode.
      applySessionChatMode(activeSessionByTab[tab] ?? null);
      setView("chat");
    });
  };

  // App-wide keyboard shortcuts: ⌘1/⌘2 jump to the Chat / Agents page, ⌘N
  // starts a new chat, Ctrl+Tab / Ctrl+Shift+Tab cycle through the open chats
  // and "/" focuses the composer. The handlers go through a ref so the
  // listener attaches once and still sees fresh state.
  const appShortcutsRef = useRef({
    switchTab,
    handleNewChat,
    selectSession,
    sessions,
    activeSessionId,
    activeTab,
    pendingLeave,
  });
  appShortcutsRef.current = {
    switchTab,
    handleNewChat,
    selectSession,
    sessions,
    activeSessionId,
    activeTab,
    pendingLeave,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = appShortcutsRef.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        const tab = e.key === "1" ? "chat" : "agent";
        if (s.activeTab !== tab) s.switchTab(tab);
        else setView("chat");
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        s.handleNewChat();
        return;
      }
      // "/" activates the composer (new chat or open chat). Match the physical
      // key too: on non-US layouts e.key is often not "/" (e.g. a Polish
      // layout puts "/" on Shift+7), while e.code stays layout-independent.
      // Typing elsewhere (inputs, textareas, editable content) keeps the slash.
      if ((e.key === "/" || e.code === "Slash") && !mod && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        const textarea = sessionTextareaRef.current ?? emptyTextareaRef.current;
        if (!textarea) return;
        e.preventDefault();
        textarea.focus();
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        // A leave-temporary-chat dialog owns the navigation while it's open.
        if (s.pendingLeave) return;
        const list = s.sessions.filter((session) => !session.movedToAgent);
        if (list.length === 0) return;
        const idx = list.findIndex((session) => session.id === s.activeSessionId);
        const next = e.shiftKey
          ? list[idx <= 0 ? list.length - 1 : idx - 1]
          : list[idx === -1 || idx === list.length - 1 ? 0 : idx + 1];
        s.selectSession(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Start a new session with an agent (sidebar agent → ⋯ → New session):
   * opens the agent's console on its new-session page. The first send
   * creates the session there.
   */
  const handleStartAgentSession = (agentId: string) => {
    handleOpenAgentConsole(agentId);
    setAgentConsoleComposing(true);
  };

  /**
   * Enter the open console's new-session page. Works from anywhere in the
   * console — even mid-session: the session is left (it keeps running) and
   * the next send is wired to this agent.
   */
  const enterAgentCompose = () => {
    // The console may resolve through the open session (dashboard → session,
    // moved chats) without activeAgentConsoleId being set. Pin the console
    // explicitly — otherwise clearing the session below drops the console
    // lookup and the dashboard opens instead of the new-session page.
    const agentId = activeAgentConsole?.id ?? activeSession?.agentId;
    if (!agentId || !agents.some((a) => a.id === agentId)) return;
    withTemporaryLeaveWarning(() => {
      if (activeSessionId) {
        deleteTemporaryMessages(activeSessionId);
      }
      setActiveSessionId(null);
      setActiveAgentConsoleId(agentId);
      setPendingAgentId(agentId);
      setPendingSetup(false);
      setAgentDashboardOpen(false);
      setAgentConsoleComposing(true);
    });
  };

  /**
   * Open an agent's console (clicking the agent in the sidebar): the sidebar
   * switches to the agent's detail view (Back to agents, Preferences tabs,
   * Sessions) and the main area shows the selected panel plus a composer.
   * The composer sends with this agent, so the first send opens a session.
   */
  const handleOpenAgentConsole = (agentId: string) => {
    withTemporaryLeaveWarning(() => {
      if (activeSessionId) {
        deleteTemporaryMessages(activeSessionId);
      }
      setActiveSessionId(null);
      setActiveProjectId(null);
      setPendingProjectId(null);
      setPendingAgentId(agentId);
      setPendingSetup(false);
      setActiveAgentConsoleId(agentId);
      setAgentDashboardOpen(false);
      setAgentConsoleTab("general");
      setAgentConsoleComposing(false);
      setAgentConsoleFocus("panel");
      applySessionChatMode(null);
      setView("chat");
    });
  };

  /**
   * Leave the agent console back to the fleet dashboard. An open agent
   * session does not survive this — the dashboard opens instead of the
   * session, since agent sessions only live inside their console.
   */
  const closeAgentConsole = () => {
    withTemporaryLeaveWarning(() => {
      if (activeSessionId) {
        deleteTemporaryMessages(activeSessionId);
      }
      setActiveSessionId(null);
      setActiveAgentConsoleId(null);
      setPendingAgentId(null);
      setPendingSetup(false);
      setAgentConsoleComposing(false);
      setAgentConsoleFocus("session");
      setAgentDashboardOpen(true);
      applySessionChatMode(null);
      setView("chat");
    });
  };

  /** Return to the fleet dashboard from wherever we are on the Agents tab. */
  const handleOpenDashboard = () => {
    withTemporaryLeaveWarning(() => {
      if (activeSessionId) {
        deleteTemporaryMessages(activeSessionId);
      }
      setActiveSessionId(null);
      setActiveProjectId(null);
      setPendingProjectId(null);
      setPendingAgentId(null);
      setPendingSetup(false);
      setActiveAgentConsoleId(null);
      setAgentDashboardOpen(true);
      applySessionChatMode(null);
      setView("chat");
    });
  };

  const handleDeleteAgent = (id: string) => {
    const def = agents.find((a) => a.id === id);
    // Cascade: every chat/session with this agent is deleted alongside it —
    // same per-session cleanup as deleting a chat, then one storage drop.
    const doomedIds = new Set(agentSessionIds(allSessions, id));
    for (const sid of doomedIds) {
      for (const m of loadMessages(sid)) {
        for (const a of m.attachments ?? []) {
          if (a.storageId) void deleteFileBlob(a.storageId);
        }
      }
      disposeAgentController(sid);
    }
    deleteStoredSessions([...doomedIds]);
    // Clean up the agent's knowledge-file blobs and on-disk workspace.
    if (def) {
      for (const att of def.attachments ?? []) {
        void deleteFileBlob(att.storageId ?? att.id);
      }
      void removeAgentWorkspace(id);
    }
    deleteAgent(id);
    if (activeSessionId && doomedIds.has(activeSessionId)) {
      setActiveSessionId(null);
      applySessionChatMode(null);
    }
    if (agentSettingsId === id) setAgentSettingsId(null);
    if (activeAgentConsoleId === id) setActiveAgentConsoleId(null);
    toast(
      doomedIds.size > 0
        ? `Agent deleted (${doomedIds.size} session${doomedIds.size === 1 ? "" : "s"} deleted too)`
        : "Agent deleted",
    );
  };

  /**
   * Apply an agent_config suggestion card: the agent proposed a settings
   * change mid-chat and the user clicked "Apply changes".
   */
  const handleApplyAgentConfig = (agentId: string, patch: AgentConfigPatch) => {
    let applied = applyAgentConfigPatch(agentId, patch);
    if (!applied) {
      // The model may have passed the agent's name instead of its id —
      // resolve via the active/pending session's agent.
      const fallbackId = currentAgentDef?.id ?? pendingAgentId;
      if (fallbackId && fallbackId !== agentId) {
        applied = applyAgentConfigPatch(fallbackId, patch);
      }
    }
    if (applied) {
      toast.success(`Updated ${applied.name}`);
    } else {
      toast.error("Agent not found — it may have been deleted");
    }
  };

  const assignProject = (projectId: string | undefined) => {
    if (activeSessionId) {
      updateSession(activeSessionId, { project_id: projectId ?? null });
      if (projectId) {
        const project = projects.find((p) => p.id === projectId);
        toast(project ? `Added to ${project.name}` : "Project assigned");
      } else {
        toast("Removed from project");
      }
    } else {
      setPendingProjectId(projectId ?? null);
      if (projectId) {
        const project = projects.find((p) => p.id === projectId);
        toast(project ? `Next chat will be in ${project.name}` : "Project assigned");
      }
    }
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // ⌘U opens the file picker, ⌘J the folder picker. pickFolder goes through a
  // ref so the listener can attach once without going stale.
  const pickFolderRef = useRef(pickFolder);
  pickFolderRef.current = pickFolder;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "u") {
        e.preventDefault();
        fileInputRef.current?.click();
      } else if (e.key === "j") {
        e.preventDefault();
        void pickFolderRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const selectedModelLabel = allModels.find((m) => m.name === selectedModel);
  const selectedModelProvider = selectedModelLabel
    ? providers.find((p) => p.id === selectedModelLabel.providerId)
    : undefined;
  const selectedReasoningKey = selectedModelLabel && selectedModelProvider
    ? `${selectedModelProvider.id}:${selectedModelLabel.name}`
    : "";
  useEffect(() => {
    let current = true;
    setResolvedReasoningSupport(null);
    if (!selectedModelLabel || !selectedModelProvider) return () => { current = false; };
    void getModelReasoning(selectedModelProvider, selectedModelLabel.name)
      .then((support) => {
        if (current) setResolvedReasoningSupport({ key: selectedReasoningKey, support });
      })
      .catch(() => {});
    return () => { current = false; };
  }, [selectedReasoningKey, selectedModelLabel?.name, selectedModelProvider]);

  // Prefer provider-native capabilities when available (Anthropic publishes
  // them with its model list), then use the models.dev catalog and fallbacks.
  const reasoningSupport =
    selectedModelLabel && selectedModelProvider
      ? (resolvedReasoningSupport?.key === selectedReasoningKey
          ? resolvedReasoningSupport.support
          : getModelReasoningSync(selectedModelProvider, selectedModelLabel.name))
      : null;

  /** Attached files whose type the selected model can't read (models.dev). */
  const unsupportedAttachments = useMemo(() => {
    if (!selectedModelLabel || !selectedModelProvider || files.length === 0) return [];
    const caps = getModelCapabilitiesSync(selectedModelProvider, selectedModelLabel.name);
    // Heuristic-only detection would produce false warnings — stay quiet.
    if (caps.source === "heuristic") return [];
    return files
      .map((f) => ({ name: f.name, modality: fileModality(f) }))
      .filter(({ modality }) =>
        modality === "image" ? !caps.vision : !caps.inputModalities.includes(modality),
      );
  }, [files, selectedModelLabel, selectedModelProvider]);

  const logoKeyFor = (m: (typeof allModels)[number]) =>
    getProviderMeta(m.builtinKey ?? "custom")?.logoKey ?? "custom";

  /** Composer label: manual name wins, else the models.dev display name. */
  const modelNameFor = (m: (typeof allModels)[number]) => {
    const provider = providers.find((p) => p.id === m.providerId);
    return modelLabelWithCatalog(
      m,
      provider ? getModelDisplayNameSync(provider, m.name) : null,
    );
  };

  // A discrete slider uses only the effort values published for this model.
  // There is no "Default" slot: an unset session resolves to the model's
  // middle tier and the slider shows that exact level. A separate off
  // position is offered only for known toggle API dialects; toggle-only
  // models (no effort scale) get an explicit On/Off pair instead.
  const reasoningProtocol = reasoningToggleProtocolForBaseUrl(
    selectedModelProvider?.baseUrl ?? "",
    selectedModelLabel?.name ?? "",
  );
  const reasoningOptions: Array<{ value: ReasoningEffort; label: string }> = (() => {
    if (!reasoningSupport?.reasoning) return [];
    const opts: Array<{ value: ReasoningEffort; label: string }> = [];
    const values = [...reasoningSupport.efforts];
    if (reasoningSupport.toggle && reasoningProtocol && !values.includes("none")) {
      values.push("none");
    }
    values.sort((a, b) => reasoningEffortRank(a) - reasoningEffortRank(b));
    for (const v of values) opts.push({ value: v, label: reasoningLabel(v) });
    if (opts.length === 0 && reasoningSupport.toggle && reasoningProtocol) {
      opts.push({ value: "none", label: reasoningLabel("none") });
      opts.push({ value: "default", label: reasoningLabel("default") });
    }
    return opts;
  })();
  const thinkingBudget = reasoningSupport?.thinkingBudget;
  const requestedBudgetMatch = reasoningEffort.match(/^budget:(\d+)$/);
  const requestedBudget = requestedBudgetMatch ? Number(requestedBudgetMatch[1]) : undefined;
  // Unset sessions resolve to the middle of the published token range, so a
  // fresh chat always shows (and sends) a concrete budget.
  const defaultBudget = thinkingBudget
    ? Math.round((thinkingBudget.min + thinkingBudget.max) / 2)
    : undefined;
  const selectedBudget = thinkingBudget
    ? requestedBudget !== undefined
      ? Math.max(thinkingBudget.min, Math.min(thinkingBudget.max, requestedBudget))
      : defaultBudget
    : undefined;
  const hasBudgetToggle = Boolean(thinkingBudget && reasoningSupport?.toggle && reasoningProtocol);
  const budgetSliderMin = hasBudgetToggle ? -2 : 0;
  const budgetSliderValue = reasoningEffort === "none" && hasBudgetToggle
    ? -2
    : selectedBudget !== undefined && thinkingBudget
      ? Math.round(((selectedBudget - thinkingBudget.min) / (thinkingBudget.max - thinkingBudget.min)) * 100)
      : 0;
  const budgetDisplay = reasoningEffort === "none" && hasBudgetToggle
    ? "Off"
    : selectedBudget !== undefined
      ? `${selectedBudget.toLocaleString()} tokens`
      : "Default";
  // The slider position reflects the level that will actually be sent: an
  // unset ("default") session shows the model's middle tier.
  const resolvedDefaultEffort = resolveDefaultReasoningEffort(reasoningSupport);
  const selectedReasoningEffort = reasoningOptions.some((option) => option.value === reasoningEffort)
    ? reasoningEffort
    : reasoningOptions.some((option) => option.value === resolvedDefaultEffort)
      ? resolvedDefaultEffort!
      : reasoningOptions.find(
          (option) => option.value === sanitizeReasoningEffort(reasoningEffort, reasoningSupport),
        )?.value ?? "default";
  const selectedReasoningIndex = Math.max(
    0,
    reasoningOptions.findIndex((option) => option.value === selectedReasoningEffort),
  );
  const effortSliderPercent = reasoningOptions.length > 1
    ? (selectedReasoningIndex / (reasoningOptions.length - 1)) * 100
    : 0;
  const budgetSliderPercent = ((budgetSliderValue - budgetSliderMin) / (100 - budgetSliderMin)) * 100;
  // Compact "which level is it on" label shown next to the model name in the
  // composer (e.g. "GLM 5.3 · Medium").
  const effortButtonLabel = (() => {
    if (!reasoningSupport?.reasoning) return null;
    if (thinkingBudget) {
      if (reasoningEffort === "none" && hasBudgetToggle) return "Off";
      if (selectedBudget === undefined) return null;
      return selectedBudget >= 1000
        ? `${Math.round(selectedBudget / 1000)}k tokens`
        : `${selectedBudget} tokens`;
    }
    if (reasoningOptions.length === 0) return null;
    return reasoningLabel(selectedReasoningEffort);
  })();
  const sliderLabelStyle = (percent: number) => ({
    left: `${percent}%`,
    transform: percent <= 8 ? "translateX(0)" : percent >= 92 ? "translateX(-100%)" : "translateX(-50%)",
  });

  const changeReasoningEffort = (effort: ReasoningEffort) => {
    setReasoningEffort(effort);
    if (activeSessionId) {
      void updateSession(activeSessionId, { reasoning_effort: effort });
    }
  };

  const reasoningSupportLoaded = resolvedReasoningSupport?.key === selectedReasoningKey;
  const reasoningSupportLoading = Boolean(
    selectedModelLabel && selectedModelProvider && !reasoningSupport && !reasoningSupportLoaded,
  );
  const thinkingControl = (
    <div
      className="min-w-72 shrink-0 bg-popover px-3 py-2.5"
      aria-label="Thinking effort"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {reasoningSupportLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">Checking this model’s supported options…</p>
      ) : !reasoningSupport ? (
        <p className="mt-2 text-xs text-muted-foreground">Thinking options are unavailable for this model.</p>
      ) : !reasoningSupport.reasoning ? (
        <p className="mt-2 text-xs text-muted-foreground">This model does not support configurable thinking.</p>
      ) : reasoningSupport.budgetTokens && !thinkingBudget ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This model supports a thinking budget, but the catalog does not publish a safe slider range.
        </p>
      ) : reasoningSupport.efforts.length === 0 && !reasoningSupport.toggle && !thinkingBudget ? (
        <p className="mt-2 text-xs text-muted-foreground">Thinking is always on for this model.</p>
      ) : thinkingBudget ? (
        <>
          <div className="relative pb-5 pt-2">
          <input
            aria-label="Thinking token budget"
            aria-valuetext={budgetDisplay}
            className="thinking-effort-slider w-full cursor-pointer"
            type="range"
            min={budgetSliderMin}
            max={100}
            step={1}
            value={budgetSliderValue}
            style={{ background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${budgetSliderPercent}%, var(--muted) ${budgetSliderPercent}%, var(--muted) 100%)` }}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (value === -2 && hasBudgetToggle) {
                changeReasoningEffort("none");
              } else {
                const tokens = Math.round(
                  thinkingBudget.min + (value / 100) * (thinkingBudget.max - thinkingBudget.min),
                );
                changeReasoningEffort(`budget:${tokens}`);
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") event.stopPropagation();
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-full -mt-4 text-xs text-muted-foreground" aria-live="polite">
            <span className="absolute whitespace-nowrap" style={sliderLabelStyle(budgetSliderPercent)}>{budgetDisplay}</span>
          </div>
          </div>
        </>
      ) : reasoningOptions.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">This provider does not expose a compatible thinking toggle.</p>
      ) : reasoningOptions.length === 1 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Thinking is fixed at {reasoningOptions[0].label} for this model.
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Thinking effort</span>
            <span className="text-sm font-medium text-blue-500">
              {reasoningOptions[selectedReasoningIndex]?.label}
            </span>
          </div>
          <div className="relative mx-4 pb-5 pt-2">
          <div className="thinking-effort-track" aria-hidden="true">
            <span
              className="thinking-effort-fill"
              style={{ width: `${effortSliderPercent}%` }}
            />
          </div>
          <input
            aria-label="Thinking effort level"
            aria-valuetext={reasoningOptions[selectedReasoningIndex]?.label}
            className="thinking-effort-slider is-snap thinking-effort-level-slider w-full cursor-pointer"
            type="range"
            min={0}
            max={reasoningOptions.length - 1}
            step={1}
            value={selectedReasoningIndex}
            style={{ background: "transparent" }}
            onChange={(event) => {
              const option = reasoningOptions[Number(event.currentTarget.value)];
              if (option) changeReasoningEffort(option.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") event.stopPropagation();
            }}
          />
          <div className="thinking-effort-dots" aria-hidden="true">
            {reasoningOptions.slice(1, -1).map((option, offset) => {
              const index = offset + 1;
              return (
                <span
                  key={option.value}
                  className="thinking-effort-dot"
                  style={{ left: `${(index / (reasoningOptions.length - 1)) * 100}%` }}
                />
              );
            })}
          </div>
          <span
            className="thinking-effort-thumb"
            style={{ left: `${effortSliderPercent}%` }}
            aria-hidden="true"
          />
          <div className="pointer-events-none absolute inset-x-0 top-full -mt-4 text-xs text-muted-foreground" aria-live="polite">
            <span className="absolute whitespace-nowrap" style={sliderLabelStyle(effortSliderPercent)}>{reasoningOptions[selectedReasoningIndex]?.label}</span>
          </div>
          </div>
        </>
      )}
    </div>
  );

  const attachmentDisclaimer = unsupportedAttachments.length > 0 ? (
    <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
      <TriangleAlert className="mt-px size-3.5 shrink-0" />
      <span>
        {unsupportedAttachments.map((u) => `"${u.name}"`).join(", ")} —{" "}
        {selectedModelLabel ? modelNameFor(selectedModelLabel) : "this model"} can't take{" "}
        {[...new Set(unsupportedAttachments.map((u) => u.modality))]
          .map((mod) => MODALITY_LABELS[mod] ?? mod)
          .join(" or ")}{" "}
        input. Remove {unsupportedAttachments.length === 1 ? "it" : "them"} or switch models.
      </span>
    </div>
  ) : null;

  const composerDisclaimers = (
    <>
      {attachmentDisclaimer}
    </>
  );

  const modelSelect = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50"
          disabled={allModels.length === 0}
        >
          {selectedModelLabel && (
            <ProviderLogo
              logoKey={logoKeyFor(selectedModelLabel)}
              className="size-3.5 shrink-0"
            />
          )}
          <span className="max-w-48 truncate">
            {selectedModelLabel
              ? modelNameFor(selectedModelLabel)
              : "Select model"}
          </span>
          {effortButtonLabel && (
            <span className="shrink-0 text-sm text-muted-foreground/60">
              {effortButtonLabel}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" avoidCollisions={false} align="end" className="flex min-w-72 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
        {allModels.length === 0 ? (
          <DropdownMenuItem disabled>
            No models — add a provider in Settings
          </DropdownMenuItem>
        ) : (
          allModels.map((m) => (
            <DropdownMenuItem key={m.id} onSelect={() => setSelectedModel(m.name)}>
              <ProviderLogo
                logoKey={logoKeyFor(m)}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="truncate">{modelNameFor(m)}</span>
              {m.name === selectedModel && (
                <Check className="ml-auto size-3.5" />
              )}
            </DropdownMenuItem>
          ))
        )}
        </div>
        <DropdownMenuSeparator className="shrink-0" />
        {thinkingControl}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const modeToggle = (
    mode: ChatMode,
    label: string,
    title: string,
    icon: React.ReactNode,
    activeClass: string,
    disabled = false,
  ) => {
    const active = chatMode === mode;
    const artifactOpen = !!artifactPanel;
    return (
      <InputGroupButton
        size={active && !artifactOpen ? "xs" : "icon-xs"}
        variant="ghost"
        aria-label={`Toggle ${label} mode`}
        title={title}
        disabled={disabled}
        onClick={() => {
          // Manual toggle: wins over auto-detection and persists to the
          // session so the mode survives reloads (learn stays on until off).
          const next: ChatMode = chatMode === mode ? "none" : mode;
          setChatMode(next);
          autoModeRef.current = "none";
          if (activeSessionId) updateSession(activeSessionId, { chat_mode: next });
        }}
        className={`group ${active ? activeClass : ""}`}
      >
        {icon}
        {active && !artifactOpen && <span className="group-hover:line-through">{label}</span>}
      </InputGroupButton>
    );
  };

  const modeToggles = !isAgentTab && (
    <>
      {modeToggle(
        "learn",
        "Learn",
        "Learn mode - structured tutoring with a comprehension check",
        <GraduationCap />,
        "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500",
      )}
      {modeToggle(
        "research",
        "Research",
        "Deep Research - multi-round, search-driven cited report",
        <Microscope />,
        "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500",
      )}
      {modeToggle(
        "council",
        "Discuss",
        "Discuss mode - a panel of agents deliberates and the chairman synthesizes the answer",
        <UsersRound />,
        "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500",
      )}
    </>
  );

  // Temporary chat toggle in the + menu — a check-on-the-right item that
  // stays open when clicked (like the mode toggles, in blue when active).
  const temporaryMenuItem = !isAgentTab && (
    <DropdownMenuItem
      disabled={messages.length > 0}
      onSelect={(e) => {
        e.preventDefault();
        toggleTemporary(!isTemporary);
      }}
      className={
        isTemporary
          ? "bg-blue-500/15 text-blue-500 focus:bg-blue-500/25 focus:text-blue-500"
          : undefined
      }
    >
      <ClockFading className={isTemporary ? "text-blue-500" : undefined} />
      Temporary chat
      {isTemporary && <Check className="ml-auto size-4 text-blue-500" />}
    </DropdownMenuItem>
  );

  const renderMessage = (msg: ChatMessage) => {
    const { siblings, currentIndex } = getSiblings(nodeMap, msg, roots);
    const hasBranches = siblings.length > 1;
    const isEditing = editingMessageId === msg.id;
    const isDimmed = editingMessageId !== null && !isEditing;
    const isRaw = showRawOutput.has(msg.id);
    // While editing, the bubble mirrors the composer: live text and the
    // composer's attachment chips (which start as the message's own).
    const shownAttachments: Array<
      Pick<MessageAttachment, "id" | "name" | "size" | "previewUrl" | "folderPath">
    > = isEditing ? files : (msg.attachments ?? []);
    const bubbleContent = isEditing ? inputText : msg.content;
    // Tappable answers for a clarifying question: only under the latest
    // assistant message, never in research mode (its flow stays as-is).
    const questionOptions =
      msg.id === lastAssistantId ? (optionCache.current.get(msg.id) ?? []) : [];
    const showQuestionOptions =
      questionOptions.length > 0 &&
      settings.promptSuggestions &&
      activeSession?.chatMode !== "research" &&
      chatMode !== "research" &&
      !agent?.isRunning &&
      !agent?.pendingInput &&
      !(agent?.pendingApprovals.length ?? 0) &&
      !agent?.pendingSuggestion;

    return (
      <MessageScrollerItem
        key={msg.id}
        messageId={msg.id}
        scrollAnchor={msg.role === "user"}
        className={cn(
          "transition-opacity duration-300",
          isDimmed && "pointer-events-none opacity-30",
        )}
      >
        {msg.role === "user" ? (
          <Message align="end">
            <MessageContent>
              {shownAttachments.map((attachment) => (
                <Attachment key={attachment.id} size="sm">
                  <AttachmentMedia
                    variant={
                      attachment.previewUrl || attachmentPreviews.get(attachment.id)
                        ? "image"
                        : "icon"
                    }
                  >
                    {attachment.previewUrl || attachmentPreviews.get(attachment.id) ? (
                      <img
                        src={attachment.previewUrl ?? attachmentPreviews.get(attachment.id)}
                        alt={attachment.name}
                      />
                    ) : attachment.folderPath ? (
                      <Folder />
                    ) : (
                      <FileText />
                    )}
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{attachment.name}</AttachmentTitle>
                    <AttachmentDescription>{attachment.folderPath ?? formatBytes(attachment.size)}</AttachmentDescription>
                  </AttachmentContent>
                </Attachment>
              ))}
              {bubbleContent && (
                <Bubble
                  className={cn(
                    isEditing &&
                      "rounded-xl ring-2 ring-ring/50 ring-offset-2 ring-offset-background",
                  )}
                >
                  <BubbleContent>
                    <MarkdownRenderer content={bubbleContent} onOpenArtifact={handleOpenArtifactFromContent} />
                  </BubbleContent>
                </Bubble>
              )}
              {!isEditing && (
                <MessageFooter className="gap-0.5 [&_button]:size-5 [&_button]:p-0 opacity-0 transition-opacity group-hover/message:opacity-100">
                  {hasBranches && (
                    <div className="flex items-center gap-0.5 mr-1 text-xs text-muted-foreground">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleBranchNavigate(msg, "prev")}
                        aria-label="Previous branch"
                      >
                        <ChevronLeft />
                      </Button>
                      <span className="tabular-nums">
                        {currentIndex + 1}/{siblings.length}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleBranchNavigate(msg, "next")}
                        aria-label="Next branch"
                      >
                        <ChevronRight />
                      </Button>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleStartEdit(msg)}
                    disabled={
                      agent?.isRunning ||
                      !!agent?.pendingInput ||
                      (agent?.pendingApprovals.length ?? 0) > 0 ||
                      !!agent?.pendingSuggestion
                    }
                    aria-label="Edit message"
                    title="Edit"
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleCopyMessage(msg.content)}
                    aria-label="Copy message"
                    title="Copy"
                  >
                    <Copy />
                  </Button>
                </MessageFooter>
              )}
            </MessageContent>
          </Message>
        ) : (
          <Message>
            <MessageContent>
              {isRaw ? (
                <Bubble variant="ghost">
                  <BubbleContent>
                    <pre className="whitespace-pre-wrap text-xs font-mono">
                      {msg.content}
                    </pre>
                  </BubbleContent>
                </Bubble>
              ) : (
                <MessageStream
                  content={msg.content}
                  activities={msg.activities}
                  reasoning={msg.reasoning}
                  reasoningStreams={msg.reasoningStreams}
                  workStartedAt={msg.workStartedAt}
                  workEndedAt={msg.workEndedAt}
                  workDurationMs={msg.workDurationMs}
                  workSegments={msg.workSegments}
                  // A record from another app context (window/instance/device)
                  // that is still being written renders as working, not as a
                  // finished "Worked for" summary that keeps growing.
                  live={isRunRecordActive(msg)}
                  onOpenArtifact={handleOpenArtifactFromContent}
                />
              )}
              {(() => {
                const persisted = msg.artifacts ?? [];
                if (persisted.length === 0) return null;
                const arts = persisted;
                return (
                  <div className="mb-1 flex flex-col gap-1.5">
                    {arts.map((a, i) => (
                      <button
                        key={a.id}
                        onClick={() => { setArtifactPanel({ artifacts: arts, activeIndex: i }); setArtifactWindowMode("open"); }}
                        className="flex w-full items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-opacity hover:bg-accent"
                      >
                        <FileCode className="size-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{a.title}</span>
                        <span className="text-muted-foreground">{a.language}</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                const shared = msg.files ?? [];
                if (shared.length === 0) return null;
                return (
                  <div className="mb-1 flex flex-col gap-1.5">
                    {shared.map((f) => (
                      <div
                        key={f.path}
                        className="flex w-full items-center gap-2 rounded-lg border px-4 py-3 text-sm"
                        title={f.path}
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <button
                          onClick={() => void handleOpenSharedFile(f.path)}
                          className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                        >
                          {f.name}
                        </button>
                        <button
                          onClick={() => void handleOpenSharedFile(f.path)}
                          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => void handleRevealSharedFile(f.path)}
                          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Reveal
                        </button>
                        <button
                          onClick={() => void handleDownloadSharedFile(f.path)}
                          aria-label={`Download ${f.name}`}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <Download className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {showQuestionOptions && (
                <div className="mb-1 flex animate-in fade-in flex-wrap gap-1.5 duration-300">
                  {questionOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        setInputText(opt);
                        sessionTextareaRef.current?.focus();
                      }}
                      className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground active:scale-95"
                    >
                      {opt}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => sessionTextareaRef.current?.focus()}
                    title="Write your own answer in the composer"
                    className="rounded-full border border-dashed px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground active:scale-95"
                  >
                    Custom…
                  </button>
                </div>
              )}
              <MessageFooter className="gap-1.5 [&_button]:size-5 [&_button]:p-0 opacity-0 transition-opacity group-hover/message:opacity-100">
                {hasBranches && (
                  <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleBranchNavigate(msg, "prev")}
                      aria-label="Previous branch"
                    >
                      <ChevronLeft />
                    </Button>
                    <span className="tabular-nums">
                      {currentIndex + 1}/{siblings.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleBranchNavigate(msg, "next")}
                      aria-label="Next branch"
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleRegenerate(msg)}
                  aria-label="Regenerate response"
                  title="Regenerate"
                  disabled={agent?.isRunning}
                >
                  <RotateCcw />
                </Button>
                {msg.model && (
                  <Badge variant="secondary" className="text-[10px] py-0">
                    {(() => {
                      const m = allModels.find((x) => x.name === msg.model);
                      return m ? modelLabel(m) : msg.model;
                    })()}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => toggleRawOutput(msg.id)}
                  aria-label="Toggle raw output"
                  title={isRaw ? "Show rendered" : "Show raw"}
                >
                  <SquareTerminal />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleCopyMessage(msg.content)}
                  aria-label="Copy response"
                  title="Copy"
                >
                  <Copy />
                </Button>
              </MessageFooter>
            </MessageContent>
          </Message>
        )}
      </MessageScrollerItem>
    );
  };

  return (
    <OpenCodeProvider>
    {/* Full-screen file drop overlay (portaled to body so it sits above everything). */}
    {createPortal(
      fileDropOverlay ? (
        <DropOverlay />
      ) : null,
      document.body,
    )}
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="relative h-dvh min-h-0 overflow-hidden bg-sidebar"
      style={{ "--sidebar-width-icon": "1px" } as React.CSSProperties}
    >
      <AppSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        view={view}
        // The connectors page dims the sidebar so the page reads as focused.
        className={cn(
          "transition-[left,right,width,opacity] duration-200 ease-linear",
          view === "connectors" && "opacity-40",
        )}
        settingsTab={settingsTab}
        activeTab={activeTab}
        onSelectSession={selectSession}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteSession}
        onRenameChat={(id, title) => updateSession(id, { title })}
        onMoveSessionToAgent={handleMoveSessionToAgent}
        onSettings={openSettings}
        onSettingsTabChange={setSettingsTab}
        onExitSettings={() => setView("chat")}
        onProjects={() => setView("projects")}
        onHistory={() => setView("history")}
        onComingSoon={comingSoon}
        onTabChange={switchTab}
        onOpenDashboard={handleOpenDashboard}
        agents={agents}
        onOpenAgentConsole={handleOpenAgentConsole}
        onStartAgentSession={handleStartAgentSession}
        onDeleteAgent={handleDeleteAgent}
        onOpenAgentSettings={setAgentSettingsId}
        projects={projects}
        runningIds={runningIds}
        activeAgentConsole={activeAgentConsole}
        agentConsoleTab={agentConsoleTab}
        onAgentConsoleTabChange={(tab) => {
          setAgentConsoleTab(tab);
          setAgentConsoleComposing(false);
          // The panel takes over the main area even with a session open —
          // the session keeps running and stays one click away.
          setAgentConsoleFocus("panel");
        }}
        onExitAgentConsole={closeAgentConsole}
        agentSessions={activeAgentSessions}
        agentConsoleComposing={agentConsoleComposing}
        onNewAgentSession={activeAgentConsole ? enterAgentCompose : undefined}
        accountEmail={accountProfile?.email ?? null}
        accountName={accountProfile?.name ?? null}
        accountAvatarUrl={accountProfile?.avatarUrl ?? null}
        accountTab={accountTab}
        onAccountTabChange={setAccountTab}
        onOpenAccount={() => setView("account")}
        onConnectAccount={() => setAccountOpen(true)}
        onSignOut={handleAccountSignOut}
      />

      <div className="fixed left-21 top-[11.75px] z-50 flex items-center gap-1 text-neutral-400 dark:text-neutral-500">
        <SidebarTrigger
          className="h-5 w-5 rounded-sm p-3 [&_svg]:size-3.5 text-neutral-500 hover:bg-accent hover:text-zinc-800 dark:hover:bg-accent dark:hover:text-zinc-400"
          onClick={() => {
            if (artifactPanel && artifactWindowMode !== "minimized") {
              setArtifactWindowMode("minimized");
            }
          }}
        />
        {!sidebarOpen && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 rounded-l-md px-1 text-xs text-neutral-500 hover:bg-accent hover:text-zinc-800 dark:text-neutral-400 dark:hover:bg-accent dark:hover:text-white [&_svg]:size-3.5"
              onClick={handleNewChat}
            >
              <SquarePen />
              New Chat
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 ml-[-6px] rounded-r-md text-neutral-500 hover:bg-accent hover:text-zinc-800 dark:text-neutral-400 dark:hover:bg-accent dark:hover:text-white"
                  aria-label="Open a recent session"
                  title="Recent sessions"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom" className="max-h-96 min-w-64">
                {sessions.filter((session) => !session.isTemporary).length > 0 ? (
                  sessions
                    .filter((session) => !session.isTemporary)
                    .map((session) => (
                      <DropdownMenuItem
                        key={session.id}
                        onClick={() => selectSession(session.id)}
                        className="max-w-80"
                      >
                        <span className="truncate">{session.title}</span>
                      </DropdownMenuItem>
                    ))
                ) : (
                  <DropdownMenuItem disabled>No recent sessions</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1.5 rounded-md px-1 text-xs text-neutral-500 hover:bg-accent hover:text-zinc-800 dark:text-neutral-400 dark:hover:bg-accent dark:hover:text-white [&_svg]:size-3.5"
                  aria-label="Switch between Chat and Agents"
                >
                  {activeTab === "chat" ? (
                    <MessageCircle />
                  ) : (
                    <Bot />
                  )}
                  {activeTab === "chat" ? "Chat" : "Agents"}
                  <ChevronDown className="ml-0.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-32 rounded-md" side="bottom" align="start">
                <DropdownMenuItem onClick={() => switchTab("chat")}>
                  <MessageCircle className="size-3.5" />
                  Chat
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => switchTab("agent")}>
                  <Bot className="size-3.5" />
                  Agents
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {/*<Button*/}
        {/*  variant="ghost"*/}
        {/*  size="icon-xs"*/}
        {/*  className={cn(*/}
        {/*    "size-5 rounded-md p-0 transition-opacity duration-150 [&_svg]:size-4 hover:bg-accent hover:text-black dark:hover:bg-accent dark:hover:text-white",*/}
        {/*    sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",*/}
        {/*  )}*/}
        {/*  aria-label="Undo"*/}
        {/*  title="Undo"*/}
        {/*  aria-keyshortcuts="Meta+Z"*/}
        {/*  aria-hidden={!sidebarOpen}*/}
        {/*  tabIndex={sidebarOpen ? 0 : -1}*/}
        {/*  style={{ transitionDelay: sidebarOpen ? "200ms" : "0ms" }}*/}
        {/*  onMouseDown={(event) => event.preventDefault()}*/}
        {/*  onClick={() => document.execCommand("undo")}*/}
        {/*>*/}
        {/*  <ArrowLeft strokeWidth={2.5} />*/}
        {/*</Button>*/}
        {/*<Button*/}
        {/*  variant="ghost"*/}
        {/*  size="icon-xs"*/}
        {/*  className={cn(*/}
        {/*    "size-5 rounded-md p-0 transition-opacity duration-150 [&_svg]:size-4 hover:bg-accent hover:text-black dark:hover:bg-accent dark:hover:text-white",*/}
        {/*    sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",*/}
        {/*  )}*/}
        {/*  aria-label="Redo"*/}
        {/*  title="Redo"*/}
        {/*  aria-keyshortcuts="Meta+Shift+Z"*/}
        {/*  aria-hidden={!sidebarOpen}*/}
        {/*  tabIndex={sidebarOpen ? 0 : -1}*/}
        {/*  style={{ transitionDelay: sidebarOpen ? "200ms" : "0ms" }}*/}
        {/*  onMouseDown={(event) => event.preventDefault()}*/}
        {/*  onClick={() => document.execCommand("redo")}*/}
        {/*>*/}
        {/*  <ArrowRight strokeWidth={2.5} />*/}
        {/*</Button>*/}
      </div>

      <SidebarInset className="m-2 overflow-hidden rounded-lg shadow-sm border-1">
        {view === "connectors" ? (
          <div
            key="connectors-view"
            className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-right-3 duration-300"
          >
            <header
              data-tauri-drag-region
              onMouseDown={startDrag}
              className="h-10 shrink-0 select-none"
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 sm:px-8">
              <div className="mx-auto w-[90%] pb-16">
                <ConnectorsPage onBack={() => setView("chat")} />
              </div>
            </div>
          </div>
        ) : view === "settings" ? (
          <div
            key="settings-view"
            className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-right-3 duration-300"
          >
            <header
              data-tauri-drag-region
              onMouseDown={startDrag}
              className="relative flex h-10 shrink-0 select-none items-center px-4"
            >
              <span className="absolute left-1/2 -translate-x-1/2 text-sm font-medium">
                Settings
              </span>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-8">
              <SettingsView activeTab={settingsTab} />
            </div>
          </div>
        ) : view === "account" ? (
          <div
            key="account-view"
            className="flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-right-3 duration-300"
          >
            <header
              data-tauri-drag-region
              onMouseDown={startDrag}
              className="relative flex h-10 shrink-0 select-none items-center px-4"
            >
              <span className="absolute left-1/2 -translate-x-1/2 text-sm font-medium">
                Account
              </span>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-8">
              <div className="mx-auto w-[90%] pb-16">
                {accountProfile ? (
                  <AccountSettings
                    onDone={() => setView("chat")}
                    signingOut={false}
                    onSignOut={handleAccountSignOut}
                    activeTab={accountTab}
                    onTabChange={setAccountTab}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-4 py-16 text-center">
                    <p className="text-sm text-muted-foreground">
                      Connect your account to manage your profile, password, and stored data here.
                    </p>
                    <Button onClick={() => setAccountOpen(true)}>Connect account</Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : view === "projects" ? (
          <div
            key="projects-view"
            className="relative flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-right-3 duration-300"
          >
            <PatternBackground pattern={settings.backgroundPattern} />
            <header
              data-tauri-drag-region
              onMouseDown={startDrag}
              className="relative flex h-10 shrink-0 select-none items-center px-4"
            >
              <span className="absolute left-1/2 -translate-x-1/2 text-sm font-medium">
                Projects
              </span>
            </header>
            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-8">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-8">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Organize your conversations into projects.
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.target.value)}
                        placeholder="Search projects..."
                        className="h-9 w-56 pl-9"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowNewProjectCard(true);
                        setNewProjectName("");
                        setNewProjectInstructions("");
                      }}
                    >
                      <Plus />
                      New Project
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {showNewProjectCard && (
                    <Card className="col-span-2 gap-0 py-0">
                      <CardHeader className="py-4">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">New Project</span>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => setShowNewProjectCard(false)}
                              aria-label="Cancel"
                            >
                              <X />
                            </Button>
                          </div>
                          <Input
                            autoFocus
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="Project name (required)"
                          />
                          <Textarea
                            value={newProjectInstructions}
                            onChange={(e) => setNewProjectInstructions(e.currentTarget.value)}
                            placeholder="Instructions for the AI..."
                            className="min-h-24 text-xs"
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowNewProjectCard(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              disabled={!newProjectName.trim()}
                              onClick={async () => {
                                try {
                                  await createProject(
                                    newProjectName.trim(),
                                    "",
                                    newProjectInstructions.trim(),
                                  );
                                  setShowNewProjectCard(false);
                                } catch {
                                  toast.error("Failed to create project");
                                }
                              }}
                            >
                              Create
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  )}
                  {projects
                    .filter((p) =>
                      p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
                      p.description.toLowerCase().includes(projectSearch.toLowerCase())
                    )
                    .map((project) => (
                      <Card key={project.id} className="gap-0 py-0 cursor-pointer transition-colors hover:bg-accent/50" onClick={() => {
                        setActiveTab("chat");
                        setActiveSessionId(null);
                        setActiveProjectId(project.id);
                        setView("chat");
                      }}>
                        <CardHeader className="py-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col gap-1">
                              <CardTitle className="text-sm">{project.name}</CardTitle>
                              <CardDescription>{project.description}</CardDescription>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="shrink-0"
                                  aria-label="More options"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await deleteProject(project.id);
                                      refetchProjects();
                                    } catch {
                                      toast.error("Failed to delete project");
                                    }
                                  }}
                                >
                                  <Trash2 />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent className="pb-4 pt-0">
                          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">
                            {sessions.filter((s) => s.projectId === project.id).length} chats
                          </span>
                        </CardContent>
                      </Card>
                    ))}
                  {projects.filter((p) =>
                    p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
                    p.description.toLowerCase().includes(projectSearch.toLowerCase())
                  ).length === 0 && (
                    <div className="col-span-2 py-8 text-center text-sm text-muted-foreground">
                      {projectSearch ? "No projects match your search." : "No projects yet. Create one to get started."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : view === "history" ? (
          <div
            key="history-view"
            className="relative flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-right-3 duration-300"
          >
            <PatternBackground pattern={settings.backgroundPattern} />
            <header
              data-tauri-drag-region
              onMouseDown={startDrag}
              className="relative flex h-10 shrink-0 select-none items-center px-4"
            >
              <span className="absolute left-1/2 -translate-x-1/2 text-sm font-medium">
                History
              </span>
            </header>
            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-8">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-8">
                <div className="flex items-center justify-end gap-2">
                  {historySelectedIds.size > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {historySelectedIds.size} selected
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => { void handleDeleteSelectedSessions(); }}
                      >
                        <Trash2 />
                        Delete
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistorySelectedIds(new Set())}
                      >
                        Clear
                      </Button>
                    </>
                  )}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search history..."
                      className="h-9 w-56 pl-9"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      handleNewChat();
                    }}
                  >
                    <SquarePen />
                    New Chat
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  {sessions
                    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                    .filter((s) =>
                      s.title.toLowerCase().includes(historySearch.toLowerCase())
                    )
                    .map((session) => (
                      <Card key={session.id} className={`gap-0 py-0 cursor-pointer transition-colors hover:bg-accent ${session.movedToAgent ? "opacity-50" : ""}`} onClick={() => {
                        selectSession(session.id);
                      }}>
                        <CardHeader className="flex items-center justify-between py-3.5">
                          <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium">
                            <Checkbox
                              checked={historySelectedIds.has(session.id)}
                              onCheckedChange={(checked) => {
                                setHistorySelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(session.id);
                                  else next.delete(session.id);
                                  return next;
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0"
                              aria-label={`Select chat: ${session.title}`}
                            />
                            {session.movedToAgent && (
                              <Bot className="size-4 shrink-0 text-muted-foreground" />
                            )}
                            {session.title}
                          </span>
                          <div className="ml-4 flex shrink-0 items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {session.updatedAt.toLocaleDateString([], {
                                month: "short",
                                day: "numeric",
                              })}{" "}
                              {formatTime(session.updatedAt)}
                            </span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="shrink-0"
                                  aria-label="More options"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setHistoryRenameDraft(session.title); setRenamingHistory({ id: session.id, title: session.title }); }}>
                                  <Pencil />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteSession(session.id);
                                  }}
                                >
                                  <Trash2 />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                      </Card>
                    ))}
                  {sessions
                    .filter((s) =>
                      s.title.toLowerCase().includes(historySearch.toLowerCase())
                    ).length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {historySearch ? "No conversations match your search." : "No conversation history yet."}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Column-level pattern: the chat empty state and the agent dashboard
            share it so it starts behind the header at the very top, while the
            project view and agent console render their own inside their chat
            column instead. */}
        {(isAgentTab && agentDashboardOpen
          ? !activeSession
          : !activeSession && !activeProject && !activeAgentConsole) && (
          <PatternBackground pattern={settings.backgroundPattern} />
        )}
        <header
          data-tauri-drag-region
          onMouseDown={startDrag}
          className="relative flex h-10 shrink-0 select-none items-center px-4"
        >
          {activeProject && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setActiveProjectId(null)}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Back to chat"
              className="shrink-0"
            >
              <ArrowLeft />
            </Button>
          )}
          {(activeSession || activeProject || (activeAgentConsole && !activeSession)) && (
            <div className="absolute left-1/2 -translate-x-1/2">
              {activeProject ? (
                editingProjectField === "name" ? (
                  <input
                    autoFocus
                    value={projectNameDraft}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => setProjectNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const trimmed = projectNameDraft.trim();
                        if (trimmed) updateProject(activeProject.id, { name: trimmed });
                        setEditingProjectField(null);
                      }
                      if (e.key === "Escape") setEditingProjectField(null);
                    }}
                    onBlur={() => {
                      const trimmed = projectNameDraft.trim();
                      if (trimmed) updateProject(activeProject.id, { name: trimmed });
                      setEditingProjectField(null);
                    }}
                    className="max-w-xs rounded-md border px-3 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setProjectNameDraft(activeProject.name);
                      setEditingProjectField("name");
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="max-w-xs truncate rounded-md px-3 py-1 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    {activeProject.name}
                  </button>
                )
              ) : activeAgentConsole && !activeSession ? (
                // The General tab is the agent's profile (avatar + name +
                // purpose header), so the top-bar name is redundant there.
                agentConsoleTab === "general" ? null : (
                  <span className="flex max-w-xs items-center gap-2 px-1 py-0.5">
                    <AgentAvatar seed={activeAgentConsole.id} className="size-4.5" />
                    <span className="truncate text-sm font-medium">
                      {activeAgentConsole.name}
                    </span>
                  </span>
                )
              ) : isEditingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTitle();
                    if (e.key === "Escape") cancelTitleEdit();
                  }}
                  onBlur={commitTitle}
                  className="max-w-xs rounded-md border px-3 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : (
                <button
                  onClick={startEditingTitle}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="flex max-w-xs items-center gap-1.5 truncate rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-accent"
                >
                  {activeSession!.agentId && (
                    <AgentAvatar
                      seed={activeSession!.agentId}
                      className="size-4"
                      title={agents.find((a) => a.id === activeSession!.agentId)?.name}
                    />
                  )}
                  <span className="truncate">{activeSession!.title}</span>
                </button>
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {sessionViewActive && (
              <Button
                variant="ghost"
                size="icon-sm"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={toggleWidgetsHidden}
                aria-label={widgetsHidden ? "Show widgets" : "Hide widgets"}
                className="shrink-0 -mr-2"
              >
                <Menu />
              </Button>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
        {(activeSession && (!isAgentTab || agentConsoleFocus === "session")) ? (
          <div
            key={activeSessionId}
            ref={sessionContainerRef}
            className="relative flex min-h-0 flex-1 gap-2 overflow-hidden p-2 animate-in fade-in duration-200 motion-reduce:animate-none"
          >
            <ConversationSearch
              open={findOpen}
              onOpenChange={setFindOpen}
              rootRef={sessionContainerRef}
            />
            <div
              className={cn(
                "relative flex min-h-0 min-w-0 flex-1 flex-col transition-[flex,margin] duration-300 ease-out",
                reserveWidgetsSpace && "mr-[19.5rem]",
                artifactWindowMode === "expanded" && "hidden",
              )}
            >
            <MessageScrollerProvider
              autoScroll
              defaultScrollPosition="last-anchor"
              scrollPreviousItemPeek={64}
            >
              <MessageScroller className="flex-1">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16">
                    {activePath.map((node, index) => {
                      // The in-progress assistant message renders its live
                      // streaming bubble in place — the same MessageScrollerItem
                      // the finished message will occupy. Swapping a separate
                      // "thinking" item for the real one on completion was a
                      // same-count child swap that made the message scroller
                      // treat it as a new scroll anchor and jump the chat to
                      // the top; keeping one item avoids any childList change.
                      if (
                        agent?.isRunning &&
                        node.message.id === inProgressMsgIds.current.get(activeSessionId ?? "")
                      ) {
                        return (
                          <MessageScrollerItem
                            key={node.message.id}
                            messageId={node.message.id}
                          >
                            <Message>
                              <MessageContent>
                                <>
                                  <MessageStream
                                    content={agent?.streamingContent ?? ""}
                                    activities={agent?.activities}
                                    reasoning={agent?.streamingReasoning}
                                    reasoningStreams={agent?.reasoningStreams}
                                    workStartedAt={agent?.workStartedAt}
                                    workEndedAt={agent?.workEndedAt}
                                    workDurationMs={agent?.workDurationMs}
                                    workSegments={agent?.workSegments}
                                    todos={agentTaskView ? undefined : agent?.todos}
                                    live
                                  />
                                    {(agent?.files ?? []).length > 0 && (
                                      <div className="mb-1 flex flex-col gap-1.5">
                                        {agent.files.map((f) => (
                                          <div
                                            key={f.path}
                                            className="flex w-full items-center gap-2 rounded-lg border px-4 py-3 text-sm"
                                            title={f.path}
                                          >
                                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                                            <button
                                              onClick={() => void handleOpenSharedFile(f.path)}
                                              className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                                            >
                                              {f.name}
                                            </button>
                                            <button
                                              onClick={() => void handleOpenSharedFile(f.path)}
                                              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                                            >
                                              Open
                                            </button>
                                            <button
                                              onClick={() => void handleRevealSharedFile(f.path)}
                                              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                                            >
                                              Reveal
                                            </button>
                                            <button
                                              onClick={() => void handleDownloadSharedFile(f.path)}
                                              aria-label={`Download ${f.name}`}
                                              className="shrink-0 text-muted-foreground hover:text-foreground"
                                            >
                                              <Download className="size-4" />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                </>
                              </MessageContent>
                            </Message>
                          </MessageScrollerItem>
                        );
                      }
                      const rendered = renderMessage(node.message);
                      if (compactionRecord && index === compactionAnchor) {
                        return (
                          <Fragment key={node.message.id}>
                            {rendered}
                            <CompactionDivider
                              key={`${activeSessionId}:${compactionRecord.upToId}`}
                              summary={compactionRecord.summary}
                              at={compactionRecord.at}
                            />
                          </Fragment>
                        );
                      }
                      return rendered;
                    })}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>

            <div className="shrink-0 px-4 pb-4">
              <div className="mx-auto w-full max-w-3xl">
                {agent?.pendingInput ? (
                  <StructuredInputForm
                    request={agent?.pendingInput}
                    onSubmit={(values) => agent?.submitInput(values)}
                    onSwitchToText={() => agent?.skipInput()}
                  />
                ) : agent?.pendingApprovals.length ? (
                  <div className="grid gap-2">
                    {agent.pendingApprovals.map(({ id, request }) => (
                      <ApprovalCard
                        key={id}
                        request={request}
                        onApprove={() => agent?.approveCommand(id)}
                        onDeny={() => agent?.rejectCommand(id)}
                      />
                    ))}
                  </div>
                 ) : agent?.pendingSuggestion ? (
                   <SuggestionCard
                     suggestion={agent.pendingSuggestion}
                     onDismiss={() => agent?.dismissSuggestion()}
                     onInstallSkill={installSkillByName}
                     onOpenConnectors={() => {
                       setView("connectors");
                     }}
                      onEnableMode={(mode) => {
                        setChatMode(mode);
                        autoModeRef.current = "none";
                        if (activeSessionId) updateSession(activeSessionId, { chat_mode: mode });
                      }}
                      onApplyAgentConfig={handleApplyAgentConfig}
                    />
                 ) : (
                 <>
                 {composerDisclaimers}
                 {editingMessageId && (
                   <div className="mb-2 flex items-center gap-2 rounded-xl border border-ring/50 bg-accent/60 px-3 py-2 text-xs shadow-sm animate-in fade-in duration-200">
                     <Pencil className="size-3.5 shrink-0" />
                     <span className="min-w-0 flex-1 truncate text-muted-foreground">
                       Editing message
                       {files.length > 0
                         ? ` · ${files.length} attachment${files.length === 1 ? "" : "s"}`
                         : ""}
                       {" — attachments, active modes and model below apply to the new response."}
                     </span>
                     <Button size="xs" variant="ghost" onClick={handleCancelEdit}>
                       Cancel
                     </Button>
                   </div>
                 )}
                 <InputGroup
                   className={cn(
                     isTemporary && "border-dashed",
                     draggingFiles && "border-ring ring-[3px] ring-ring/50",
                   )}
                   onPaste={(e) => {
                     // Cmd+V / right-click paste of files (Finder copies,
                     // screenshots) attaches them instead of dropping the
                     // text/ignoring the paste. Plain text pastes pass
                     // through to the textarea.
                     const dt = e.clipboardData;
                     if (!dt) return;
                     const pasted = Array.from(dt.files);
                     if (pasted.length === 0) {
                       for (const item of Array.from(dt.items)) {
                         if (item.kind !== "file") continue;
                         const file = item.getAsFile();
                         if (file) pasted.push(file);
                       }
                     }
                     if (pasted.length === 0) return;
                     e.preventDefault();
                     addFiles(pasted);
                   }}
                   {...composerDropHandlers}
                 >
                   {files.length > 0 && (
                     <InputGroupAddon align="block-start">
                      <AttachmentGroup className="w-full">
                        {files.map((file) => (
                          <Attachment key={file.id} size="xs">
                            <AttachmentMedia
                              variant={file.previewUrl ? "image" : "icon"}
                            >
                              {file.previewUrl ? (
                                <img src={file.previewUrl} alt={file.name} />
                              ) : file.folderPath ? (
                                <Folder />
                              ) : (
                                <FileText />
                              )}
                            </AttachmentMedia>
                            <AttachmentContent>
                              <AttachmentTitle>{file.name}</AttachmentTitle>
                              <AttachmentDescription>{file.folderPath ?? formatBytes(file.size)}</AttachmentDescription>
                            </AttachmentContent>
                            <AttachmentActions>
                              <AttachmentAction
                                aria-label={`Remove ${file.name}`}
                                onClick={() => removeFile(file.id)}
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
                    rows={1}
                    ref={(el) => {
                      sessionTextareaRef.current = el;
                      // Re-measure on (re)mount so a multi-line draft keeps
                      // its grown height when the composer returns to view.
                      if (el) resizeComposer();
                    }}
                    value={inputText}
                    onChange={(e) => setInputText(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && editingMessageId) {
                        e.preventDefault();
                        handleCancelEdit();
                        return;
                      }
                      // Ghost suggestion: Tab accepts it into the box (it
                      // comes back if the text is deleted), Escape dismisses
                      // it until the next reply. Plain Tab only — Ctrl+Tab
                      // (chat cycling) and other modified Tabs pass through.
                      if (
                        e.key === "Tab" &&
                        ghostSuggestion &&
                        !e.shiftKey &&
                        !e.ctrlKey &&
                        !e.metaKey &&
                        !e.altKey
                      ) {
                        e.preventDefault();
                        setInputText(ghostSuggestion);
                        return;
                      }
                      if (e.key === "Escape" && ghostSuggestion) {
                        e.preventDefault();
                        setDismissedGhostKey(followUpGhostKey);
                        return;
                      }
                      if (settings.sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleModeSend();
                      }
                    }}
                    placeholder={ghostSuggestion ? "" : chatComposerPlaceholder}
                    className="min-h-12 basis-auto [field-sizing:fixed]!"
                  />
                  {ghostSuggestion && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-0 flex items-baseline gap-2 overflow-hidden px-3 py-3 text-base md:text-sm"
                    >
                      <span className="ghost-wave min-w-0 max-w-[calc(100%-3rem)] truncate">
                        {ghostSuggestion}
                      </span>
                      <kbd className="shrink-0 rounded border border-border bg-muted px-1 py-px text-[10px] leading-tight text-muted-foreground">
                        Tab →
                      </kbd>
                    </div>
                  )}
                  <InputGroupAddon align="block-end" className="flex-wrap">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <InputGroupButton size="icon-xs" aria-label="Add">
                          <Plus />
                        </InputGroupButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="top" align="start">
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <PackagePlus />
                            Add to Project
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem onClick={() => assignProject(undefined)}>
                              {currentProjectId === undefined ? <Check /> : <span className="size-4" />}
                              No project
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {projects.map((p) => (
                              <DropdownMenuItem key={p.id} onClick={() => assignProject(p.id)}>
                                {currentProjectId === p.id ? <Check /> : <span className="size-4" />}
                                {p.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem onClick={() => void pickFolder()}>
                          <FolderPlus />
                          Add folder
                          <DropdownMenuShortcut>⌘J</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        {temporaryMenuItem}
                        <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                          <Paperclip />
                          Add files
                          <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {currentProjectName && (
                      <InputGroupButton
                        size="xs"
                        variant="ghost"
                        className="group bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500"
                        onClick={() => assignProject(undefined)}
                      >
                        <span className="max-w-20 truncate group-hover:line-through">{currentProjectName}</span>
                      </InputGroupButton>
                    )}
                    {modeToggles}
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFiles}
                    />
                    <input
                      ref={imageInputRef}
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={handleFiles}
                    />

                    <div className="flex-1" />

                    {modelSelect()}

                    {agent?.isRunning ? (
                      <InputGroupButton
                        variant="outline"
                        size="icon-xs"
                        className="rounded-lg"
                        onClick={handleStop}
                        aria-label="Stop generation"
                      >
                        <span className="size-3 rounded-sm bg-current" />
                      </InputGroupButton>
                    ) : (
                      <InputGroupButton
                        variant="default"
                        size="icon-xs"
                        className="rounded-lg"
                        onClick={handleModeSend}
                        disabled={
                          editingMessageId
                            ? !inputText.trim()
                            : (!inputText.trim() && files.length === 0) || agent?.isRunning
                        }
                        aria-label={editingMessageId ? "Save edit" : "Send message"}
                      >
                        <ArrowUp />
                      </InputGroupButton>
                    )}
                  </InputGroupAddon>
                </InputGroup>
                </>
                )}

                <p className="mt-1 mb-[-12px] text-center text-xs leading-3 text-bold text-muted-foreground">
                  {selectedModelLabel ? modelLabel(selectedModelLabel) : selectedModel ?? "AI"} can make mistakes. Check important information.
                </p>
              </div>
            </div>
            </div>
            {/* Session floating widgets (top-right), floating over the chat
                text with a strong shadow. Stays mounted while hidden so it
                can slide out of the right edge; auto-closes when it can't
                fit the available height (see WidgetStack). */}
            {!artifactPanel && (
              <WidgetStack visible={!widgetsHidden} onFitChange={setWidgetsFit}>
                <ContextWidget
                  usage={agent?.usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, contextTokens: 0, costDollars: 0 }}
                  contextLimit={agent?.contextLimit ?? null}
                  canCompact={activePath.length > 0 && !agent?.isRunning}
                  compacting={compactingSessionId === activeSessionId}
                  onCompact={() => void handleCompactContext()}
                />
                <TasksWidget todos={sessionTodos} />
                <FilesWidget
                  files={sessionFiles}
                  onDownload={(path) => void handleDownloadSharedFile(path)}
                />
              </WidgetStack>
            )}
            {artifactPanel && artifactWindowMode !== "minimized" && artifactWindowMode !== "expanded" && (
              <div
                className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center rounded-full transition-colors hover:bg-primary/20 active:bg-primary/40"
                onMouseDown={startArtifactDrag}
              >
                <div className="h-8 w-0.5 rounded-full bg-border" />
              </div>
            )}
            {artifactPanel && (
              <div
                className={
                  artifactWindowMode === "minimized"
                    ? "absolute right-0 top-2 bottom-2 z-40 max-w-[80vw] cursor-pointer animate-in slide-in-from-right duration-300"
                    : "relative h-full max-w-[80vw] shrink-0 animate-in slide-in-from-right duration-300"
                }
                style={{
                  width: artifactWindowMode === "minimized"
                    ? "70%"
                    : artifactWindowMode === "expanded"
                      ? "100%"
                      : artifactWidth !== null
                        ? `${(artifactWidth / (sessionContainerRef.current?.getBoundingClientRect().width ?? 1)) * 100}%`
                        : "70%",
                  // Cap the artifact so the chat column keeps its minimum width
                  // and the composer never overflows. The minimized overlay is
                  // absolute-positioned and does not squeeze the chat column.
                  // When expanded, allow full width (chat column is hidden).
                  // Floor the open panel so the header actions (download etc.)
                  // are never squeezed out of reach — the chat column squishes
                  // instead.
                  minWidth: artifactWindowMode === "open" ? 220 : undefined,
                  maxWidth: artifactWindowMode === "minimized"
                    ? undefined
                    : artifactWindowMode === "expanded"
                      ? "100%"
                      : `max(280px, calc(100% - ${CHAT_MIN_WIDTH_PX + ARTIFACT_ROW_OVERHEAD_PX}px))`,
                  transform: artifactWindowMode === "minimized" ? "translateX(88%) scale(0.95)" : undefined,
                  opacity: artifactWindowMode === "minimized" ? 0.35 : 1,
                  transition: "transform 300ms ease, opacity 300ms ease, width 300ms ease",
                }}
                onClick={artifactWindowMode === "minimized" ? () => setArtifactWindowMode("open") : undefined}
              >
                <ArtifactPanel
                  artifacts={artifactPanel.artifacts}
                  activeIndex={artifactPanel.activeIndex}
                  onSelectIndex={(i) => setArtifactPanel((prev) => prev ? { ...prev, activeIndex: i } : null)}
                  onClose={() => { setArtifactPanel(null); setArtifactWindowMode("open"); }}
                  windowMode={artifactWindowMode}
                  onMinimize={() => setArtifactWindowMode((prev) => prev === "minimized" ? "open" : "minimized")}
                  onExpand={() => setArtifactWindowMode((prev) => prev === "expanded" ? "open" : "expanded")}
                />
              </div>
            )}
          </div>
        ) : activeProject ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-r">
                <PatternBackground pattern={settings.backgroundPattern} />
                <div className="relative shrink-0 p-4">
                 <InputGroup className={isTemporary ? "border-dashed" : undefined}>
                    <InputGroupTextarea
                      value={projectInputText}
                      onChange={(e) => setProjectInputText(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (settings.sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          const text = projectInputText.trim();
                          if (!text || agent?.isRunning) return;
                          setProjectInputText("");
                          handleProjectModeSend(text);
                        }
                      }}
                      placeholder={isTemporary ? "This whole chat will be forgotten when you leave it" : "Ask anything about this project..."}
                      className="max-h-40 min-h-12"
                    />
                    <InputGroupAddon align="block-end">
                      {modeToggles}
                      <div className="flex-1" />
                      {modelSelect()}
                      <InputGroupButton
                        variant="default"
                        size="icon-xs"
                        className="rounded-lg"
                        onClick={() => {
                          const text = projectInputText.trim();
                          if (!text || agent?.isRunning) return;
                          setProjectInputText("");
                          handleProjectModeSend(text);
                        }}
                        disabled={!projectInputText.trim() || agent?.isRunning}
                        aria-label="Send message"
                      >
                        <ArrowUp />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="px-4 pb-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-sm font-medium">Chats</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {sessions
                        .filter((s) => s.projectId === activeProject.id)
                        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                        .map((session) => (
                          <Card
                            key={session.id}
                            className={`gap-0 py-0 cursor-pointer transition-colors hover:bg-accent ${session.movedToAgent ? "opacity-50" : ""}`}
                            onClick={() => {
                              selectSession(session.id);
                              setActiveProjectId(null);
                            }}
                          >
                            <CardHeader className="flex items-center justify-between py-3.5">
                              <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium">
                                {session.movedToAgent && (
                                  <Bot className="size-4 shrink-0 text-muted-foreground" />
                                )}
                                {session.title}
                              </span>
                              <span className="ml-4 shrink-0 text-xs text-muted-foreground">
                                {session.updatedAt.toLocaleDateString([], {
                                  month: "short",
                                  day: "numeric",
                                })}{" "}
                                {formatTime(session.updatedAt)}
                              </span>
                            </CardHeader>
                          </Card>
                        ))}
                      {sessions.filter((s) => s.projectId === activeProject.id).length === 0 && (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          No conversations in this project yet. Start one above.
                        </p>
                      )}
                    </div>
                  </div>
                </ScrollArea>
              </div>
              <div className="w-2/5 min-w-[240px] max-w-[560px] shrink-0 min-h-0 flex flex-col">
                <ScrollArea className="min-h-0 flex-1">
                  <div className="p-4 space-y-6">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ScrollText className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Instructions</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (editingProjectField === "instructions") {
                              updateProject(activeProject.id, { instructions: projectInstructionsDraft });
                              setEditingProjectField(null);
                            } else {
                              setProjectInstructionsDraft(activeProject.instructions);
                              setEditingProjectField("instructions");
                            }
                          }}
                          aria-label="Edit instructions"
                        >
                          {editingProjectField === "instructions" ? <Check /> : <Pencil />}
                        </Button>
                      </div>
                      {editingProjectField === "instructions" ? (
                        <Textarea
                          autoFocus
                          value={projectInstructionsDraft}
                          onChange={(e) => setProjectInstructionsDraft(e.currentTarget.value)}
                          onBlur={() => {
                            updateProject(activeProject.id, { instructions: projectInstructionsDraft });
                            setEditingProjectField(null);
                          }}
                          className="min-h-32 text-xs"
                        />
                      ) : (
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-sans leading-relaxed">
                            {activeProject.instructions || "(No instructions set)"}
                          </pre>
                        </div>
                      )}
                    </div>
                    <Separator />
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Files</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => projectFileInputRef.current?.click()}
                          aria-label="Add file"
                        >
                          <Plus />
                        </Button>
                      </div>
                      <div className="flex flex-col gap-2">
                        {activeProject.files.map((file) => (
                          <div key={file.id} className="flex items-center gap-2 rounded-lg border p-2.5">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="truncate text-xs font-medium">{file.name}</span>
                              <span className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={async () => {
                                try {
                                  await deleteProjectFile(activeProject.id, file.id);
                                } catch {
                                  toast.error("Failed to delete file");
                                }
                              }}
                              aria-label="Delete file"
                            >
                              <X />
                            </Button>
                          </div>
                        ))}
                        {activeProject.files.length === 0 && (
                          <p className="text-xs text-muted-foreground">No files uploaded.</p>
                        )}
                      </div>
                    </div>
                    <Separator />
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ImageIcon className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Images</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => projectImageInputRef.current?.click()}
                          aria-label="Add image"
                        >
                          <Plus />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {activeProject.images.map((img) => (
                          <div key={img.id} className="relative aspect-square rounded-lg border overflow-hidden bg-muted/30 flex items-center justify-center group">
                            {img.url ? (
                              <img src={img.url} alt={img.name} className="size-full object-cover" />
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                <ImageIcon className="size-6 text-muted-foreground/50" />
                                <span className="text-[10px] text-muted-foreground truncate max-w-full px-1">{img.name}</span>
                              </div>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="absolute top-1 right-1 bg-background/80 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                              onClick={async () => {
                                try {
                                  await deleteProjectImage(activeProject.id, img.id);
                                } catch {
                                  toast.error("Failed to delete image");
                                }
                              }}
                              aria-label="Delete image"
                            >
                              <X />
                            </Button>
                          </div>
                        ))}
                        {activeProject.images.length === 0 && (
                          <p className="col-span-2 text-xs text-muted-foreground">No images uploaded.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </div>
            <input
              ref={projectFileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={async (e) => {
                const selected = Array.from(e.target.files ?? []);
                for (const file of selected) {
                  try {
                    await addProjectFile(activeProject.id, file);
                  } catch {
                    toast.error("Failed to upload file");
                  }
                }
                e.target.value = "";
              }}
            />
             <input
               ref={projectImageInputRef}
               type="file"
               multiple
               accept="image/*"
               className="hidden"
               onChange={async (e) => {
                 const selected = Array.from(e.target.files ?? []);
                 for (const file of selected) {
                   try {
                     await addProjectImage(activeProject.id, file);
                   } catch {
                     toast.error("Failed to upload image");
                   }
                 }
                 e.target.value = "";
               }}
             />
           </div>
         ) : activeAgentConsole ? (
            <AgentConsole
              agent={activeAgentConsole}
              agents={agents}
              sessions={activeAgentSessions}
              allSessions={allSessions}
              projects={projects}
             models={allModels}
             sendOnEnter={settings.sendOnEnter}
             backgroundPattern={settings.backgroundPattern}
             modelSelect={modelSelect()}
             tab={agentConsoleTab}
             composing={agentConsoleComposing}
             onComposingChange={(composing) => {
               if (composing) enterAgentCompose();
               else setAgentConsoleComposing(false);
             }}
              onUpdateAgent={updateAgent}
              onSend={(text) => { void handleSend(text); }}
              files={files}
              onRemoveFile={removeFile}
            />
         ) : isAgentTab && agentDashboardOpen ? (
           <AgentDashboard
             agents={agents}
             sessions={sessions}
             sidebarOpen={sidebarOpen}
             runningIds={runningIds}
             sendOnEnter={settings.sendOnEnter}
             modelSelect={modelSelect()}
             onOpenAgentConsole={handleOpenAgentConsole}
             onSelectSession={selectSession}
              onSend={(mode: DashboardComposeMode, agentId, text) => {
                void handleSend(text, {
                  agentId: mode === "session" ? agentId : undefined,
                  setup: mode === "agent",
                });
              }}
              files={files}
              onRemoveFile={removeFile}
              promptSuggestions={settings.promptSuggestions}
              agentSuggestions={settings.agentSuggestions}
            />
         ) : (
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 pb-8">
            <h1 className="select-none cursor-default relative z-10 mb-12 text-center text-4xl font-bold tracking-tight welcome-fade-in">
              {emptyStateHeading}
            </h1>
            <div className="relative z-10 w-full max-w-3xl">
              {agent?.pendingInput ? (
                <StructuredInputForm
                  request={agent?.pendingInput}
                  onSubmit={(values) => agent?.submitInput(values)}
                  onSwitchToText={() => agent?.skipInput()}
                />
              ) : agent?.pendingApprovals.length ? (
                <div className="grid gap-2">
                  {agent.pendingApprovals.map(({ id, request }) => (
                    <ApprovalCard
                      key={id}
                      request={request}
                      onApprove={() => agent?.approveCommand(id)}
                      onDeny={() => agent?.rejectCommand(id)}
                    />
                  ))}
                </div>
              ) : agent?.pendingSuggestion ? (
                <SuggestionCard
                  suggestion={agent.pendingSuggestion}
                  onDismiss={() => agent?.dismissSuggestion()}
                  onInstallSkill={installSkillByName}
                  onOpenConnectors={() => {
                    setView("connectors");
                  }}
                    onEnableMode={(mode) => {
                      setChatMode(mode);
                      autoModeRef.current = "none";
                      if (activeSessionId) updateSession(activeSessionId, { chat_mode: mode });
                    }}
                    onApplyAgentConfig={handleApplyAgentConfig}
                  />
              ) : (
              <>
              {composerDisclaimers}
              {!isAgentTab && (
                <ConnectorsChip onClick={() => setView("connectors")} />
              )}
              <InputGroup
                className={cn(
                  "bg-card/60 backdrop-blur-sm",
                  isTemporary && "border-dashed",
                  draggingFiles && "border-ring ring-[3px] ring-ring/50",
                )}
                onPaste={(e) => {
                  const dt = e.clipboardData;
                  if (!dt) return;
                  const pasted = Array.from(dt.files);
                  if (pasted.length === 0) {
                    for (const item of Array.from(dt.items)) {
                      if (item.kind !== "file") continue;
                      const file = item.getAsFile();
                      if (file) pasted.push(file);
                    }
                  }
                  if (pasted.length === 0) return;
                  e.preventDefault();
                  addFiles(pasted);
                }}
                {...composerDropHandlers}
              >
                {files.length > 0 && (
                  <InputGroupAddon align="block-start">
                    <AttachmentGroup className="w-full">
                      {files.map((file) => (
                        <Attachment key={file.id} size="xs">
                          <AttachmentMedia
                            variant={file.previewUrl ? "image" : "icon"}
                          >
                            {file.previewUrl ? (
                              <img src={file.previewUrl} alt={file.name} />
                            ) : file.folderPath ? (
                              <Folder />
                            ) : (
                              <FileText />
                            )}
                          </AttachmentMedia>
                          <AttachmentContent>
                            <AttachmentTitle>{file.name}</AttachmentTitle>
                            <AttachmentDescription>{file.folderPath ?? formatBytes(file.size)}</AttachmentDescription>
                          </AttachmentContent>
                          <AttachmentActions>
                            <AttachmentAction
                              aria-label={`Remove ${file.name}`}
                              onClick={() => removeFile(file.id)}
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
                  rows={1}
                  ref={(el) => {
                    emptyTextareaRef.current = el;
                    if (el) resizeComposerEl(el);
                  }}
                  value={inputText}
                  onChange={(e) => setInputText(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (settings.sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleModeSend();
                    }
                  }}
                  placeholder={emptyComposerPlaceholder}
                  className="min-h-12 basis-auto [field-sizing:fixed]! placeholder:text-muted-foreground/60"
                />
                <InputGroupAddon align="block-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <InputGroupButton size="icon-xs" aria-label="Add">
                        <Plus />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="start">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <PackagePlus />
                          Add to Project
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => assignProject(undefined)}>
                            {currentProjectId === undefined ? <Check /> : <span className="size-4" />}
                            No project
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {projects.map((p) => (
                            <DropdownMenuItem key={p.id} onClick={() => assignProject(p.id)}>
                              {currentProjectId === p.id ? <Check /> : <span className="size-4" />}
                              {p.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuItem onClick={() => void pickFolder()}>
                        <FolderPlus />
                        Add folder
                        <DropdownMenuShortcut>⌘J</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      {temporaryMenuItem}
                      <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                        <Paperclip />
                        Add files
                        <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {currentProjectName && (
                    <InputGroupButton
                      size="xs"
                      variant="ghost"
                      className="group bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500"
                      onClick={() => assignProject(undefined)}
                    >
                      <span className="group-hover:line-through">{currentProjectName}</span>
                    </InputGroupButton>
                  )}
                  {modeToggles}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFiles}
                  />
                  <input
                    ref={imageInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={handleFiles}
                  />

                  <div className="flex-1" />

                  {modelSelect()}

                  {agent?.isRunning ? (
                    <InputGroupButton
                      variant="outline"
                      size="icon-xs"
                      className="rounded-lg"
                      onClick={handleStop}
                      aria-label="Stop generation"
                    >
                      <span className="size-3 rounded-sm bg-current" />
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton
                      variant="default"
                      size="icon-xs"
                      className="rounded-lg"
                      onClick={handleModeSend}
                      disabled={
                        (!inputText.trim() && files.length === 0) || agent?.isRunning
                      }
                      aria-label="Send message"
                    >
                      <ArrowUp />
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>
              {/* Suggestion cards temporarily hidden.
              {!isAgentTab &&
                settings.promptSuggestions &&
                inputText === "" &&
                files.length === 0 && (
                  // Absolute so appearing/disappearing never shifts the
                  // centered composer — the chips float below it.
                  <div className="absolute inset-x-0 top-full">
                    <PromptSuggestionChips
                      suggestions={promptPicks}
                      onPick={(prompt) => {
                        setInputText(prompt);
                        emptyTextareaRef.current?.focus();
                      }}
                    />
                  </div>
                )}
              */}
              </>
              )}

              <p className="mt-0.5 text-center text-[10px] leading-3 text-foreground opacity-40 bg-background w-fit mx-auto">
                {selectedModelLabel ? modelLabel(selectedModelLabel) : selectedModel ?? "AI"} can make mistakes. Check important information.
              </p>
            </div>
          </div>
        )}
        </div>
        </div>
        )}
      </SidebarInset>

      <Dialog open={!!renamingHistory} onOpenChange={(open) => { if (!open) { setRenamingHistory(null); setHistoryRenameDraft(""); } }}>
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
              value={historyRenameDraft}
              onChange={(e) => setHistoryRenameDraft(e.target.value)}
              placeholder="Chat name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (renamingHistory && historyRenameDraft.trim()) {
                    updateSession(renamingHistory.id, { title: historyRenameDraft.trim() });
                  }
                  setRenamingHistory(null);
                  setHistoryRenameDraft("");
                }
                if (e.key === "Escape") { setRenamingHistory(null); setHistoryRenameDraft(""); }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setRenamingHistory(null); setHistoryRenameDraft(""); }}>Cancel</Button>
              <Button
                size="sm"
                disabled={!historyRenameDraft.trim()}
                onClick={() => {
                  if (renamingHistory && historyRenameDraft.trim()) {
                    updateSession(renamingHistory.id, { title: historyRenameDraft.trim() });
                  }
                  setRenamingHistory(null);
                  setHistoryRenameDraft("");
                }}
              >
                Rename
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Temporary chats are forgotten on leave — offer to save or delete. */}
      <Dialog
        open={!!pendingLeave}
        onOpenChange={(open) => {
          if (!open) setPendingLeave(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClockFading className="size-5" />
              Leave temporary chat?
            </DialogTitle>
            <DialogDescription>
              This conversation will be forgotten when you leave. Save it as a
              normal chat to keep it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={stayInTemporaryChat}>
              Stay
            </Button>
            <Button variant="outline" onClick={saveChatAndLeave}>
              Save as normal chat
            </Button>
            <Button variant="destructive" onClick={discardChatAndLeave}>
              Leave and delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!movedNoticeId} onOpenChange={(open) => { if (!open) setMovedNoticeId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="size-5" />
              Moved to the Agents tab
            </DialogTitle>
          </DialogHeader>
          <p className="pt-1 text-sm text-muted-foreground">
            This conversation has been moved to the Agents tab. Continue it there
            as a task — the entire conversation came along.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setMovedNoticeId(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const id = movedNoticeId;
                setMovedNoticeId(null);
                if (id) openMovedSession(id);
              }}
            >
              <Bot />
              Open in Agents
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Agent-builder cleanup: after creating an agent, the setup chat is useless. */}
      <Dialog open={!!deleteSetupDialog} onOpenChange={(open) => { if (!open) setDeleteSetupDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5" />
              {deleteSetupDialog ? `"${deleteSetupDialog.agentName}" is ready` : "Agent is ready"}
            </DialogTitle>
          </DialogHeader>
          <p className="pt-1 text-sm text-muted-foreground">
            This chat was only used to set up your new agent, so it has no ongoing
            conversation value. Delete it to keep your chat list clean? The agent
            itself is safe — it lives in the Agents tab and can be edited there.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteSetupDialog(null)}>
              Keep this chat
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const target = deleteSetupDialog;
                setDeleteSetupDialog(null);
                if (target) void handleDeleteSession(target.sessionId);
              }}
            >
              <Trash2 />
              Delete this chat
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {(() => {
        const settingsAgent = agents.find((a) => a.id === agentSettingsId);
        return settingsAgent ? (
          <AgentSettingsDialog
            agent={settingsAgent}
            open={!!agentSettingsId}
            onOpenChange={(o) => { if (!o) setAgentSettingsId(null); }}
            onUpdate={updateAgent}
            projects={projects}
            models={allModels}
          />
        ) : null;
      })()}

      {accountOpen && (
        <div className="fixed inset-0 z-[60] flex h-dvh flex-col overflow-hidden bg-background motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
          <div
            data-tauri-drag-region
            onMouseDown={startDrag}
            className="h-10 w-full shrink-0"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setAccountOpen(false)}
            aria-label="Back"
            className="absolute left-4 top-12 z-10 rounded-full"
          >
            <ArrowLeft />
          </Button>
          <AccountView hideClose onDone={() => setAccountOpen(false)} />
        </div>
      )}

    </SidebarProvider>
    </OpenCodeProvider>
  );

  async function handleProjectSend(text: string) {
    const provider = selectedModel ? findProviderForModel(selectedModel) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      openSettings();
      return;
    }

    // Pin an auto-detected mode at send time (see handleSend).
    if (autoModeRef.current !== "none" && chatMode === autoModeRef.current) {
      autoModeRef.current = "none";
    }

    // Every default chat-tab send runs the standalone task context, isolated
    // from universal memory like any agent-style run (see handleSend).
    const arc =
      chatMode === "learn" || chatMode === "research" || chatMode === "council"
        ? null
        : await agentRunContext({});

    const mode: AgentMode = arc
      ? arc.mode
      : chatMode === "research"
        ? "research"
        : chatMode === "council"
          ? "council"
          : "chat";

    try {
      const newSession = createSession(instantChatTitle(text), activeProject?.id, {
        isTemporary: isTemporary || undefined,
      });
      setActiveSessionId(newSession.id);
      setActiveProjectId(null);

      await newSession.persisted;
      const userMsg = await addMessage(newSession.id, "user", text, undefined, undefined, undefined, isTemporary);

      updateSession(newSession.id, { chat_mode: chatMode, is_temporary: isTemporary });

      const memoryContext = !arc && settings.autoMemory ? await buildMemoryContext(activeProject?.id ?? null, text) : "";
      const learnContext = !arc && chatMode === "learn" ? buildLearnSystemPrompt(learnLevel, learnSubject) : "";

      // The project's uploads (persisted files/images) are part of the context
      // of every conversation in it — this one included.
      let projectFilesText = "";
      let projectImageUrls: string[] = [];
      if (activeProject && (activeProject.files.length > 0 || activeProject.images.length > 0)) {
        const filesCtx = await buildProjectFilesContext(
          activeProject.files,
          activeProject.images,
          text,
          provider,
          selectedModel,
        );
        projectFilesText = filesCtx.text;
        if (filesCtx.skippedImages.length > 0) {
          const modelLabelStr = selectedModelLabel
            ? modelLabel(selectedModelLabel)
            : selectedModel;
          projectFilesText += `\n\n[Project images not attached — ${modelLabelStr} has no vision: ${filesCtx.skippedImages.join(", ")}]`;
        }
        projectImageUrls = filesCtx.imageDataUrls;
      }

      // currentProjectInstructions is derived from the session's project,
      // which doesn't exist yet on this first message — use the open project.
      const effectiveInstructions = arc
        ? [arc.instructions, projectFilesText].filter(Boolean).join("\n\n") || undefined
        : [
            activeProject?.instructions,
            projectFilesText,
            learnContext,
            memoryContext,
          ]
            .filter(Boolean).join("\n\n") || undefined;

      const ctrl = getAgentController(newSession.id);

      let outgoingContent: string | ContentPart[] = text;
      if (projectImageUrls.length > 0) {
        outgoingContent = [
          { type: "text" as const, text },
          ...projectImageUrls.map((url) => ({
            type: "image_url" as const,
            image_url: { url, detail: "high" as const },
          })),
        ];
      }

      const assistantMsg = await addMessage(
        newSession.id,
        "assistant",
        "",
        selectedModel,
        undefined,
        userMsg.id,
        isTemporary,
      );
      inProgressMsgIds.current.set(newSession.id, assistantMsg.id);
      ctrl.inProgressMessageId = assistantMsg.id;
      let lastSaveSig = "";
      const saveInterval = setInterval(() => {
        const sig = streamSaveSignature(ctrl);
        if (sig === lastSaveSig) return;
        lastSaveSig = sig;
        updateMessage(newSession.id, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          workStartedAt: ctrl.workStartedAt,
          workEndedAt: ctrl.workEndedAt,
          workDurationMs: ctrl.workDurationMs,
          workSegments: ctrl.workSegments.length ? [...ctrl.workSegments] : undefined,
          artifacts: ctrl.artifacts.length ? [...ctrl.artifacts] : undefined,
          files: ctrl.files.length ? [...ctrl.files] : undefined,
        });
      }, 2500);

      let result: AgentRunResult;
      try {
        result = await ctrl.run({
          provider,
          modelName: selectedModel,
          reasoningEffort,
          messages: [{ role: "user" as const, content: outgoingContent }],
          instructions: effectiveInstructions,
          mode,
          webFetchEnabled,
          projectDir: currentProjectDirectory,
          taskProfile: arc?.taskProfile,
          availableModels: allModels.map((m) => ({ name: m.name, providerId: m.providerId, displayName: m.displayName })),
          providers,
        });
      } finally {
        clearInterval(saveInterval);
        updateMessage(newSession.id, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          workStartedAt: ctrl.workStartedAt,
          workEndedAt: ctrl.workEndedAt,
          workDurationMs: ctrl.workDurationMs,
          workSegments: ctrl.workSegments.length ? [...ctrl.workSegments] : undefined,
        });
        inProgressMsgIds.current.delete(newSession.id);
      }

      if ((mode === "research" || mode === "council") && result.completed) {
        setChatMode("none");
        updateSession(newSession.id, { chat_mode: "none" });
      }

      const hasOutput = result.content || (result.activities?.length ?? 0) > 0 || (result.reasoningStreams?.length ?? 0) > 0 || (result.reasoning?.length ?? 0) > 0 || (result.artifacts?.length ?? 0) > 0 || (result.files?.length ?? 0) > 0;
      if (hasOutput) {
        updateMessage(newSession.id, assistantMsg.id, {
          content: result.content,
          reasoning: result.reasoning || undefined,
          activities: result.activities,
          reasoningStreams: result.reasoningStreams,
          workStartedAt: result.workStartedAt,
          workEndedAt: result.workEndedAt,
          workDurationMs: result.workDurationMs,
          workSegments: result.workSegments,
          artifacts: result.artifacts?.length ? result.artifacts : undefined,
          files: result.files?.length ? result.files : undefined,
        });

        if (result.content) {
          generateChatTitle(provider, selectedModel, text, result.content)
          .then((title) => {
            if (title) {
              updateSession(newSession.id, { title });
            }
          })
          .catch(() => {});
          requestFollowUpGhost(
            newSession.id,
            assistantMsg.id,
            provider,
            selectedModel,
            [
              { role: "user", content: text },
              { role: "assistant", content: result.content },
            ],
            newSession.title,
          );
          if (result.content.trim().endsWith("?") && chatMode !== "research") {
            requestQuestionOptions(
              newSession.id,
              assistantMsg.id,
              provider,
              selectedModel,
              result.content,
              [
                { role: "user", content: text },
                { role: "assistant", content: result.content },
              ],
            );
          }
          requestPostRunSuggestion(
            newSession.id,
            provider,
            selectedModel,
            [
              { role: "user", content: text },
              { role: "assistant", content: result.content },
            ],
            { allowModes: true },
          );
        }

        if (!arc && settings.autoMemory && !isTemporary && result.content) {
          void extractAndSaveMemory(provider, selectedModel, text, result.content, "global", loadMemory("global"), newSession.id).catch(() => {});
          if (activeProject?.id) {
            void extractAndSaveMemory(provider, selectedModel, text, result.content, activeProject.id, loadMemory(activeProject.id), newSession.id).catch(() => {});
          }
        }
      } else {
        deleteMessage(newSession.id, assistantMsg.id);
      }
    } catch (err) {
      toast.error(
        flattenAgentError(err) || "Failed to send message",
      );
    }
  }
}

/** A stylized document card used in the drop overlay's graphic. */
function DroppedFileCard({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-36 rounded-xl border bg-card p-3 shadow-xl ring-1 ring-ring/10",
        className,
      )}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-primary" />
        <span className="h-2 w-14 rounded-full bg-foreground/25" />
      </div>
      <div className="space-y-1.5">
        <div className="h-1.5 w-full rounded-full bg-foreground/10" />
        <div className="h-1.5 w-4/5 rounded-full bg-foreground/10" />
        <div className="h-1.5 w-3/5 rounded-full bg-foreground/10" />
      </div>
    </div>
  );
}

/** Nice full-screen graphic shown while the user drags files over the window. */
function DropOverlay() {
  return (
    <div className="fixed inset-0 z-[9999] flex select-none flex-col items-center justify-center gap-12 bg-background/80 backdrop-blur-md">
      {/* Fan of document cards */}
      <div className="relative h-44 w-72" aria-hidden>
        <DroppedFileCard
          icon={FileSpreadsheet}
          className="absolute left-3 top-9 z-0 -rotate-12 opacity-70"
        />
        <DroppedFileCard
          icon={FileText}
          className="absolute right-3 top-9 z-0 rotate-12 opacity-80"
        />
        <DroppedFileCard
          icon={FileIcon}
          className="absolute left-1/2 top-0 z-10 -translate-x-1/2"
        />
      </div>

      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
          <ArrowDownToLine className="size-7 text-primary" />
          Drop to add to chat
        </span>
        <span className="max-w-sm text-sm text-muted-foreground">
          Files are attached to your message and sent along with it
        </span>
      </div>
    </div>
  );
}
