import { useState, useMemo, useEffect, type ComponentType } from "react";
import {
  ArrowUp,
  BarChart3,
  Bot,
  Check,
  FileText,
  Folder,
  FolderOpen,
  Lightbulb,
  ListChecks,
  Mail,
  Plus,
  Search,
  Wrench,
  X,
  Globe,
  ChevronRight,
  Zap,
  ShieldCheck,
  ShieldX,
  CircleCheck,
  CircleAlert,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Spinner } from "@/components/ui/spinner";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useOpencodeContext } from "@/lib/opencode-context";
import {
  NextjsLogo,
  PythonLogo,
  CloudflareLogo,
  FastapiLogo,
  NodejsLogo,
} from "@/components/brand-logos";
import { createProjectDirectory, runScaffold } from "@/lib/opencode";
import { InteractiveGrid } from "@/components/interactive-grid";
import { McpPicker } from "@/components/mcp-picker";
import { getDisabledMcps, buildToolsMap } from "@/lib/session-mcp";
import { installBundledSkill } from "@/lib/skills-library";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { MessageEntry, Part } from "@/lib/opencode";
import type { Project } from "@/types";

function renderPart(part: Part, key: string) {
  switch (part.type) {
    case "text":
      return (
        <Bubble key={key} variant="ghost">
          <BubbleContent className="whitespace-pre-wrap">
            {part.text}
          </BubbleContent>
        </Bubble>
      );

    case "reasoning":
      return (
        <details key={key} className="mb-1">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground">
            Reasoning
          </summary>
          <div className="mt-1 rounded-md bg-muted/50 p-2 text-xs italic whitespace-pre-wrap text-muted-foreground">
            {part.text}
          </div>
        </details>
      );

    case "tool": {
      const status = part.state?.status ?? "pending";
      const title = part.state?.title ?? part.tool;
      const output = part.state?.output;
      const error = part.state?.error;
      return (
        <div key={key} className="my-1">
          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
            <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium">{part.tool}</span>
            <span className="text-muted-foreground truncate">— {title}</span>
            {status === "running" && <Spinner className="size-3" />}
            {status === "completed" && <Check className="size-3.5 text-green-500" />}
            {status === "error" && <X className="size-3.5 text-destructive" />}
          </div>
          {output && (
            <details className="mt-0.5">
              <summary className="cursor-pointer select-none text-[10px] text-muted-foreground pl-4">
                Output
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[10px] whitespace-pre-wrap">
                {output}
              </pre>
            </details>
          )}
          {error && (
            <div className="mt-0.5 rounded-md bg-destructive/10 p-2 text-[10px] text-destructive">
              {error}
            </div>
          )}
        </div>
      );
    }

    case "file":
      return (
        <div key={key} className="my-1 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{part.filename ?? "file"}</span>
          <span className="text-muted-foreground">{part.mime}</span>
        </div>
      );

    case "patch":
      return (
        <div key={key} className="my-1 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">Edited {part.files.length} file{part.files.length !== 1 ? "s" : ""}</span>
        </div>
      );

    case "retry":
      return (
        <div key={key} className="my-1 flex items-center gap-2 rounded-md border border-amber-500/30 px-3 py-1.5 text-xs text-amber-600">
          <CircleAlert className="size-3.5 shrink-0" />
          <span>Retry (attempt {part.attempt}): {part.error?.data?.message ?? "error"}</span>
        </div>
      );

    case "compaction":
      return (
        <div key={key} className="my-1 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs text-muted-foreground">
          <Zap className="size-3.5 shrink-0" />
          <span>Context compacted{part.auto ? " (auto)" : ""}</span>
        </div>
      );

    case "subtask":
      return (
        <div key={key} className="my-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 font-medium">
            <Bot className="size-3.5" />
            {part.agent}: {part.description}
          </div>
          <p className="mt-1 text-muted-foreground">{part.prompt}</p>
        </div>
      );

    case "step-start":
    case "step-finish":
    case "snapshot":
      return null;

    default:
      return null;
  }
}

