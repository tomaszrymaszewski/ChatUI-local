import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowUp,
  ArrowLeft,
  Bot,
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
  Puzzle,
  ScrollText,
  Search,
  FolderPlus,
  FileText,
  FileCode,
  Trash2,
  X,
  RotateCcw,
  ChevronLeft,
  SquareTerminal,
  Globe,
  GraduationCap,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { ApprovalCard } from "@/components/approval-card";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentConsole } from "@/components/agent-console";
import { AgentSettingsDialog } from "@/components/agent-settings-dialog";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { MessageStream } from "@/components/message-stream";
import { SettingsView, type SettingsTab } from "@/pages/settings";
import { PatternBackground } from "@/components/background-pattern";
import { ArtifactPanel } from "@/components/artifact-panel";
import { StructuredInputForm } from "@/components/structured-input-form";
import { SuggestionCard, installSkillByName } from "@/components/suggestion-card";
import { type Artifact } from "@/lib/artifacts";
import { checkForUpdate, loadUpdateSettings, isUpdaterAvailable } from "@/lib/updater";
import { detectModeTrigger } from "@/lib/mode-triggers";
import { modelLabel } from "@/lib/model-display";
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
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type {
  Message as ChatMessage,
  MessageAttachment,
  AgentConfigPatch,
  AgentDefinition,
} from "@/types";
import { useSessions, getSessionChatMode } from "@/hooks/use-sessions";
import { useMessages, loadMessages } from "@/hooks/use-messages";
import { useProjects } from "@/hooks/use-projects";
import { useProviders } from "@/hooks/use-providers";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useAgents } from "@/hooks/use-agents";
import { useAgentController, getAgentController, useRunningSessionIds, disposeAgentController } from "@/hooks/use-deep-agent";
import type { AgentMode, AgentRunResult } from "@/lib/agent/types";
import type { AgentSandbox } from "@/lib/agent/sandbox";
import { ensureAgentWorkspace, removeAgentWorkspace } from "@/lib/agent/sandbox";
import { applyAgentConfigPatch } from "@/lib/agent/tools";
import {
  buildLearnSystemPrompt,
  loadLearnPreferences,
  type LearnLevel,
  type LearnSubject,
} from "@/lib/learn-mode";
import { generateChatTitle, instantChatTitle, type ContentPart } from "@/lib/llm";
import type { AgentMessage } from "@/lib/agent/runtime";
import {
  buildMessageTree,
  getActivePath,
  getSiblings,
} from "@/lib/message-tree";
import { prepareAttachmentContext, rebuildAttachmentContent, buildProjectFilesContext } from "@/lib/attachment-context";
import { getFileBlob, putFileBlob, deleteFileBlob } from "@/lib/attachment-store";
import { extractFileText } from "@/lib/files";
import { getModelCapabilities } from "@/lib/model-capabilities";
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

type PendingFile = MessageAttachment & { file?: File };

/**
 * Single chat mode — at most one active at a time. "temporary" is derived
 * from it (isTemporary below), so all existing temporary-message logic keeps
 * working untouched.
 */
type ChatMode = "none" | "temporary" | "learn" | "research" | "council";

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
const CHAT_MIN_WIDTH_PX = 440;
/** Drag handle (6px) + two flex gaps (2 × 8px) in the chat/artifact row. */
const ARTIFACT_ROW_OVERHEAD_PX = 22;
/** The session container's p-2 padding (2 × 8px). */
const CONTAINER_PADDING_PX = 16;

