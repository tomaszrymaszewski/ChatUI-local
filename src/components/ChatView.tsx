import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowUp,
  ArrowLeft,
  Paperclip,
  ChartColumnBig,
  Check,
  ClockFading,
  Copy,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Microscope,
  MoreHorizontal,
  Pencil,
  Plus,
  Puzzle,
  ScrollText,
  GalleryVerticalEnd,
  Search,
  FolderPlus,
  FileText,
  FileCode,
  Trash2,
  X,
  RotateCcw,
  ChevronLeft,
  SquareTerminal,
  Brain,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { AgentView } from "@/components/AgentView";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { SettingsDialog } from "@/pages/settings";
import { InteractiveGrid } from "@/components/interactive-grid";
import { ArtifactPanel } from "@/components/artifact-panel";
import { extractArtifacts, type Artifact } from "@/lib/artifacts";
import {
  extractUrlsFromText,
  buildResearchSeed,
  computeExpansionFrontier,
  validateResearchInput,
} from "@/lib/research/seed";
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
} from "@/types";
import { useSessions } from "@/hooks/use-sessions";
import { useMessages } from "@/hooks/use-messages";
import { useProjects } from "@/hooks/use-projects";
import { useProviders } from "@/hooks/use-providers";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useDeepResearch } from "@/hooks/use-deep-research";
import { streamChatCompletion, generateChatTitle, type ChatCompletionMessage, type ContentPart } from "@/lib/llm";
import { loadInstalledSkillsPrompt } from "@/lib/skills-library";
import { getAllTools } from "@/lib/tools";
import {
  buildMessageTree,
  getActivePath,
  getSiblings,
} from "@/lib/message-tree";
import { prepareAttachmentContext } from "@/lib/attachment-context";
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