function renderMessage(entry: MessageEntry) {
  const { info, parts } = entry;
  const visibleParts = parts.filter(
    (part) => part.type !== "step-start" && part.type !== "step-finish" && part.type !== "snapshot",
  );
  const isUser = info.role === "user";

  if (isUser) {
    return (
      <MessageScrollerItem key={info.id} messageId={info.id}>
        <Message align="end">
          <MessageContent>
            {visibleParts.map((part) =>
              part.type === "text" ? (
                <Bubble key={part.id} variant="default">
                  <BubbleContent className="whitespace-pre-wrap">
                    {part.text}
                  </BubbleContent>
                </Bubble>
              ) : null,
            )}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  }

  return (
    <MessageScrollerItem key={info.id} messageId={info.id}>
      <Message align="start">
        <MessageContent>
          {visibleParts.length === 0 ? (
            <Marker role="status">
              <MarkerIcon>
                <Spinner />
              </MarkerIcon>
              <MarkerContent className="shimmer">Thinking…</MarkerContent>
            </Marker>
          ) : (
            visibleParts.map((part) => renderPart(part, part.id))
          )}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

function InstallForm({ onInstall, installing }: { onInstall: () => void; installing: boolean }) {
  return (
    <div className="flex h-[calc(100dvh-2.5rem)] items-center justify-center overflow-y-auto p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-5" />
            Install OpenCode
          </CardTitle>
          <CardDescription>
            OpenCode is not installed on your system. Download and install it now to enable agent sessions with full tool access, MCP support, and file editing capabilities.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onInstall} disabled={installing} className="w-full">
            {installing ? (
              <><Spinner className="size-4" /> Installing OpenCode…</>
            ) : (
              <><Bot className="size-4" /> Install</>
            )}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            This will run the official install script from opencode.ai.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StartingScreen({
  error,
  onRetry,
  retrying,
}: {
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (error) {
    return (
      <div className="flex h-[calc(100dvh-2.5rem)] items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <CircleAlert className="size-8 text-destructive" />
          <p className="text-sm font-medium">Couldn't start the agent engine</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-[calc(100dvh-2.5rem)] items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Spinner className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Starting OpenCode server…</p>
      </div>
    </div>
  );
}

function ContextPieChart({ percentage }: { percentage: number }) {
  const clamped = Math.min(percentage, 100);
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clamped / 100) * circumference;
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0">
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeWidth="2"
        strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
        transform="rotate(-90 8 8)" strokeLinecap="round" />
    </svg>
  );
}

type IconType = ComponentType<{ className?: string }>;
type SessionMode = "standalone" | "project";
type FolderAction = "choose" | "create";

interface TemplateOption {
  id: string;
  category: "developer" | "productivity";
  title: string;
  description: string;
  Icon: IconType;
}

const templateOptions: TemplateOption[] = [
  { id: "nextjs", category: "developer", title: "Next.js", description: "A popular way to build modern websites that load fast and look great. Good for making web apps.", Icon: NextjsLogo },
  { id: "python", category: "developer", title: "Python", description: "A simple, readable programming language used for data analysis, AI, automation, and more.", Icon: PythonLogo },
  { id: "cloudflare-opennext", category: "developer", title: "Cloudflare OpenNext", description: "Put your Next.js website on Cloudflare's worldwide network so it loads instantly.", Icon: CloudflareLogo },
  { id: "fastapi", category: "developer", title: "FastAPI", description: "Build the behind-the-scenes part of an app — handles data, databases, and APIs. Uses Python.", Icon: FastapiLogo },
  { id: "nodejs", category: "developer", title: "Node.js", description: "Run JavaScript outside the browser to build apps, tools, and services.", Icon: NodejsLogo },
  { id: "email", category: "productivity", title: "Email Assistant", description: "Compose professional emails, draft replies, and organize your inbox.", Icon: Mail },
  { id: "planning", category: "productivity", title: "Planning & Strategy", description: "Turn big ideas into clear step-by-step plans.", Icon: ListChecks },
  { id: "research", category: "productivity", title: "Research Helper", description: "Dig into topics, summarize articles, and answer questions.", Icon: Search },
  { id: "data-analysis", category: "productivity", title: "Data Analysis", description: "Spot trends, crunch numbers, and understand your data.", Icon: BarChart3 },
  { id: "writing", category: "productivity", title: "Writing & Editing", description: "Draft reports, polish emails, improve documents.", Icon: FileText },
  { id: "brainstorming", category: "productivity", title: "Brainstorming", description: "Generate creative ideas and solve problems from fresh perspectives.", Icon: Lightbulb },
];

interface TemplateMeta {
  skills: string[];
  scaffold: string | null;
  agentsMd: string;
}

const templateMeta: Record<string, TemplateMeta> = {
  nextjs: {
    skills: ["nextjs", "frontend-ui"],
    scaffold: "nextjs",
    agentsMd: "# Next.js Project\n\nYou are working on a Next.js app (App Router, TypeScript, Tailwind).\n- Keep components small and composable.\n- Prefer server components; use 'use client' only for interactivity.\n- Follow the nextjs and frontend-ui skills.\n",
  },
  "cloudflare-opennext": {
    skills: ["nextjs", "frontend-ui"],
    scaffold: "cloudflare-opennext",
    agentsMd: "# Cloudflare OpenNext Project\n\nNext.js app deployed via @opennextjs/cloudflare.\n- Build with `npx opennextjs-cloudflare` and deploy with `npx wrangler deploy`.\n- Follow the nextjs and frontend-ui skills.\n",
  },
  fastapi: {
    skills: ["fastapi"],
    scaffold: "fastapi",
    agentsMd: "# FastAPI Project\n\nYou are working on a FastAPI (Python) backend.\n- Use async routes, Pydantic v2 models, dependency injection.\n- Run with `uvicorn app.main:app --reload`.\n- Follow the fastapi skill.\n",
  },
  python: {
    skills: [],
    scaffold: "python",
    agentsMd: "# Python Project\n\nYou are working on a Python project managed with `uv`.\n- Add dependencies with `uv add <package>`.\n- Run scripts with `uv run python <file>`.\n",
  },
  nodejs: {
    skills: [],
    scaffold: "nodejs",
    agentsMd: "# Node.js Project\n\nYou are working on a Node.js project.\n- Use npm for dependencies.\n- Keep code modular and typed where possible.\n",
  },
  email: { skills: [], scaffold: null, agentsMd: "# Email Assistant\n\nHelp the user compose, reply to, and organize emails. Be professional and concise.\n" },
  planning: { skills: [], scaffold: null, agentsMd: "# Planning & Strategy\n\nHelp the user turn ideas into clear, actionable plans. Break work into steps.\n" },
  research: { skills: ["research"], scaffold: null, agentsMd: "# Research Helper\n\nResearch topics thoroughly. Use web tools, cite sources, cross-check facts. Follow the research skill.\n" },
  "data-analysis": { skills: [], scaffold: null, agentsMd: "# Data Analysis\n\nHelp analyze data: spot trends, compute statistics, explain findings clearly.\n" },
  writing: { skills: [], scaffold: null, agentsMd: "# Writing & Editing\n\nHelp draft, polish, and improve written content. Match the user's tone and intent.\n" },
  brainstorming: { skills: [], scaffold: null, agentsMd: "# Brainstorming\n\nGenerate creative ideas and explore fresh angles. Be encouraging and specific.\n" },
};

const BUNDLED_SKILL_NAMES = ["fastapi", "nextjs", "frontend-ui", "research"];

export function AgentView({
  projects,
  updateProject,
}: {
  projects: Project[];
  updateProject: (id: string, updates: { directory?: string | null }) => Promise<void>;
}) {
  const oc = useOpencodeContext();

  const [inputText, setInputText] = useState("");
  const [sessionMode, setSessionMode] = useState<SessionMode | null>(null);
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [scaffoldEnabled, setScaffoldEnabled] = useState(true);
  const [agentsMdDraft, setAgentsMdDraft] = useState("");
  const [scaffolding, setScaffolding] = useState(false);
  const [scaffoldLog, setScaffoldLog] = useState("");

  useEffect(() => {
    if (oc.providers && !oc.selectedModel) {
      const defaults = Object.entries(oc.providers.default);
      if (defaults.length > 0) {
        const [providerId, modelId] = defaults[0];
        oc.setSelectedModel(`${providerId}/${modelId}`);
      } else {
        const firstProvider = oc.providers.providers[0];
        if (firstProvider) {
          const firstModel = Object.values(firstProvider.models)[0];
          if (firstModel) oc.setSelectedModel(`${firstProvider.id}/${firstModel.id}`);
        }
      }
    }
  }, [oc.providers, oc.selectedModel, oc.setSelectedModel]);

  const modelOptions = useMemo(() => {
    if (!oc.providers) return [];
    const options: { value: string; label: string; providerName: string }[] = [];
    for (const provider of oc.providers.providers) {
      for (const model of Object.values(provider.models)) {
        options.push({ value: `${provider.id}/${model.id}`, label: model.name, providerName: provider.name });
      }
    }
    return options;
  }, [oc.providers]);

  const selectedModelOption = modelOptions.find((o) => o.value === oc.selectedModel);
  const selectedModelLabel = selectedModelOption?.label ?? "Model";

  const totalTokens = oc.sessionTokens.input + oc.sessionTokens.output + oc.sessionTokens.reasoning;
  const contextLimit = oc.contextLimit;
  const contextPercentage = Math.min((totalTokens / contextLimit) * 100, 100);

  const resetFolderStep = () => {
    setFolderAction(null);
    setSelectedFolderPath(null);
    setNewFolderName("");
    setSelectedTemplateId(null);
    setSelectedSkills([]);
    setScaffoldEnabled(false);
    setAgentsMdDraft("");
  };

  const resetSessionSetup = () => {
    setSessionMode(null);
    setFolderAction(null);
    setSelectedFolderPath(null);
    setNewFolderName("");
    setLinkedProjectId(null);
    setSelectedTemplateId(null);
    setSelectedSkills([]);
    setScaffoldEnabled(false);
    setAgentsMdDraft("");
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || oc.isBusy || !oc.serving) return;
    setInputText("");
    const tools = buildToolsMap(getDisabledMcps(oc.activeSessionId));
    if (pendingDir) {
      const dir = pendingDir;
      setPendingDir(null);
      void oc.sendNewMessage(text, dir, tools);
      return;
    }
    void oc.sendMessage(text, tools);
  };

  const handleBrowseDir = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select a working directory" });
      if (selected) {
        setSelectedFolderPath(selected);
        return;
      }
      resetFolderStep();
    } catch {
      resetFolderStep();
      toast.error("Failed to open directory picker");
    }
  };

  const handleChooseFolder = () => {
    if (folderAction !== null) return;
    setSelectedFolderPath(null);
    setSelectedTemplateId(null);
    setFolderAction("choose");
    void handleBrowseDir();
  };

  const handleCreateSession = async () => {
    if (sessionMode === null || oc.isBusy || !oc.serving) return;
    let dir: string | null = null;
    if (folderAction === "choose" && selectedFolderPath) {
      dir = selectedFolderPath;
    } else if (folderAction === "create" && newFolderName.trim()) {
      try {
        const entry = await createProjectDirectory(newFolderName.trim());
        dir = entry.path;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create project directory");
        return;
      }
    }
    if (!dir) return;

    if (sessionMode === "project" && linkedProjectId) {
      void updateProject(linkedProjectId, { directory: dir });
    }

    // Install selected skills (project scope)
    for (const skill of selectedSkills) {
      try {
        await installBundledSkill(skill, "project", dir);
      } catch {
        // ignore individual skill failures
      }
    }

    // Write AGENTS.md with starter instructions
    if (agentsMdDraft.trim()) {
      try {
        await invoke("write_text_file", { path: `${dir}/AGENTS.md`, content: agentsMdDraft });
      } catch {
        // ignore
      }
    }

    // Run scaffolder (full project scaffolding)
    const meta = selectedTemplateId && selectedTemplateId !== "empty" ? templateMeta[selectedTemplateId] : null;
    if (scaffoldEnabled && meta?.scaffold) {
      setScaffolding(true);
      setScaffoldLog("");
      const unlisten = await listen<{ kind: string; data: string }>("scaffold-event", (event) => {
        const p = event.payload;
        if (p.kind === "stdout" || p.kind === "stderr") {
          setScaffoldLog((prev) => prev + p.data + "\n");
        }
      });
      try {
        await runScaffold(dir, meta.scaffold);
        toast.success("Project scaffolded");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Scaffolding failed");
      } finally {
        unlisten();
        setScaffolding(false);
      }
    }

    setPendingDir(dir);
    resetSessionSetup();
  };

  const handleInstall = async () => {
    try {
      await oc.install();
      toast.success("OpenCode installed. Starting server…");
    } catch (err) {
      toast.error(err instanceof Error ? `Install failed: ${err.message}` : "Failed to install OpenCode");
    }
  };

  if (!oc.installed && !oc.installing) {
    return <InstallForm onInstall={handleInstall} installing={false} />;
  }
  if (oc.installing) {
    return <InstallForm onInstall={handleInstall} installing />;
  }
  if ((!oc.serving && oc.installed && !oc.starting) || oc.starting) {
    return (
      <StartingScreen
        error={!oc.starting ? oc.startError : null}
        onRetry={() => { void oc.startServe(); }}
        retrying={oc.starting}
      />
    );
  }

  const hasActiveSession = Boolean(oc.activeSessionId);
  const selectedFolderName = selectedFolderPath
    ? selectedFolderPath.replace(/\/+$/, "").split("/").pop() ?? selectedFolderPath
    : null;
  const linkedProject = projects.find((project) => project.id === linkedProjectId);
  const selectedTemplate = selectedTemplateId && selectedTemplateId !== "empty"
    ? templateOptions.find((t) => t.id === selectedTemplateId) ?? null
    : null;

  const handleSelectTemplate = (option: TemplateOption) => {
    setSelectedTemplateId(option.id);
    initCustomization(option.id);
    setTemplateModalOpen(false);
  };

  const initCustomization = (templateId: string | null) => {
    if (templateId && templateId !== "empty") {
      const meta = templateMeta[templateId];
      if (meta) {
        setSelectedSkills([...meta.skills]);
        setScaffoldEnabled(meta.scaffold !== null);
        setAgentsMdDraft(meta.agentsMd);
        return;
      }
    }
    setSelectedSkills([]);
    setScaffoldEnabled(false);
    setAgentsMdDraft("");
  };

  const toggleSkill = (name: string) => {
    setSelectedSkills((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  };

  const isSetupComplete =
    sessionMode !== null &&
    ((folderAction === "choose" && !!selectedFolderPath) ||
      (folderAction === "create" && newFolderName.trim() !== "" && selectedTemplateId !== null));

  const currentFolderName = hasActiveSession
    ? oc.activeDirectory?.replace(/\/+$/, "").split("/").pop() ?? null
    : pendingDir?.replace(/\/+$/, "").split("/").pop() ?? null;

  const activeButtonClass = "!bg-white !text-black hover:!bg-white";
  const showSetup = !hasActiveSession && !pendingDir;

  return (
    <div className="flex h-[calc(100dvh-2.5rem)] flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        {showSetup ? (
          // ─── Screen 1: Setup wizard ───────────────────────────────────────
          <div className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <Bot className="size-10 opacity-50" />
              <p className="text-sm text-muted-foreground">Choose how to start a new session below.</p>
            </div>

            <div className="flex flex-col items-center gap-3">
              {/* Step 1: Session mode */}
              <div className={`relative flex origin-top items-center gap-3 transition-all duration-300 ease-in-out ${sessionMode !== null ? "scale-90 opacity-60" : "scale-100 opacity-100"}`}>
                {sessionMode !== null && (
                  <button type="button" className="absolute inset-0 z-20 cursor-pointer rounded-md" onClick={resetSessionSetup} aria-label="Back to mode selection" />
                )}
                <Button variant="outline" size="sm"
                  onClick={() => { if (sessionMode !== null) return; setLinkedProjectId(null); resetFolderStep(); setSessionMode("standalone"); }}
                  className={`flex items-center gap-2 ${sessionMode === "standalone" ? activeButtonClass : ""}`}>
                  <Globe className="size-4" /> Standalone
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={sessionMode !== null}
                      className={`flex items-center gap-2 ${sessionMode === "project" ? activeButtonClass : ""}`}>
                      <Folder className="size-4" />
                      <span className="max-w-40 truncate">{linkedProject ? linkedProject.name : "Project"}</span>
                      <ChevronRight className="size-3 shrink-0 rotate-90" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    {projects.map((project) => (
                      <DropdownMenuItem key={project.id}
                        onClick={() => { setLinkedProjectId(project.id); resetFolderStep(); setSessionMode("project"); }}>
                        {linkedProjectId === project.id ? <Check className="size-4" /> : <span className="size-4" />}
                        <Folder className="size-4 text-muted-foreground" />
                        <span className="truncate">{project.name}</span>
                      </DropdownMenuItem>
                    ))}
                    {projects.length === 0 && (
                      <DropdownMenuItem disabled>No projects yet. Create one in the Projects dialog.</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Step 2: Folder action */}
              {sessionMode !== null && (
                <div className={`relative flex origin-top items-center gap-3 transition-all duration-300 ease-in-out ${folderAction !== null ? "scale-90 opacity-60" : "scale-100 opacity-100 animate-in fade-in slide-in-from-right-4 duration-300"}`}>
                  {folderAction !== null && (
                    <button type="button" className="absolute inset-0 z-20 cursor-pointer rounded-md" onClick={resetFolderStep} aria-label="Back to folder action selection" />
                  )}
                  <Button variant="outline" size="sm" onClick={handleChooseFolder}
                    className={`flex items-center gap-2 ${folderAction === "choose" ? activeButtonClass : ""}`}>
                    <FolderOpen className="size-4" /> Choose Folder
                  </Button>
                  <Button variant="outline" size="sm"
                    onClick={() => { if (folderAction !== null) return; setSelectedFolderPath(null); setSelectedTemplateId(null); setSelectedSkills([]); setScaffoldEnabled(false); setAgentsMdDraft(""); setNewFolderName(""); setFolderAction("create"); }}
                    className={`flex items-center gap-2 ${folderAction === "create" ? activeButtonClass : ""}`}>
                    <Plus className="size-4" /> Create New
                  </Button>
                </div>
              )}

              {/* Step 3a: chosen folder */}
              {sessionMode !== null && folderAction === "choose" && selectedFolderPath && (
                <div className="flex items-center gap-2 text-sm animate-in fade-in slide-in-from-right-4 duration-300">
                  <FolderOpen className="size-4 text-muted-foreground" />
                  <span className="font-medium">{selectedFolderName}</span>
                </div>
              )}
              {sessionMode !== null && folderAction === "choose" && !selectedFolderPath && (
                <p className="text-xs text-muted-foreground animate-in fade-in duration-300">Select a folder in the dialog…</p>
              )}

              {/* Step 3b: create new */}
              {sessionMode !== null && folderAction === "create" && (
                <div className="flex flex-col items-center gap-3 animate-in fade-in slide-in-from-right-4 duration-300">
                  <Input placeholder="Name your folder…" value={newFolderName}
                    onChange={(e) => setNewFolderName(e.currentTarget.value)} className="max-w-xs" autoFocus />
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={() => { setSelectedTemplateId("empty"); initCustomization("empty"); }}
                      className={`flex items-center gap-2 ${selectedTemplateId === "empty" ? activeButtonClass : ""}`}>
                      <Plus className="size-4" /> Empty
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setTemplateModalOpen(true)}
                      className={`flex items-center gap-2 ${selectedTemplateId && selectedTemplateId !== "empty" ? activeButtonClass : ""}`}>
                      {selectedTemplate && selectedTemplateId !== "empty" ? <selectedTemplate.Icon className="size-4" /> : <Wrench className="size-4" />}
                      {selectedTemplate && selectedTemplateId !== "empty" ? selectedTemplate.title : "Choose template"}
                    </Button>
                  </div>
                  {selectedTemplate && (
                    <p className="max-w-sm text-center text-xs text-muted-foreground">{selectedTemplate.description}</p>
                  )}

                  {/* Customization */}
                  {selectedTemplateId !== null && (
                    <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border p-3 text-left animate-in fade-in duration-300">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium">Skills</span>
                        <div className="flex flex-wrap gap-1.5">
                          {BUNDLED_SKILL_NAMES.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => toggleSkill(name)}
                              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${selectedSkills.includes(name) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}
                            >
                              {selectedSkills.includes(name) && <Check className="mr-1 inline size-2.5" />}
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>

                      {(() => {
                        const meta = selectedTemplateId && selectedTemplateId !== "empty" ? templateMeta[selectedTemplateId] : null;
                        if (!meta?.scaffold) return null;
                        return (
                          <label className="flex items-center justify-between text-xs">
                            <span className="font-medium">Scaffold project files</span>
                            <Switch size="sm" checked={scaffoldEnabled} onCheckedChange={setScaffoldEnabled} />
                          </label>
                        );
                      })()}

                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium">AGENTS.md (project instructions)</span>
                        <textarea
                          value={agentsMdDraft}
                          onChange={(e) => setAgentsMdDraft(e.currentTarget.value)}
                          className="min-h-20 rounded-md border bg-background p-2 text-xs font-mono resize-none"
                          placeholder="# Project instructions for the agent…"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {scaffolding && (
                <div className="flex w-full max-w-md flex-col gap-2 rounded-lg border p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Spinner className="size-4" /> Scaffolding project…
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-[10px] whitespace-pre-wrap">{scaffoldLog || "Starting…"}</pre>
                </div>
              )}

              {isSetupComplete && !scaffolding && (
                <Button onClick={() => void handleCreateSession()} className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <Plus className="size-4" /> Create
                </Button>
              )}
            </div>
          </div>
        ) : hasActiveSession ? (
          // ─── Screen 2a: Active session message list ────────────────────────
          <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={64}>
            <MessageScroller className="h-full">
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
                  {oc.loadingMessages ? (
                    <div className="flex items-center justify-center py-12"><Spinner className="size-6" /></div>
                  ) : (
                    oc.messages.map((entry) => renderMessage(entry))
                  )}
                  {oc.isBusy && (oc.messages.length === 0 || oc.messages[oc.messages.length - 1].info.role === "user") && (
                    <MessageScrollerItem messageId="thinking">
                      <Message align="start">
                        <MessageContent>
                          <Marker role="status">
                            <MarkerIcon><Spinner /></MarkerIcon>
                            <MarkerContent className="shimmer">Thinking…</MarkerContent>
                          </Marker>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>
        ) : (
          // ─── Screen 2b: Ready state (pendingDir, no session yet) ───────────
          <div className="relative flex h-full flex-col items-center justify-center overflow-hidden">
            <InteractiveGrid className="absolute inset-0" mode="agent" />
            <div className="relative z-10 flex flex-col items-center gap-3 text-center">
              <Bot className="size-10 opacity-50" />
              <p className="text-sm text-muted-foreground">Ready when you are. Type below to start the session.</p>
            </div>
          </div>
        )}
      </div>

      {/* Permission cards */}
      {oc.pendingPermissions.length > 0 && (hasActiveSession || pendingDir) && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2 space-y-2">
          {oc.pendingPermissions.map((perm) => (
            <div key={perm.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck className="size-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{perm.title}</p>
                  {perm.pattern && <p className="text-xs text-muted-foreground truncate">{Array.isArray(perm.pattern) ? perm.pattern.join(", ") : perm.pattern}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="xs" variant="outline" onClick={() => void oc.replyToPermission(perm.id, "reject")}>
                  <ShieldX className="size-3" /> Deny
                </Button>
                <Button size="xs" variant="outline" onClick={() => void oc.replyToPermission(perm.id, "once")}>Once</Button>
                <Button size="xs" onClick={() => void oc.replyToPermission(perm.id, "always")}>
                  <ShieldCheck className="size-3" /> Always
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Todo list */}
      {oc.todos.length > 0 && (hasActiveSession || pendingDir) && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2">
          <details>
            <summary className="cursor-pointer select-none text-xs text-muted-foreground">
              Tasks ({oc.todos.filter((t) => t.status === "completed").length}/{oc.todos.length})
            </summary>
            <div className="mt-1 space-y-1">
              {oc.todos.map((todo) => (
                <div key={todo.id} className="flex items-center gap-2 text-xs">
                  {todo.status === "completed" ? <CircleCheck className="size-3.5 text-green-500" /> : <CircleAlert className="size-3.5 text-muted-foreground" />}
                  <span className={todo.status === "completed" ? "line-through text-muted-foreground" : ""}>{todo.content}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {(hasActiveSession || pendingDir) && (
        <div className="shrink-0 px-4 pb-4">
          <div className="mx-auto w-full max-w-3xl">
            <InputGroup>
              <InputGroupTextarea
                value={inputText}
                onChange={(event) => setInputText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  handleSend();
                }}
                placeholder={pendingDir ? "Type your message to start the session…" : "Ask OpenCode…"}
                className="max-h-40 min-h-12"
              />
              <InputGroupAddon align="block-end">
                {(hasActiveSession || pendingDir) && currentFolderName && (
                  <span className="inline-flex min-w-0 items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground" title={currentFolderName}>
                    <Folder className="size-3 shrink-0" />
                    <span className="max-w-32 truncate">{currentFolderName}</span>
                  </span>
                )}
                {(hasActiveSession || pendingDir) && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground">
                    <span className="select-none">Auto Accept</span>
                    <Switch size="sm" checked={oc.autoPermissions} onCheckedChange={oc.setAutoPermissions} />
                  </label>
                )}
                <div className="flex-1" />
                {hasActiveSession && <McpPicker />}
                {(hasActiveSession || pendingDir) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="xs" className="h-6 gap-1 rounded-md px-2 text-xs">
                        <span className="max-w-24 truncate">{selectedModelLabel}</span>
                        <ChevronRight className="size-3 shrink-0 rotate-90" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-64 w-64 overflow-y-auto">
                      <DropdownMenuLabel>Model</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {oc.providers?.providers.map((provider) => (
                        <DropdownMenuGroup key={provider.id}>
                          <DropdownMenuLabel>{provider.name}</DropdownMenuLabel>
                          {Object.values(provider.models).map((model) => (
                            <DropdownMenuItem key={model.id} onClick={() => oc.setSelectedModel(`${provider.id}/${model.id}`)}>
                              {oc.selectedModel === `${provider.id}/${model.id}` ? <Check className="size-4" /> : <span className="size-4" />}
                              <span className="truncate">{model.name}</span>
                              {model.capabilities?.input?.image && <Globe className="ml-auto size-3 text-muted-foreground" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuGroup>
                      ))}
                      {!oc.providers && <DropdownMenuItem disabled>Loading models…</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {(hasActiveSession || pendingDir) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="xs" className="h-6 gap-1 rounded-md px-2 text-xs">
                        <ContextPieChart percentage={contextPercentage} />
                        <span>{contextPercentage.toFixed(0)}%</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <div className="px-2 py-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">Context</span>
                          <span>{contextPercentage.toFixed(1)}% used</span>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          <div className="flex justify-between"><span>Input tokens</span><span>{oc.sessionTokens.input.toLocaleString()}</span></div>
                          <div className="flex justify-between"><span>Output tokens</span><span>{oc.sessionTokens.output.toLocaleString()}</span></div>
                          <div className="flex justify-between"><span>Reasoning tokens</span><span>{oc.sessionTokens.reasoning.toLocaleString()}</span></div>
                          <div className="flex justify-between font-medium text-foreground"><span>Total</span><span>{totalTokens.toLocaleString()}</span></div>
                          <div className="flex justify-between"><span>Limit</span><span>{contextLimit.toLocaleString()}</span></div>
                          <div className="flex justify-between"><span>Cost</span><span>${oc.sessionCost.toFixed(4)}</span></div>
                        </div>
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void oc.compactSession()}>
                        <Zap className="size-4" /> Compact session
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <div className="flex items-center gap-1.5">
                  {oc.isBusy ? (
                    <InputGroupButton variant="outline" size="icon-xs" className="rounded-lg" onClick={oc.abort} aria-label="Stop generation">
                      <span className="size-3 rounded-sm bg-current" />
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton variant="default" size="icon-xs" className="rounded-lg" onClick={handleSend} disabled={!inputText.trim()} aria-label="Send message">
                      <ArrowUp />
                    </InputGroupButton>
                  )}
                </div>
              </InputGroupAddon>
            </InputGroup>
            <p className="mt-2 text-center text-xs text-muted-foreground">OpenCode can make mistakes. Check important information.</p>
          </div>
        </div>
      )}

      <Dialog open={templateModalOpen} onOpenChange={setTemplateModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose Template</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-6 overflow-y-auto pt-2 [&::-webkit-scrollbar]:hidden">
            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium">Developer</span>
              <div className="grid grid-cols-3 gap-3">
                {templateOptions.filter((t) => t.category === "developer").map((option) => (
                  <button key={option.id} type="button" onClick={() => handleSelectTemplate(option)}
                    className={`flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors hover:bg-accent ${selectedTemplateId === option.id ? "border-primary ring-2 ring-primary/20" : ""}`}>
                    <option.Icon className="size-6 text-muted-foreground" />
                    <span className="text-sm font-medium">{option.title}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium">Productivity</span>
              <div className="grid grid-cols-3 gap-3">
                {templateOptions.filter((t) => t.category === "productivity").map((option) => (
                  <button key={option.id} type="button" onClick={() => handleSelectTemplate(option)}
                    className={`flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors hover:bg-accent ${selectedTemplateId === option.id ? "border-primary ring-2 ring-primary/20" : ""}`}>
                    <option.Icon className="size-6 text-muted-foreground" />
                    <span className="text-sm font-medium">{option.title}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