export function ChatView() {
  const [activeTab, setActiveTab] = useState<"chat" | "agent">("chat");
  const { sessions, createSession, deleteSession, updateSession, moveToAgentTab } =
    useSessions(activeTab);
  const { projects, createProject, updateProject, deleteProject, addProjectFile, deleteProjectFile, addProjectImage, deleteProjectImage, refetch: refetchProjects } =
    useProjects();
  const { providers, refetch: refetchProviders } = useProviders();
  const { settings } = useUserSettings();
  const { agents, deleteAgent, updateAgent } = useAgents();
  const isAgentTab = activeTab === "agent";

  const [activeSessionByTab, setActiveSessionByTab] = useState<
    Record<"chat" | "agent", string | null>
  >({ chat: null, agent: null });
  const activeSessionId = activeSessionByTab[activeTab] ?? null;
  const setActiveSessionId = useCallback(
    (id: string | null) =>
      setActiveSessionByTab((prev) => ({ ...prev, [activeTab]: id })),
    [activeTab],
  );
  const { messages, addMessage, updateMessage, deleteMessage, deleteTemporaryMessages } = useMessages(activeSessionId);
  const agent = useAgentController(activeSessionId);
  const runningIds = useRunningSessionIds();
  // Maps sessionId → in-progress assistant message id so the persisted message can
  // be hidden from the tree while its live streaming bubble is shown instead.
  const inProgressMsgIds = useRef<Map<string, string>>(new Map());
  const [inputText, setInputText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [webFetchEnabled, setWebFetchEnabled] = useState(true);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [welcomePrompt, setWelcomePrompt] = useState(
    () => WELCOME_PROMPTS[Math.floor(Math.random() * WELCOME_PROMPTS.length)],
  );
  const [chatMode, setChatMode] = useState<ChatMode>("none");
  const isTemporary = chatMode === "temporary";
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
  const [view, setView] = useState<"chat" | "settings" | "projects" | "history">("chat");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const openSettings = () => setView("settings");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historySelectedIds, setHistorySelectedIds] = useState<Set<string>>(new Set());
  const [renamingHistory, setRenamingHistory] = useState<{ id: string; title: string } | null>(null);
  const [historyRenameDraft, setHistoryRenameDraft] = useState("");
  // Session id for the "this conversation moved to the Agents tab" notice.
  const [movedNoticeId, setMovedNoticeId] = useState<string | null>(null);
  const [projectInputText, setProjectInputText] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [selectedChildMap, setSelectedChildMap] = useState<
    Map<string | null, string>
  >(new Map());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
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
  const sessionContainerRef = useRef<HTMLDivElement>(null);
  const autoOpenedArtifacts = useRef<Set<string>>(new Set());
  const autoModeRef = useRef<ChatMode>("none");

  useEffect(() => {
    if (settings.temporaryByDefault) {
      setChatMode((prev) => (prev === "none" ? "temporary" : prev));
    }
  }, [settings.temporaryByDefault]);

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
    }))
  );

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const activeProject = projects.find((p) => p.id === activeProjectId);
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
  // it in the render chain below.
  const activeAgentConsole = isAgentTab
    ? agents.find((a) => a.id === activeAgentConsoleId)
    : undefined;

  /**
   * Agent-mode run context for a session in the Agents tab: standalone tasks
   * run as full task-manager agents; saved-agent sessions run sandboxed on
   * the agent's own prompt/skills/connectors, restricted to its workspace +
   * user-granted folders/projects; setup chats run the builder.
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

    // Filesystem sandbox for saved agents: private workspace + granted
    // folders + granted projects' codebase folders. Standalone tasks and
    // builder chats run unrestricted (approval-gated as before).
    let sandbox: AgentSandbox | undefined;
    if (agentDef) {
      const workspace = await ensureAgentWorkspace(agentDef.id).catch(() => undefined);
      const projectDirs = (agentDef.allowedProjects ?? [])
        .map((pid) => projects.find((p) => p.id === pid)?.directory)
        .filter((d): d is string => !!d);
      sandbox = {
        agentId: agentDef.id,
        workspace,
        allowedDirectories: [
          ...(workspace ? [workspace] : []),
          ...(agentDef.allowedFolders ?? []),
          ...projectDirs,
        ],
        readChats: agentDef.readChats ?? false,
      };
    }

    return {
      mode: "task" as AgentMode,
      webFetch: webFetchEnabled && (agentDef?.capabilities.web ?? true),
      instructions,
      taskProfile: {
        toolProfile: (desc.isSetup ? "setup" : "task") as "task" | "setup",
        enableCommandTools: agentDef ? agentDef.capabilities.terminal : true,
        enableFileTools: agentDef ? (agentDef.capabilities.files ?? false) : false,
        skillNames: agentDef ? agentDef.skills : undefined,
        mcpNames: agentDef ? agentDef.connectors : undefined,
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
      : "Describe the task — the agent works locally on your Mac…"
    : isTemporary
      ? "This message and response will be forgotten when you close the chat"
      : "Ask anything";
  const emptyComposerPlaceholder = isAgentTab
    ? pendingSetup
      ? "Describe what this agent should do…"
      : pendingAgentName
        ? `Message ${pendingAgentName}…`
        : "Describe the task — the agent works locally on your Mac…"
    : isTemporary
      ? "This message and response will be forgotten when you close the chat"
      : "Ask anything";
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

  useEffect(() => {
    setSelectedChildMap(new Map());
    setEditingMessageId(null);
    setShowRawOutput(new Set());
    setArtifactPanel(null);
    setArtifactWindowMode("open");
    autoOpenedArtifacts.current = new Set();
  }, [activeSessionId]);

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

  const handleOpenArtifactFromContent = (content: string, language: string) => {
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

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) {
      setFiles((prev) => [
        ...prev,
        ...selected.map((file) => {
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
      ]);
    }
    e.target.value = "";
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((file) => file.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((file) => file.id !== id);
    });
    void deleteFileBlob(id);
  };

  const findProviderForModel = (modelName: string) => {
    const model = allModels.find((m) => m.name === modelName);
    if (!model) return null;
    return providers.find((p) => p.id === model.providerId) ?? null;
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if ((!text && files.length === 0) || agent?.isRunning) return;

    // Agent-mode runs (tasks, saved agents, builder setup) never run the
    // research/council pipelines and never see the chat-tab modes.
    const arc = isAgentTab
      ? await agentRunContext({
          agentId: pendingAgentId ?? activeSession?.agentId,
          isSetup: pendingSetup || activeSession?.isSetup === true,
        })
      : null;
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
          ? { agentId: pendingAgentId ?? undefined, isSetup: pendingSetup || undefined }
          : undefined,
      );
      sessionId = newSession.id;
      setActiveSessionId(newSession.id);
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
      storageId: a.id,
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

      updateSession(sessionId, { chat_mode: chatMode });

      const modelLabelStr = selectedModelLabel
        ? modelLabel(selectedModelLabel)
        : runModelName;
      const prep = await prepareAttachmentContext(attachments ?? [], text, provider, runModelName, modelLabelStr);
      if (prep.blocked) {
        toast.error(prep.warning ?? "This model doesn't support images.");
        return;
      }
      const userContent: string | ContentPart[] = prep.content;

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
          historyMessages.push({ role: "user", content: rebuilt ?? n.message.content });
        } else {
          historyMessages.push({ role: n.message.role, content: n.message.content });
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

      const completionMessages: AgentMessage[] = [
        ...historyMessages,
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
      const saveInterval = setInterval(() => {
        updateMessage(sessionId, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          artifacts: ctrl.artifacts.length ? [...ctrl.artifacts] : undefined,
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
        inProgressMsgIds.current.delete(sessionId);
      }

      if ((mode === "research" || mode === "council") && result.completed) {
        setChatMode("none");
        if (sessionId) updateSession(sessionId, { chat_mode: "none" });
      }

      const hasOutput = result.content || (result.activities?.length ?? 0) > 0 || (result.reasoningStreams?.length ?? 0) > 0 || (result.reasoning?.length ?? 0) > 0 || (result.artifacts?.length ?? 0) > 0;
      if (hasOutput) {
        updateMessage(sessionId, assistantMsg.id, {
          content: result.content,
          reasoning: result.reasoning || undefined,
          activities: result.activities,
          reasoningStreams: result.reasoningStreams,
          artifacts: result.artifacts?.length ? result.artifacts : undefined,
        });
      } else {
        deleteMessage(sessionId, assistantMsg.id);
      }

      if (isNewSession && result.content) {
        generateChatTitle(provider, runModelName, text, result.content)
          .then((title) => {
            if (title && sessionId) {
              updateSession(sessionId, { title });
            }
          })
          .catch(() => {});
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
        err instanceof Error ? err.message : "Failed to send message",
      );
    }
  };

  const handleStop = () => {
    agent?.stop();
  };

  // Sending while a structured-input form is pending switches back to free
  // text: the interrupted run is cancelled, the typed message waits for the
  // next send click.
  const handleModeSend = () => {
    if (agent?.pendingInput) {
      agent?.skipInput();
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

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditText(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditText("");
  };

  const handleSaveEdit = async (msg: ChatMessage) => {
    const text = editText.trim();
    if (!text || !activeSessionId) return;
    setEditingMessageId(null);
    setEditText("");

    const arc = isAgentTab
      ? await agentRunContext({
          agentId: activeSession?.agentId,
          isSetup: activeSession?.isSetup === true,
        })
      : null;
    const runModelName = arc?.model ?? selectedModel;
    const provider = runModelName ? findProviderForModel(runModelName) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      openSettings();
      return;
    }

    try {
      const parentId = msg.parent_id ?? null;
      const userMsg = await addMessage(
        activeSessionId,
        "user",
        text,
        undefined,
        undefined,
        parentId,
        isTemporary,
      );

      updateSession(activeSessionId, { chat_mode: chatMode });

      const completionMessages: AgentMessage[] = [];
      const pathToParent = activePath.slice(
        0,
        activePath.findIndex((n) => n.message.id === msg.id),
      );
      for (const n of pathToParent) {
        if (n.message.role === "user" && (n.message.attachments?.length ?? 0) > 0) {
          const rebuilt = await rebuildAttachmentContent(n.message, provider, runModelName);
          completionMessages.push({ role: "user", content: rebuilt ?? n.message.content });
        } else {
          completionMessages.push({ role: n.message.role, content: n.message.content });
        }
      }
      completionMessages.push({ role: "user" as const, content: text });

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
      const saveInterval = setInterval(() => {
        updateMessage(activeSessionId, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
        });
      }, 2500);

      let result: AgentRunResult;
      try {
        result = await ctrl.run({
          provider,
          modelName: runModelName,
          messages: completionMessages,
          instructions: arc ? arc.instructions : currentProjectInstructions || undefined,
          mode: arc?.mode,
          webFetchEnabled: arc ? arc.webFetch : webFetchEnabled,
          projectDir: currentProjectDirectory,
          taskProfile: arc?.taskProfile,
        });
      } finally {
        clearInterval(saveInterval);
        inProgressMsgIds.current.delete(activeSessionId);
      }

      const hasOutput = result.content || (result.activities?.length ?? 0) > 0 || (result.reasoningStreams?.length ?? 0) > 0 || (result.reasoning?.length ?? 0) > 0;
      if (hasOutput) {
        updateMessage(activeSessionId, assistantMsg.id, {
          content: result.content,
          reasoning: result.reasoning || undefined,
          activities: result.activities,
          reasoningStreams: result.reasoningStreams,
        });
      } else {
        deleteMessage(activeSessionId, assistantMsg.id);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to regenerate response",
      );
    }
  };

  const handleRegenerate = async (msg: ChatMessage) => {
    if (!activeSessionId || agent?.isRunning) return;

    const arc = isAgentTab
      ? await agentRunContext({
          agentId: activeSession?.agentId,
          isSetup: activeSession?.isSetup === true,
        })
      : null;
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
          completionMessages.push({ role: "user", content: rebuilt ?? n.message.content });
        } else {
          completionMessages.push({ role: n.message.role, content: n.message.content });
        }
      }

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
      const saveInterval = setInterval(() => {
        updateMessage(activeSessionId, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
        });
      }, 2500);

      let result: AgentRunResult;
      try {
        result = await ctrl.run({
          provider,
          modelName: runModelName,
          messages: completionMessages,
          instructions: arc ? arc.instructions : currentProjectInstructions || undefined,
          mode: arc?.mode,
          webFetchEnabled: arc ? arc.webFetch : webFetchEnabled,
          projectDir: currentProjectDirectory,
          taskProfile: arc?.taskProfile,
        });
      } finally {
        clearInterval(saveInterval);
        inProgressMsgIds.current.delete(activeSessionId);
      }

      const hasOutput = result.content || (result.activities?.length ?? 0) > 0 || (result.reasoningStreams?.length ?? 0) > 0 || (result.reasoning?.length ?? 0) > 0;
      if (hasOutput) {
        updateMessage(activeSessionId, assistantMsg.id, {
          content: result.content,
          reasoning: result.reasoning || undefined,
          activities: result.activities,
          reasoningStreams: result.reasoningStreams,
        });
      } else {
        deleteMessage(activeSessionId, assistantMsg.id);
      }
      updateSession(activeSessionId, {});
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to regenerate response",
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
    setChatMode(
      stored ?? (settings.temporaryByDefault && !sessionId ? "temporary" : "none"),
    );
    autoModeRef.current = "none";
  };

  const handleNewChat = () => {
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
    if (activeSessionId && activeSessionId !== id) {
      deleteTemporaryMessages(activeSessionId);
    }
    setActiveSessionId(id);
    setActiveProjectId(null);
    // A selected session defines its own agent context — drop any pending
    // one (e.g. from an open agent console or "New session").
    setPendingAgentId(null);
    setPendingSetup(false);
    applySessionChatMode(id);
    setView("chat");
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
   * Move a chat-tab session to the Agents tab as a task. The message store is
   * keyed by session id, so the entire conversation carries over; the session
   * keeps appearing in the chat sidebar grayed out with a redirect notice.
   */
  const switchToAgentMode = async (id: string) => {
    const target = sessions.find((s) => s.id === id);
    if (!target || target.type !== "chat" || target.movedToAgent) return;
    if (runningIds.has(id)) {
      toast.error("Wait for the current run to finish before switching.");
      return;
    }
    await moveToAgentTab(id);
    if (activeSessionId === id) {
      // The moved session becomes the agent tab's active session; the chat
      // tab drops it. Chat modes never apply on the agent tab.
      setActiveSessionByTab((prev) => ({ ...prev, chat: null, agent: id }));
      setChatMode("none");
      autoModeRef.current = "none";
    } else {
      setActiveSessionByTab((prev) => ({ ...prev, agent: id }));
    }
    setPendingProjectId(null);
    setPendingAgentId(null);
    setPendingSetup(false);
    setActiveTab("agent");
    setView("chat");
    toast.success("Conversation moved to the Agents tab");
  };

  /** Open a moved session from the chat-tab redirect notice. */
  const openMovedSession = (id: string) => {
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
    setChatMode("none");
    autoModeRef.current = "none";
    setView("chat");
  };

  const switchTab = (tab: "chat" | "agent") => {
    if (tab === activeTab) return;
    if (activeSessionId) {
      deleteTemporaryMessages(activeSessionId);
    }
    setPendingAgentId(null);
    setPendingSetup(false);
    setActiveTab(tab);
    // Each tab keeps its own active session; restore that session's mode.
    applySessionChatMode(activeSessionByTab[tab] ?? null);
    setView("chat");
  };

  const handleNewTask = () => {
    if (activeSessionId) {
      deleteTemporaryMessages(activeSessionId);
    }
    setActiveSessionId(null);
    setActiveProjectId(null);
    setPendingProjectId(null);
    setPendingAgentId(null);
    setPendingSetup(false);
    setActiveAgentConsoleId(null);
    applySessionChatMode(null);
    setView("chat");
  };

  const handleNewAgentSetup = () => {
    if (activeSessionId) {
      deleteTemporaryMessages(activeSessionId);
    }
    setActiveSessionId(null);
    setActiveProjectId(null);
    setPendingProjectId(null);
    setPendingAgentId(null);
    setPendingSetup(true);
    setActiveAgentConsoleId(null);
    applySessionChatMode(null);
    setView("chat");
  };

  const handleStartAgentSession = (agentId: string) => {
    if (activeSessionId) {
      deleteTemporaryMessages(activeSessionId);
    }
    setActiveSessionId(null);
    setActiveProjectId(null);
    setPendingProjectId(null);
    setPendingAgentId(agentId);
    setPendingSetup(false);
    setActiveAgentConsoleId(null);
    applySessionChatMode(null);
    setView("chat");
  };

  /**
   * Open an agent's console (clicking the agent in the sidebar): sessions and
   * the composer in the middle, instructions/preferences/access on the right.
   * The composer sends with this agent, so the first send opens a session.
   */
  const handleOpenAgentConsole = (agentId: string) => {
    if (activeSessionId) {
      deleteTemporaryMessages(activeSessionId);
    }
    setActiveSessionId(null);
    setActiveProjectId(null);
    setPendingProjectId(null);
    setPendingAgentId(agentId);
    setPendingSetup(false);
    setActiveAgentConsoleId(agentId);
    applySessionChatMode(null);
    setView("chat");
  };

  /** Leave the agent console back to the Agents-tab empty state. */
  const closeAgentConsole = () => {
    setActiveAgentConsoleId(null);
    setPendingAgentId(null);
  };

  const handleDeleteAgent = (id: string) => {
    const def = agents.find((a) => a.id === id);
    // Clean up the agent's knowledge-file blobs and on-disk workspace.
    if (def) {
      for (const att of def.attachments ?? []) {
        void deleteFileBlob(att.storageId ?? att.id);
      }
      void removeAgentWorkspace(id);
    }
    deleteAgent(id);
    if (agentSettingsId === id) setAgentSettingsId(null);
    if (activeAgentConsoleId === id) setActiveAgentConsoleId(null);
    toast("Agent deleted — its sessions stay as task sessions");
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "u") {
        e.preventDefault();
        fileInputRef.current?.click();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const modelSelectContent = (
    <SelectContent className="min-w-56">
      {allModels.length === 0 ? (
        <SelectItem value="__no_models__" disabled>
          No models — add a provider in Settings
        </SelectItem>
      ) : (
        allModels.map((m) => (
          <SelectItem key={m.id} value={m.name}>
            {modelLabel(m)} ({m.providerName})
          </SelectItem>
        ))
      )}
    </SelectContent>
  );

  const selectedModelLabel = allModels.find((m) => m.name === selectedModel);

  const modelSelect = () => (
    <Select value={selectedModel} onValueChange={setSelectedModel}>
      <SelectTrigger
        size="sm"
        className="border-0 bg-transparent shadow-none dark:bg-transparent"
      >
        <SelectValue placeholder="Select model">
          {selectedModelLabel
            ? modelLabel(selectedModelLabel)
            : "Select model"}
        </SelectValue>
      </SelectTrigger>
      {modelSelectContent}
    </Select>
  );

  const modeToggle = (
    mode: ChatMode,
    label: string,
    title: string,
    icon: React.ReactNode,
    activeClass: string,
  ) => {
    const active = chatMode === mode;
    const artifactOpen = !!artifactPanel;
    return (
      <InputGroupButton
        size={active && !artifactOpen ? "xs" : "icon-xs"}
        variant="ghost"
        aria-label={`Toggle ${label} mode`}
        title={title}
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
        "temporary",
        "Temporary",
        "Temporary message - will be deleted when you close the chat",
        <ClockFading className={chatMode === "temporary" ? "fill-blue-500/30" : ""} />,
        "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500",
      )}
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

  const renderMessage = (msg: ChatMessage) => {
    const { siblings, currentIndex } = getSiblings(nodeMap, msg, roots);
    const hasBranches = siblings.length > 1;
    const isEditing = editingMessageId === msg.id;
    const isRaw = showRawOutput.has(msg.id);

    return (
      <MessageScrollerItem
        key={msg.id}
        messageId={msg.id}
        scrollAnchor={msg.role === "user"}
      >
        {msg.role === "user" ? (
          <Message align="end">
            <MessageContent>
              {msg.attachments?.map((attachment) => (
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
                    ) : (
                      <FileText />
                    )}
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{attachment.name}</AttachmentTitle>
                    <AttachmentDescription>
                      {formatBytes(attachment.size)}
                    </AttachmentDescription>
                  </AttachmentContent>
                </Attachment>
              ))}
              {isEditing ? (
                <div className="flex w-full max-w-[80%] flex-col gap-2 self-end">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.currentTarget.value)}
                    className="min-h-20 resize-none text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveEdit(msg);
                      }
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={handleCancelEdit}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="xs"
                      onClick={() => handleSaveEdit(msg)}
                      disabled={!editText.trim()}
                    >
                      Send
                    </Button>
                  </div>
                </div>
              ) : (
                msg.content && (
                  <Bubble>
                    <BubbleContent>
                      <MarkdownRenderer content={msg.content} onOpenArtifact={handleOpenArtifactFromContent} />
                    </BubbleContent>
                  </Bubble>
                )
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
    <SidebarProvider
      className="relative h-dvh min-h-0 overflow-hidden"
      style={{ "--sidebar-width-icon": "3rem" } as React.CSSProperties}
    >
      <AppSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        view={view}
        settingsTab={settingsTab}
        activeTab={activeTab}
        onSelectSession={selectSession}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteSession}
        onRenameChat={(id, title) => updateSession(id, { title })}
        onSettings={openSettings}
        onSettingsTabChange={setSettingsTab}
        onExitSettings={() => setView("chat")}
        onProjects={() => setView("projects")}
        onHistory={() => setView("history")}
        onComingSoon={comingSoon}
        onTabChange={switchTab}
        onNewTask={handleNewTask}
        onNewAgent={handleNewAgentSetup}
        onSwitchToAgent={switchToAgentMode}
        agents={agents}
        onOpenAgentConsole={handleOpenAgentConsole}
        onStartAgentSession={handleStartAgentSession}
        onDeleteAgent={handleDeleteAgent}
        onOpenAgentSettings={setAgentSettingsId}
        projects={projects}
        runningIds={runningIds}
      />

      <SidebarTrigger
        className="fixed left-18 top-1.5 z-50 size-4.5 [&_svg]:size-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=expanded]:text-sidebar-foreground peer-data-[state=expanded]:hover:bg-sidebar-accent peer-data-[state=expanded]:hover:text-sidebar-accent-foreground"
        onClick={() => {
          if (artifactPanel && artifactWindowMode !== "minimized") {
            setArtifactWindowMode("minimized");
          }
        }}
      />

      <SidebarInset>
        {view === "settings" ? (
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
                    <Plus />
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
        {/* The pattern belongs to the chat/session area only: the project and
            agent consoles render it inside their chat column, and the options
            panel stays plain. Here it covers just the composer empty state. */}
        {!activeSession && !activeProject && !activeAgentConsole && (
          <PatternBackground pattern={settings.backgroundPattern} />
        )}
        <header
          data-tauri-drag-region
          onMouseDown={startDrag}
          className="relative flex h-10 shrink-0 select-none items-center px-4"
        >
          {(activeProject || (activeAgentConsole && !activeSession)) && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() =>
                activeProject ? setActiveProjectId(null) : closeAgentConsole()
              }
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
                <span className="flex max-w-xs items-center gap-2 px-1 py-0.5">
                  <AgentAvatar seed={activeAgentConsole.id} className="size-4.5" />
                  <span className="truncate text-sm font-medium">
                    {activeAgentConsole.name}
                  </span>
                </span>
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
          <div className="ml-auto flex items-center gap-2" />
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
        {activeSession ? (
          <div ref={sessionContainerRef} className="relative flex min-h-0 flex-1 gap-2 overflow-hidden p-2">
            <div className={`relative flex min-h-0 min-w-0 flex-1 flex-col transition-[flex] duration-300 ease-out${artifactWindowMode === "expanded" ? " hidden" : ""}`}>
            <MessageScrollerProvider
              autoScroll
              defaultScrollPosition="last-anchor"
              scrollPreviousItemPeek={64}
            >
              <MessageScroller className="flex-1">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
                    {activePath.map((node) => {
                      // Hide the in-progress assistant message while its live
                      // streaming bubble (below) is showing the same run.
                      if (
                        agent?.isRunning &&
                        node.message.id === inProgressMsgIds.current.get(activeSessionId ?? "")
                      ) {
                        return null;
                      }
                      return renderMessage(node.message);
                    })}

                    {agent?.isRunning && (
                      <MessageScrollerItem messageId="thinking">
                        <Message>
                          <MessageContent>
                            {agent?.streamingContent || agent?.streamingReasoning || agent?.activities.length > 0 ? (
                              <MessageStream
                                content={agent?.streamingContent}
                                activities={agent?.activities}
                                reasoning={agent?.streamingReasoning}
                                reasoningStreams={agent?.reasoningStreams}
                                todos={agent?.todos}
                                live
                              />
                            ) : (
                              <Marker role="status">
                                <MarkerIcon>
                                  <Spinner />
                                </MarkerIcon>
                                <MarkerContent className="shimmer">
                                  Thinking…
                                </MarkerContent>
                              </Marker>
                            )}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    )}
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
                ) : agent?.pendingApproval ? (
                  <ApprovalCard
                    request={agent.pendingApproval}
                    onApprove={() => agent?.approveCommand()}
                    onDeny={() => agent?.rejectCommand()}
                  />
                 ) : agent?.pendingSuggestion ? (
                   <SuggestionCard
                     suggestion={agent.pendingSuggestion}
                     onDismiss={() => agent?.dismissSuggestion()}
                     onInstallSkill={installSkillByName}
                     onOpenConnectors={() => {
                       setSettingsTab("connectors");
                       setView("settings");
                     }}
                      onEnableMode={(mode) => {
                        setChatMode(mode);
                        autoModeRef.current = "none";
                        if (activeSessionId) updateSession(activeSessionId, { chat_mode: mode });
                      }}
                      onSwitchToAgent={
                        !isAgentTab && activeSessionId
                          ? () => void switchToAgentMode(activeSessionId)
                          : undefined
                      }
                      onApplyAgentConfig={handleApplyAgentConfig}
                    />
                 ) : (
                 <InputGroup className={isTemporary ? "border-dashed" : undefined}>
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
                              ) : (
                                <FileText />
                              )}
                            </AttachmentMedia>
                            <AttachmentContent>
                              <AttachmentTitle>{file.name}</AttachmentTitle>
                              <AttachmentDescription>
                                {formatBytes(file.size)}
                              </AttachmentDescription>
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
                    value={inputText}
                    onChange={(e) => setInputText(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (settings.sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleModeSend();
                      }
                    }}
                    placeholder={chatComposerPlaceholder}
                    className="max-h-40 min-h-12"
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
                            <FolderPlus />
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
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Puzzle />
                            Skills
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem onClick={() => setWebFetchEnabled((prev) => !prev)}>
                              <Globe />
                              Web Fetch
                              {webFetchEnabled ? <Check className="ml-auto" /> : <span className="ml-auto size-4" />}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                          <Paperclip />
                          Add files
                          <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        {!isAgentTab && activeSession && !activeSession.movedToAgent && (
                          <DropdownMenuItem onClick={() => void switchToAgentMode(activeSession.id)}>
                            <Bot />
                            Switch to Agent Mode
                          </DropdownMenuItem>
                        )}
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
                )}

                <p className="mt-2 text-center text-xs text-muted-foreground">
                  ChatUI can make mistakes. Check important information.
                </p>
              </div>
            </div>
            </div>
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
                      placeholder={isTemporary ? "This message and response will be forgotten when you close the chat" : "Ask anything about this project..."}
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
            sessions={sessions
              .filter((s) => s.agentId === activeAgentConsole.id)
              .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())}
            projects={projects}
            models={allModels}
            sendOnEnter={settings.sendOnEnter}
            runningIds={runningIds}
            backgroundPattern={settings.backgroundPattern}
            modelSelect={modelSelect()}
            onUpdateAgent={updateAgent}
            onSelectSession={selectSession}
            onSend={(text) => { void handleSend(text); }}
          />
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 pb-8">
            <h1 className="select-none cursor-default relative z-10 mb-12 text-center text-4xl font-semibold tracking-tight welcome-fade-in">
              {emptyStateHeading}
            </h1>
            <div className="relative z-10 w-full max-w-3xl">
              {agent?.pendingInput ? (
                <StructuredInputForm
                  request={agent?.pendingInput}
                  onSubmit={(values) => agent?.submitInput(values)}
                  onSwitchToText={() => agent?.skipInput()}
                />
              ) : agent?.pendingApproval ? (
                <ApprovalCard
                  request={agent.pendingApproval}
                  onApprove={() => agent?.approveCommand()}
                  onDeny={() => agent?.rejectCommand()}
                />
              ) : agent?.pendingSuggestion ? (
                <SuggestionCard
                  suggestion={agent.pendingSuggestion}
                  onDismiss={() => agent?.dismissSuggestion()}
                  onInstallSkill={installSkillByName}
                  onOpenConnectors={() => {
                    setSettingsTab("connectors");
                    setView("settings");
                  }}
                    onEnableMode={(mode) => {
                      setChatMode(mode);
                      autoModeRef.current = "none";
                      if (activeSessionId) updateSession(activeSessionId, { chat_mode: mode });
                    }}
                    onSwitchToAgent={
                      !isAgentTab && activeSessionId
                        ? () => void switchToAgentMode(activeSessionId)
                        : undefined
                    }
                    onApplyAgentConfig={handleApplyAgentConfig}
                  />
              ) : (
              <InputGroup className={`bg-card/60 backdrop-blur-sm ${isTemporary ? "border-dashed" : ""}`}>
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
                            ) : (
                              <FileText />
                            )}
                          </AttachmentMedia>
                          <AttachmentContent>
                            <AttachmentTitle>{file.name}</AttachmentTitle>
                            <AttachmentDescription>
                              {formatBytes(file.size)}
                            </AttachmentDescription>
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
                  value={inputText}
                  onChange={(e) => setInputText(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (settings.sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleModeSend();
                    }
                  }}
                  placeholder={emptyComposerPlaceholder}
                  className="max-h-40 min-h-12 placeholder:text-muted-foreground/60"
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
                          <FolderPlus />
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
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Puzzle />
                          Skills
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => setWebFetchEnabled((prev) => !prev)}>
                            <Globe />
                            Web Fetch
                            {webFetchEnabled ? <Check className="ml-auto" /> : <span className="ml-auto size-4" />}
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
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
              )}

              <p className="mt-2 text-center text-xs text-foreground opacity-40 bg-background w-fit mx-auto">
                AI can make mistakes. Check important information.
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

    const mode: AgentMode =
      chatMode === "research" ? "research" : chatMode === "council" ? "council" : "chat";

    try {
      const newSession = createSession(instantChatTitle(text), activeProject?.id);
      setActiveSessionId(newSession.id);
      setActiveProjectId(null);

      await newSession.persisted;
      const userMsg = await addMessage(newSession.id, "user", text, undefined, undefined, undefined, isTemporary);

      updateSession(newSession.id, { chat_mode: chatMode });

      const memoryContext = settings.autoMemory ? await buildMemoryContext(activeProject?.id ?? null, text) : "";
      const learnContext = chatMode === "learn" ? buildLearnSystemPrompt(learnLevel, learnSubject) : "";

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
      const effectiveInstructions = [
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
      const saveInterval = setInterval(() => {
        updateMessage(newSession.id, assistantMsg.id, {
          content: ctrl.streamingContent,
          reasoning: ctrl.streamingReasoning || undefined,
          activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
          reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
          artifacts: ctrl.artifacts.length ? [...ctrl.artifacts] : undefined,
        });
      }, 2500);

      let result: AgentRunResult;
      try {
        result = await ctrl.run({
          provider,
          modelName: selectedModel,
          messages: [{ role: "user" as const, content: outgoingContent }],
          instructions: effectiveInstructions,
          mode,
          webFetchEnabled,
          projectDir: currentProjectDirectory,
          availableModels: allModels.map((m) => ({ name: m.name, providerId: m.providerId, displayName: m.displayName })),
          providers,
        });
      } finally {
        clearInterval(saveInterval);
        inProgressMsgIds.current.delete(newSession.id);
      }

      if ((mode === "research" || mode === "council") && result.completed) {
        setChatMode("none");
        updateSession(newSession.id, { chat_mode: "none" });
      }

      const hasOutput = result.content || (result.activities?.length ?? 0) > 0 || (result.reasoningStreams?.length ?? 0) > 0 || (result.reasoning?.length ?? 0) > 0 || (result.artifacts?.length ?? 0) > 0;
      if (hasOutput) {
        updateMessage(newSession.id, assistantMsg.id, {
          content: result.content,
          reasoning: result.reasoning || undefined,
          activities: result.activities,
          reasoningStreams: result.reasoningStreams,
          artifacts: result.artifacts?.length ? result.artifacts : undefined,
        });

        if (result.content) {
          generateChatTitle(provider, selectedModel, text, result.content)
          .then((title) => {
            if (title) {
              updateSession(newSession.id, { title });
            }
          })
          .catch(() => {});
        }

        if (settings.autoMemory && !isTemporary && result.content) {
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
        err instanceof Error ? err.message : "Failed to send message",
      );
    }
  }
}