export function ChatView() {
  const [activeTab, setActiveTab] = useState<"chat" | "agent">("chat");
  const { sessions, createSession, deleteSession, updateSession } =
    useSessions(activeTab);
  const { sessions: agentSessions } = useSessions("agent");
  const { projects, createProject, updateProject, deleteProject, addProjectFile, deleteProjectFile, addProjectImage, deleteProjectImage, refetch: refetchProjects } =
    useProjects();
  const { providers } = useProviders();
  const { settings } = useUserSettings();

  const [activeSessionByTab, setActiveSessionByTab] = useState<
    Record<"chat" | "agent", string | null>
  >({ chat: null, agent: null });
  const activeSessionId = activeSessionByTab[activeTab] ?? null;
  const setActiveSessionId = useCallback(
    (id: string | null) =>
      setActiveSessionByTab((prev) => ({ ...prev, [activeTab]: id })),
    [activeTab],
  );
  const { messages, addMessage, deleteTemporaryMessages } = useMessages(activeSessionId);
  const [inputText, setInputText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [showThinkingProcess, setShowThinkingProcess] = useState(false);
  const [webFetchEnabled, setWebFetchEnabled] = useState(true);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [welcomePrompt, setWelcomePrompt] = useState(
    () => WELCOME_PROMPTS[Math.floor(Math.random() * WELCOME_PROMPTS.length)],
  );
  const [isTemporary, setIsTemporary] = useState(false);
  const [isResearch, setIsResearch] = useState(false);
  // Deep Research targets whatever session/user-message it was started under, resolved locally in
  // handleDeepResearch (not via the activeSessionId state, which may not have re-rendered yet if a
  // new session was just created -- same reason handleSend keeps its own local `sessionId` variable).
  const deepResearchTargetRef = useRef<{ sessionId: string; userMsgId: string } | null>(null);
  const deepResearch = useDeepResearch({
    onReport: async (report, modelUsed) => {
      const target = deepResearchTargetRef.current;
      if (!target) return;
      await addMessage(target.sessionId, "assistant", report, modelUsed, undefined, target.userMsgId, isTemporary);
    },
  });
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [renamingHistory, setRenamingHistory] = useState<{ id: string; title: string } | null>(null);
  const [historyRenameDraft, setHistoryRenameDraft] = useState("");
  const [projectInputText, setProjectInputText] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [selectedChildMap, setSelectedChildMap] = useState<
    Map<string | null, string>
  >(new Map());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showRawOutput, setShowRawOutput] = useState<Set<string>>(new Set());
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const projectImageInputRef = useRef<HTMLInputElement>(null);
  const [editingProjectField, setEditingProjectField] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectInstructionsDraft, setProjectInstructionsDraft] = useState("");
  const [showNewProjectCard, setShowNewProjectCard] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectInstructions, setNewProjectInstructions] = useState("");
  const [artifactPanel, setArtifactPanel] = useState<{ artifacts: Artifact[]; activeIndex: number } | null>(null);

  useEffect(() => {
    if (settings.temporaryByDefault) setIsTemporary(true);
  }, [settings.temporaryByDefault]);

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
    setExpandedReasoning(new Set());
  }, [activeSessionId]);

  const comingSoon = (feature: string) => toast(`${feature} is coming soon`);

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
        ...selected.map((file) => ({
          id: generateId(),
          name: file.name,
          size: file.size,
          type: file.type,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined,
          file,
        })),
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
  };

  const findProviderForModel = (modelName: string) => {
    const model = allModels.find((m) => m.name === modelName);
    if (!model) return null;
    return providers.find((p) => p.id === model.providerId) ?? null;
  };

  const handleSend = async () => {
    if (isResearch) {
      void handleDeepResearch();
      return;
    }

    const text = inputText.trim();
    if ((!text && files.length === 0) || isThinking) return;

    const provider = selectedModel ? findProviderForModel(selectedModel) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      setSettingsOpen(true);
      return;
    }

    // Vision check: block image attachments for non-vision models
    const hasImages = files.some((f) => f.type.startsWith("image/"));
    if (hasImages) {
      const caps = await getModelCapabilities(provider, selectedModel);
      if (!caps.vision) {
        toast.error(
          `${selectedModelLabel?.displayName || selectedModelLabel?.name || selectedModel} doesn't support image input. Remove the image or switch to a vision-capable model.`,
        );
        return;
      }
    }

    const attachments = files.length > 0 ? files : undefined;
    setInputText("");
    setFiles([]);
    setIsThinking(true);
    setStreamingContent("");
    setStreamingReasoning("");
    setShowThinkingProcess(false);

    let sessionId = activeSessionId;
    let sessionPersisted = Promise.resolve();
    let isNewSession = false;

    if (!sessionId) {
      const newSession = createSession(
        (text || "Attachments").slice(0, 30),
        pendingProjectId ?? undefined,
      );
      sessionId = newSession.id;
      setActiveSessionId(newSession.id);
      setPendingProjectId(null);
      sessionPersisted = newSession.persisted;
      isNewSession = true;
    }

    if (!sessionId) throw new Error("Failed to create session");

    const userAttachments = attachments?.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      type: a.type,
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

      updateSession(sessionId, {});

      const modelLabel = selectedModelLabel?.displayName || selectedModelLabel?.name || selectedModel;
      const prep = await prepareAttachmentContext(attachments ?? [], text, provider, selectedModel, modelLabel);
      if (prep.blocked) {
        toast.error(prep.warning ?? "This model doesn't support images.");
        return;
      }
      const userContent: string | ContentPart[] = prep.content;

      const memoryContext = settings.autoMemory ? await buildMemoryContext(currentProjectId ?? null, text) : "";
      // isResearch is handled entirely by the early handleSend guard above (dispatches to
      // handleDeepResearch instead) -- normal-chat instructions no longer branch on it.
      const effectiveInstructions = [currentProjectInstructions, memoryContext]
        .filter(Boolean).join("\n\n") || undefined;

      const completionMessages: ChatCompletionMessage[] = [
        ...activePath.map((n) => ({
          role: n.message.role as "user" | "assistant" | "system",
          content: n.message.content,
        })),
        { role: "user" as const, content: userContent },
      ];

      const controller = new AbortController();
      setAbortController(controller);

      const tools = getAllTools(webFetchEnabled);
      const skillsContext = await loadInstalledSkillsPrompt();

      let fullResponse = "";
      let fullReasoning = "";
      try {
        for await (const chunk of streamChatCompletion(
          provider,
          selectedModel,
          completionMessages,
          controller.signal,
          tools,
          effectiveInstructions,
          skillsContext,
        )) {
          if (chunk.content) {
            fullResponse += chunk.content;
            setStreamingContent(fullResponse);
          }
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning;
            setStreamingReasoning(fullReasoning);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          if (fullResponse) {
            await addMessage(sessionId, "assistant", fullResponse, selectedModel, undefined, userMsg.id, isTemporary, fullReasoning || undefined);
          }
          return;
        }
        throw err;
      }

      if (fullResponse) {
        await addMessage(sessionId, "assistant", fullResponse, selectedModel, undefined, userMsg.id, isTemporary, fullReasoning || undefined);
      }

      if (isNewSession && fullResponse) {
        generateChatTitle(provider, selectedModel, text, fullResponse)
          .then((title) => {
            if (title && sessionId) {
              updateSession(sessionId, { title });
            }
          })
          .catch(() => {});
      }

      // Auto-extract durable memories (background, best-effort)
      if (settings.autoMemory && !isTemporary && fullResponse) {
        void extractAndSaveMemory(provider, selectedModel, text, fullResponse, "global", loadMemory("global"), sessionId).catch(() => {});
        if (currentProjectId) {
          void extractAndSaveMemory(provider, selectedModel, text, fullResponse, currentProjectId, loadMemory(currentProjectId), sessionId).catch(() => {});
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setIsThinking(false);
      setStreamingContent("");
      setStreamingReasoning("");
      setShowThinkingProcess(false);
      setAbortController(null);
    }
  };

  const handleDeepResearch = async () => {
    const text = inputText.trim();
    if ((!text && files.length === 0) || isThinking || deepResearch.isRunning) return;

    const provider = selectedModel ? findProviderForModel(selectedModel) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      setSettingsOpen(true);
      return;
    }

    const seedFiles = files
      .filter((f): f is PendingFile & { file: File } => !!f.file)
      .map((f) => ({ name: f.name, file: f.file }));

    setInputText("");
    setFiles([]);

    let sessionId = activeSessionId;
    let sessionPersisted = Promise.resolve();
    if (!sessionId) {
      const newSession = createSession((text || "Deep Research").slice(0, 30), pendingProjectId ?? undefined);
      sessionId = newSession.id;
      setActiveSessionId(newSession.id);
      setPendingProjectId(null);
      sessionPersisted = newSession.persisted;
    }
    if (!sessionId) throw new Error("Failed to create session");

    try {
      await sessionPersisted;
      const parentId = activePath.length > 0 ? activePath[activePath.length - 1].message.id : null;
      const userMsg = await addMessage(sessionId, "user", text, undefined, undefined, parentId, isTemporary);
      updateSession(sessionId, {});

      deepResearchTargetRef.current = { sessionId, userMsgId: userMsg.id };

      const directUrls = extractUrlsFromText(text);
      const seed = await buildResearchSeed(seedFiles, directUrls);
      validateResearchInput(text, seed.text);
      const providedUrls = Array.from(new Set([...seed.fetchedUrls, ...computeExpansionFrontier(seed)]));

      await deepResearch.start(text, provider, selectedModel, seed.text || undefined, providedUrls, currentProjectInstructions || undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start Deep Research");
    }
  };

  const handleStop = () => {
    abortController?.abort();
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

    const provider = selectedModel ? findProviderForModel(selectedModel) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      setSettingsOpen(true);
      return;
    }

    setIsThinking(true);
    setStreamingContent("");
    setStreamingReasoning("");
    setShowThinkingProcess(false);

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

      updateSession(activeSessionId, {});

      const completionMessages: ChatCompletionMessage[] = [];
      const pathToParent = activePath.slice(
        0,
        activePath.findIndex((n) => n.message.id === msg.id),
      );
      for (const n of pathToParent) {
        completionMessages.push({
          role: n.message.role as "user" | "assistant" | "system",
          content: n.message.content,
        });
      }
      completionMessages.push({ role: "user" as const, content: text });

      const controller = new AbortController();
      setAbortController(controller);

      const tools = getAllTools(webFetchEnabled);
      const skillsContext = await loadInstalledSkillsPrompt();

      let fullResponse = "";
      let fullReasoning = "";
      try {
        for await (const chunk of streamChatCompletion(
          provider,
          selectedModel,
          completionMessages,
          controller.signal,
          tools,
          currentProjectInstructions,
          skillsContext,
        )) {
          if (chunk.content) {
            fullResponse += chunk.content;
            setStreamingContent(fullResponse);
          }
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning;
            setStreamingReasoning(fullReasoning);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          if (fullResponse) {
            await addMessage(activeSessionId, "assistant", fullResponse, selectedModel, undefined, userMsg.id, isTemporary, fullReasoning || undefined);
          }
          return;
        }
        throw err;
      }

      if (fullResponse) {
        await addMessage(activeSessionId, "assistant", fullResponse, selectedModel, undefined, userMsg.id, isTemporary, fullReasoning || undefined);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to regenerate response",
      );
    } finally {
      setIsThinking(false);
      setStreamingContent("");
      setStreamingReasoning("");
      setShowThinkingProcess(false);
      setAbortController(null);
    }
  };

  const handleRegenerate = async (msg: ChatMessage) => {
    if (!activeSessionId || isThinking) return;

    const provider = selectedModel ? findProviderForModel(selectedModel) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      setSettingsOpen(true);
      return;
    }

    setIsThinking(true);
    setStreamingContent("");
    setStreamingReasoning("");
    setShowThinkingProcess(false);

    try {
      const parentId = msg.parent_id ?? null;
      const msgIsTemporary = msg.is_temporary ?? false;

      const completionMessages: ChatCompletionMessage[] = [];
      const pathToParent = activePath.slice(
        0,
        activePath.findIndex((n) => n.message.id === msg.id),
      );
      for (const n of pathToParent) {
        completionMessages.push({
          role: n.message.role as "user" | "assistant" | "system",
          content: n.message.content,
        });
      }

      const controller = new AbortController();
      setAbortController(controller);

      const tools = getAllTools(webFetchEnabled);
      const skillsContext = await loadInstalledSkillsPrompt();

      let fullResponse = "";
      let fullReasoning = "";
      try {
        for await (const chunk of streamChatCompletion(
          provider,
          selectedModel,
          completionMessages,
          controller.signal,
          tools,
          currentProjectInstructions,
          skillsContext,
        )) {
          if (chunk.content) {
            fullResponse += chunk.content;
            setStreamingContent(fullResponse);
          }
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning;
            setStreamingReasoning(fullReasoning);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          if (fullResponse) {
            await addMessage(activeSessionId, "assistant", fullResponse, selectedModel, undefined, parentId, msgIsTemporary, fullReasoning || undefined);
          }
          return;
        }
        throw err;
      }

      if (fullResponse) {
        await addMessage(activeSessionId, "assistant", fullResponse, selectedModel, undefined, parentId, msgIsTemporary, fullReasoning || undefined);
      }
      updateSession(activeSessionId, {});
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to regenerate response",
      );
    } finally {
      setIsThinking(false);
      setStreamingContent("");
      setStreamingReasoning("");
      setShowThinkingProcess(false);
      setAbortController(null);
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

  const handleNewChat = () => {
    if (activeSessionId) {
      deleteTemporaryMessages(activeSessionId);
    }
    setActiveSessionId(null);
    setActiveProjectId(null);
    setWelcomePrompt(
      WELCOME_PROMPTS[Math.floor(Math.random() * WELCOME_PROMPTS.length)],
    );
  };

  const selectSession = (id: string) => {
    if (activeSessionId && activeSessionId !== id) {
      deleteTemporaryMessages(activeSessionId);
    }
    setActiveSessionId(id);
    setActiveProjectId(null);
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession(id);
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
    } catch (err) {
      toast.error("Failed to delete chat");
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
    <SelectContent>
      {allModels.length === 0 ? (
        <SelectItem value="__no_models__" disabled>
          No models — add a provider in Settings
        </SelectItem>
      ) : (
        allModels.map((m) => (
          <SelectItem key={m.id} value={m.name}>
            {m.displayName || m.name} ({m.providerName})
          </SelectItem>
        ))
      )}
    </SelectContent>
  );

  const selectedModelLabel = allModels.find((m) => m.name === selectedModel);

  const modelSelect = (variant: "light" | "dark" = "light") => (
    <Select value={selectedModel} onValueChange={setSelectedModel}>
      <SelectTrigger
        size="sm"
        className={
          variant === "dark"
            ? "border-0 bg-transparent text-white/70 shadow-none hover:text-white"
            : "border-0 bg-transparent shadow-none dark:bg-transparent"
        }
      >
        <SelectValue placeholder="Select model">
          {selectedModelLabel
            ? `${selectedModelLabel.displayName || selectedModelLabel.name}`
            : "Select model"}
        </SelectValue>
      </SelectTrigger>
      {modelSelectContent}
    </Select>
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
                    variant={attachment.previewUrl ? "image" : "icon"}
                  >
                    {attachment.previewUrl ? (
                      <img src={attachment.previewUrl} alt={attachment.name} />
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
                      <MarkdownRenderer content={msg.content} />
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
              {msg.reasoning && (
                <div className="mb-1">
                  <button
                    onClick={() =>
                      setExpandedReasoning((prev) => {
                        const next = new Set(prev);
                        if (next.has(msg.id)) next.delete(msg.id);
                        else next.add(msg.id);
                        return next;
                      })
                    }
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Brain className="size-3.5" />
                    <span>Thinking</span>
                    {expandedReasoning.has(msg.id) ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  </button>
                  {expandedReasoning.has(msg.id) && (
                    <div className="mt-1 rounded-lg border bg-muted/30 p-3 max-h-60 overflow-y-auto">
                      <MarkdownRenderer content={msg.reasoning} className="text-xs text-muted-foreground" />
                    </div>
                  )}
                </div>
              )}
              <Bubble variant="ghost">
                <BubbleContent>
                  {isRaw ? (
                    <pre className="whitespace-pre-wrap text-xs font-mono">
                      {msg.content}
                    </pre>
                  ) : (
                    <MarkdownRenderer content={msg.content} />
                  )}
                </BubbleContent>
              </Bubble>
              {(() => {
                const arts = extractArtifacts(msg.content);
                if (arts.length === 0) return null;
                return (
                  <div className="mb-1 flex flex-wrap gap-1.5">
                    {arts.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setArtifactPanel({ artifacts: arts, activeIndex: a.index })}
                        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
                      >
                        <FileCode className="size-3.5 text-muted-foreground" />
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
                  disabled={isThinking}
                >
                  <RotateCcw />
                </Button>
                {msg.model && (
                  <Badge variant="secondary" className="text-[10px] py-0">
                    {allModels.find((m) => m.name === msg.model)?.displayName || msg.model}
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
        agentSessions={agentSessions}
        activeSessionId={activeSessionId}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSelectSession={selectSession}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteSession}
        onRenameChat={(id, title) => updateSession(id, { title })}
        onSettings={() => setSettingsOpen(true)}
        onProjects={() => setProjectsOpen(true)}
        onHistory={() => setHistoryOpen(true)}
        onComingSoon={comingSoon}
        projects={projects}
      />

      <SidebarTrigger className="fixed left-18 top-1.5 z-50 size-4.5 [&_svg]:size-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=expanded]:text-sidebar-foreground peer-data-[state=expanded]:hover:bg-sidebar-accent peer-data-[state=expanded]:hover:text-sidebar-accent-foreground" />

      <SidebarInset>
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
          {(activeSession || activeProject) && (
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
                  className="max-w-xs truncate rounded-md px-3 py-1 text-sm font-medium transition-colors hover:bg-accent"
                >
                  {activeSession!.title}
                </button>
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2" />
        </header>

        <div className={activeTab === "agent" ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        {activeSession ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {artifactPanel && (
              <ArtifactPanel
                artifacts={artifactPanel.artifacts}
                activeIndex={artifactPanel.activeIndex}
                onSelectIndex={(i) => setArtifactPanel((prev) => prev ? { ...prev, activeIndex: i } : null)}
                onClose={() => setArtifactPanel(null)}
              />
            )}
            <MessageScrollerProvider
              autoScroll
              defaultScrollPosition="last-anchor"
              scrollPreviousItemPeek={64}
            >
              <MessageScroller className="flex-1">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
                    {activePath.map((node) => renderMessage(node.message))}

                    {isThinking && (
                      <MessageScrollerItem messageId="thinking">
                        <Message>
                          <MessageContent>
                            {streamingReasoning && !streamingContent && (
                              <button
                                onClick={() => setShowThinkingProcess((prev) => !prev)}
                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Brain className="size-3.5" />
                                <span className="shimmer">Thinking…</span>
                                {showThinkingProcess ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                              </button>
                            )}
                            {streamingReasoning && showThinkingProcess && !streamingContent && (
                              <div className="mt-1 mb-2 rounded-lg border bg-muted/30 p-3 max-h-60 overflow-y-auto">
                                <MarkdownRenderer content={streamingReasoning} className="text-xs text-muted-foreground" />
                              </div>
                            )}
                            {streamingContent ? (
                              <Bubble variant="ghost">
                                <BubbleContent>
                                  <MarkdownRenderer content={streamingContent} />
                                </BubbleContent>
                              </Bubble>
                            ) : !streamingReasoning ? (
                              <Marker role="status">
                                <MarkerIcon>
                                  <Spinner />
                                </MarkerIcon>
                                <MarkerContent className="shimmer">
                                  Thinking…
                                </MarkerContent>
                              </Marker>
                            ) : null}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    )}

                    {deepResearch.isRunning && (
                      <MessageScrollerItem messageId="deep-research">
                        <Message>
                          <MessageContent>
                            {deepResearch.streamingReport ? (
                              <Bubble variant="ghost">
                                <BubbleContent>
                                  <MarkdownRenderer content={deepResearch.streamingReport} />
                                </BubbleContent>
                              </Bubble>
                            ) : (
                              <Marker role="status">
                                <MarkerIcon>
                                  <Spinner />
                                </MarkerIcon>
                                <MarkerContent className="shimmer">
                                  {deepResearch.statusLabel ?? "Researching…"}
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
                {files.length > 0 && (
                  <AttachmentGroup className="mb-2">
                    {files.map((file) => (
                      <Attachment key={file.id}>
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
                )}

                <InputGroup className={isTemporary ? "border-dashed" : undefined}>
                  <InputGroupTextarea
                    value={inputText}
                    onChange={(e) => setInputText(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (settings.sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={isTemporary ? "This message and response will be forgotten when you close the chat" : "Ask anything"}
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
                    <InputGroupButton
                      size={isTemporary ? "xs" : "icon-xs"}
                      variant="ghost"
                      aria-label="Toggle temporary chat"
                      title="Temporary message - will be deleted when you close the chat"
                      onClick={() => setIsTemporary((prev) => !prev)}
                      className={`group ${isTemporary ? "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500" : ""}`}
                    >
                      <ClockFading className={isTemporary ? "fill-blue-500/30" : ""} />
                      {isTemporary && <span className="group-hover:line-through">Temporary</span>}
                    </InputGroupButton>
                    <InputGroupButton
                      size={isResearch ? "xs" : "icon-xs"}
                      variant="ghost"
                      aria-label="Toggle research mode"
                      title="Research"
                      onClick={() => setIsResearch((prev) => !prev)}
                      className={`group ${isResearch ? "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500" : ""}`}
                    >
                      <Microscope className={isResearch ? "fill-blue-500/30" : ""} />
                      {isResearch && <span className="group-hover:line-through">Research</span>}
                    </InputGroupButton>
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

                    {(isThinking || deepResearch.isRunning) ? (
                      <InputGroupButton
                        variant="outline"
                        size="icon-xs"
                        className="rounded-lg"
                        onClick={isThinking ? handleStop : deepResearch.cancel}
                        aria-label={isThinking ? "Stop generation" : "Cancel Deep Research"}
                      >
                        <span className="size-3 rounded-sm bg-current" />
                      </InputGroupButton>
                    ) : (
                      <InputGroupButton
                        variant="default"
                        size="icon-xs"
                        className="rounded-lg"
                        onClick={handleSend}
                        disabled={
                          (!inputText.trim() && files.length === 0) || isThinking || deepResearch.isRunning
                        }
                        aria-label="Send message"
                      >
                        <ArrowUp />
                      </InputGroupButton>
                    )}
                  </InputGroupAddon>
                </InputGroup>

                <p className="mt-2 text-center text-xs text-muted-foreground">
                  ChatUI can make mistakes. Check important information.
                </p>
              </div>
            </div>
          </div>
        ) : activeProject ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="flex flex-col w-2/3 min-h-0 border-r">
                <div className="shrink-0 p-4">
                  <InputGroup className={isTemporary ? "border-dashed" : undefined}>
                    <InputGroupTextarea
                      value={projectInputText}
                      onChange={(e) => setProjectInputText(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (settings.sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          const text = projectInputText.trim();
                          if (!text || isThinking) return;
                          setProjectInputText("");
                          handleProjectSend(text);
                        }
                      }}
                      placeholder={isTemporary ? "This message and response will be forgotten when you close the chat" : "Ask anything about this project..."}
                      className="max-h-40 min-h-12"
                    />
                    <InputGroupAddon align="block-end">
                      <InputGroupButton
                        size={isTemporary ? "xs" : "icon-xs"}
                        variant="ghost"
                        aria-label="Toggle temporary chat"
                        title="Temporary message - will be deleted when you close the chat"
                        onClick={() => setIsTemporary((prev) => !prev)}
                        className={`group ${isTemporary ? "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500" : ""}`}
                      >
                        <ClockFading className={isTemporary ? "fill-blue-500/30" : ""} />
                        {isTemporary && <span className="group-hover:line-through">Temporary</span>}
                      </InputGroupButton>
                      <div className="flex-1" />
                      {modelSelect()}
                      <InputGroupButton
                        variant="default"
                        size="icon-xs"
                        className="rounded-lg"
                        onClick={() => {
                          const text = projectInputText.trim();
                          if (!text || isThinking) return;
                          setProjectInputText("");
                          handleProjectSend(text);
                        }}
                        disabled={!projectInputText.trim() || isThinking}
                        aria-label="Send message"
                      >
                        <ArrowUp />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
                <ScrollArea className="flex-1">
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
                            className="gap-0 py-0 cursor-pointer transition-colors hover:bg-accent"
                            onClick={() => {
                              selectSession(session.id);
                              setActiveProjectId(null);
                            }}
                          >
                            <CardHeader className="flex items-center justify-between py-3.5">
                              <span className="truncate text-sm font-medium">
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
              <div className="w-1/3 min-h-0 flex flex-col">
                <ScrollArea className="flex-1">
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
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-black px-4 pb-8">
            <InteractiveGrid className="absolute inset-0" mode={activeTab} />
            <h2 className="select-none cursor-default relative font-serif z-10 mb-12 text-center text-4xl text-white/70 welcome-fade-in">
              {welcomePrompt}
            </h2>
            <div className="relative z-10 w-full max-w-3xl">
              {files.length > 0 && (
                <AttachmentGroup className="mb-2">
                  {files.map((file) => (
                    <Attachment key={file.id} className="opacity-50">
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
              )}

              <InputGroup className={`bg-white/5 backdrop-blur-sm ${isTemporary ? "border-dashed" : ""}`}>
                <InputGroupTextarea
                  value={inputText}
                  onChange={(e) => setInputText(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (settings.sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={isTemporary ? "This message and response will be forgotten when you close the chat" : "Ask anything"}
                  className="max-h-40 min-h-12 placeholder:text-white/30"
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
                  <InputGroupButton
                    size={isTemporary ? "xs" : "icon-xs"}
                    variant="ghost"
                    aria-label="Toggle temporary chat"
                    title="Temporary chat"
                    onClick={() => setIsTemporary((prev) => !prev)}
                    className={`group ${isTemporary ? "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500" : ""}`}
                  >
                    <ClockFading className={isTemporary ? "fill-blue-500/30" : ""} />
                    {isTemporary && <span className="group-hover:line-through">Temporary</span>}
                  </InputGroupButton>
                  <InputGroupButton
                    size={isResearch ? "xs" : "icon-xs"}
                    variant="ghost"
                    aria-label="Toggle research mode"
                    title="Research"
                    onClick={() => setIsResearch((prev) => !prev)}
                    className={`group ${isResearch ? "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 hover:text-blue-500" : ""}`}
                  >
                    <Microscope className={isResearch ? "fill-blue-500/30" : ""} />
                    {isResearch && <span className="group-hover:line-through">Research</span>}
                  </InputGroupButton>
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

                  {modelSelect("dark")}

                  {(isThinking || deepResearch.isRunning) ? (
                    <InputGroupButton
                      variant="outline"
                      size="icon-xs"
                      className="rounded-lg"
                      onClick={isThinking ? handleStop : deepResearch.cancel}
                      aria-label={isThinking ? "Stop generation" : "Cancel Deep Research"}
                    >
                      <span className="size-3 rounded-sm bg-current" />
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton
                      variant="default"
                      size="icon-xs"
                      className="rounded-lg"
                      onClick={handleSend}
                      disabled={
                        (!inputText.trim() && files.length === 0) || isThinking || deepResearch.isRunning
                      }
                      aria-label="Send message"
                    >
                      <ArrowUp />
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>

              <p className="mt-2 text-center text-xs text-white/30 bg-black w-fit mx-auto">
                AI can make mistakes. Check important information.
              </p>
            </div>
          </div>
        )}
        </div>
        <div className={activeTab === "agent" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <AgentView />
        </div>
      </SidebarInset>

      <Dialog open={projectsOpen} onOpenChange={setProjectsOpen}>
        <DialogContent>
          <DialogHeader className="shrink-0 gap-0 pr-10">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <DialogTitle className="flex items-center gap-2">
                  <ChartColumnBig className="size-5" />
                  Projects
                </DialogTitle>
                <DialogDescription>
                  Organize your conversations into projects.
                </DialogDescription>
              </div>
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
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 pb-1">
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
                    setProjectsOpen(false);
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
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader className="shrink-0 gap-0 pr-10">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <DialogTitle className="flex items-center gap-2">
                  <GalleryVerticalEnd className="size-5" />
                  History
                </DialogTitle>
              </div>
              <div className="flex items-center gap-2">
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
                    setHistoryOpen(false);
                  }}
                >
                  <Plus />
                  New Chat
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-2 pb-1">
              {[...sessions, ...agentSessions]
                .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                .filter((s) =>
                  s.title.toLowerCase().includes(historySearch.toLowerCase())
                )
                .map((session) => (
                  <Card key={session.id} className="gap-0 py-0 cursor-pointer transition-colors hover:bg-accent" onClick={() => {
                    selectSession(session.id);
                    setHistoryOpen(false);
                  }}>
                    <CardHeader className="flex items-center justify-between py-3.5">
                      <span className="truncate text-sm font-medium">
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
              {[...sessions, ...agentSessions]
                .filter((s) =>
                  s.title.toLowerCase().includes(historySearch.toLowerCase())
                ).length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {historySearch ? "No conversations match your search." : "No conversation history yet."}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </SidebarProvider>
    </OpenCodeProvider>
  );

  async function handleProjectSend(text: string) {
    const provider = selectedModel ? findProviderForModel(selectedModel) : null;
    if (!provider) {
      toast.error("No provider configured. Add one in Settings.");
      setSettingsOpen(true);
      return;
    }

    setIsThinking(true);
    setStreamingContent("");
    setStreamingReasoning("");
    setShowThinkingProcess(false);

    try {
      const newSession = createSession(text.slice(0, 30), activeProject?.id);
      setActiveSessionId(newSession.id);
      setActiveProjectId(null);

      await newSession.persisted;
      const userMsg = await addMessage(newSession.id, "user", text);

      const completionMessages: ChatCompletionMessage[] = [
        { role: "user" as const, content: text },
      ];

      const controller = new AbortController();
      setAbortController(controller);

      const tools = getAllTools(webFetchEnabled);
      const skillsContext = await loadInstalledSkillsPrompt();

      let fullResponse = "";
      let fullReasoning = "";
      try {
        for await (const chunk of streamChatCompletion(
          provider,
          selectedModel,
          completionMessages,
          controller.signal,
          tools,
          currentProjectInstructions,
          skillsContext,
        )) {
          if (chunk.content) {
            fullResponse += chunk.content;
            setStreamingContent(fullResponse);
          }
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning;
            setStreamingReasoning(fullReasoning);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          if (fullResponse) {
            await addMessage(newSession.id, "assistant", fullResponse, selectedModel, undefined, userMsg.id, undefined, fullReasoning || undefined);
          }
          return;
        }
        throw err;
      }

      if (fullResponse) {
        await addMessage(newSession.id, "assistant", fullResponse, selectedModel, undefined, userMsg.id, undefined, fullReasoning || undefined);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setIsThinking(false);
      setStreamingContent("");
      setStreamingReasoning("");
      setShowThinkingProcess(false);
      setAbortController(null);
    }
  }
}
