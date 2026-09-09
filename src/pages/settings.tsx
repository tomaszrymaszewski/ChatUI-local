import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Server,
  Cpu,
  Download,
  Upload,
  Check,
  Eye,
  EyeOff,
  RotateCcw,
  Wrench,
  CircleDot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ProviderForm } from "@/components/provider-form";
import { ModelForm } from "@/components/model-form";
import { ProviderLogo } from "@/components/provider-logos";
import { SkillsPanel } from "@/components/skills-panel";
import { ConnectorsPanel } from "@/components/connectors-panel";
import { UpdatesPanel } from "@/components/updates-panel";
import { ThemePreview, SystemPreview } from "@/components/onboarding/theme-step";
import { BackgroundPatternPicker } from "@/components/background-pattern";
import { cn } from "@/lib/utils";
import { useProviders } from "@/hooks/use-providers";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useProjects } from "@/hooks/use-projects";
import { useOpencodeContext } from "@/lib/opencode-context";
import { getTavilyApiKey, setTavilyApiKey } from "@/lib/llm";
import {
  exportChatUiBackup,
  exportOpenAiConversations,
  exportAnthropicConversations,
  importData,
  type ImportResult,
} from "@/lib/data-transfer";
import { getProviderMeta } from "@/lib/provider-meta";
import { getVisionOverride, setVisionOverride, getModelCapabilitiesSync } from "@/lib/model-capabilities";
import { loadMemory, addMemory, deleteMemory } from "@/lib/memory";
import { EMBEDDING_MODELS, setEmbeddingModel } from "@/lib/embeddings";
import {
  getKnowledgeIndexStats,
  rebuildKnowledgeIndex,
  scheduleKnowledgeSweep,
  type KnowledgeIndexStats,
} from "@/lib/knowledge-index";
import { resetOnboarding } from "@/lib/onboarding";
import { modelLabel } from "@/lib/model-display";
import { headroomStart, headroomStatus, type HeadroomStatus } from "@/lib/headroom-client";
import type { Provider, ProviderModel, UserSettings, KnowledgeSourceToggles } from "@/types";

export type SettingsTab = "general" | "memory" | "models" | "skills" | "connectors" | "updates";

export function SettingsView({ activeTab }: { activeTab: SettingsTab }) {
  const { providers, loading, createProvider, updateProvider, deleteProvider, addModel, removeModel, updateModelDisplayName } =
    useProviders();
  const { projects } = useProjects();
  const { settings, updateSettings } = useUserSettings();
  const { theme, setTheme } = useTheme();
  const oc = useOpencodeContext();

  const [showProviderForm, setShowProviderForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);

  const [showModelForm, setShowModelForm] = useState(false);
  const [editingModel, setEditingModel] = useState<{ providerId: string; model: ProviderModel } | null>(null);
  const [deleteModelTarget, setDeleteModelTarget] = useState<{ providerId: string; model: ProviderModel } | null>(null);
  const [visionTick, setVisionTick] = useState(0);
  const [memoryTick, setMemoryTick] = useState(0);
  const [memoryProjectId, setMemoryProjectId] = useState<string | null>(null);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeIndexStats | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [proxyStatus, setProxyStatus] = useState<HeadroomStatus | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const handleContextCompressionToggle = async (on: boolean) => {
    updateSettings({ contextCompression: on });
    if (!on) {
      setProxyStatus(null);
      return;
    }
    // Probe first; start the proxy if the user has it installed.
    const fresh = await headroomStatus();
    setProxyStatus(fresh);
    if (fresh.serving) {
      toast.success("Context compression is ready (Headroom proxy is running)");
      return;
    }
    const err = await headroomStart();
    if (err) {
      toast.error(`Could not start Headroom: ${err}`);
    } else {
      const after = await headroomStatus();
      setProxyStatus(after);
      if (after.serving) toast.success("Context compression is ready");
    }
  };

  const refreshKnowledgeStats = useCallback(() => {
    void getKnowledgeIndexStats().then(setKnowledgeStats);
  }, []);

  useEffect(() => {
    refreshKnowledgeStats();
  }, [refreshKnowledgeStats]);

  const handleRebuildIndex = async () => {
    setSweeping(true);
    try {
      await rebuildKnowledgeIndex();
      toast.success("Knowledge index rebuilt");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rebuild the knowledge index");
    } finally {
      setSweeping(false);
      refreshKnowledgeStats();
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const allModels = providers.flatMap((p) =>
    p.models.map((m) => ({ ...m, providerId: p.id, providerName: p.name, builtinKey: p.builtinKey }))
  );

  const handleSaveProvider = async (
    name: string,
    baseUrl: string,
    apiKey: string,
    builtinKey?: string,
  ) => {
    try {
      if (editingProvider) {
        await updateProvider(editingProvider.id, name, baseUrl, apiKey, [], builtinKey);
        toast.success("Provider updated");
      } else {
        await createProvider(name, baseUrl, apiKey, [], builtinKey);
        toast.success("Provider added");
      }
      setShowProviderForm(false);
      setEditingProvider(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save provider"
      );
    }
  };

  const handleDeleteProvider = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProvider(deleteTarget.id);
      toast.success("Provider deleted");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete provider"
      );
    }
  };

  const handleAddModel = async (providerId: string, model: ProviderModel) => {
    try {
      await addModel(providerId, model);
      toast.success("Model added");
      setShowModelForm(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add model"
      );
    }
  };

  const handleDeleteModel = async () => {
    if (!deleteModelTarget) return;
    try {
      await removeModel(deleteModelTarget.providerId, deleteModelTarget.model.id);
      toast.success("Model removed");
      setDeleteModelTarget(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove model"
      );
    }
  };

  const handleSaveModelDisplayName = async (displayName: string) => {
    if (!editingModel) return;
    try {
      await updateModelDisplayName(editingModel.providerId, editingModel.model.id, displayName);
      toast.success("Model name updated");
      setEditingModel(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update model name"
      );
    }
  };

  const downloadJson = (json: string, filename: string) => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportOptions: Array<{
    id: "chatui" | "openai" | "anthropic";
    label: string;
    description: string;
    filename: string;
    run: () => string;
  }> = [
    {
      id: "chatui",
      label: "ChatUI backup (recommended)",
      description:
        "Everything: chats, agents, projects, providers, settings, schedules, workflows, and memories",
      filename: `chatui-backup-${new Date().toISOString().slice(0, 10)}.json`,
      run: exportChatUiBackup,
    },
    {
      id: "openai",
      label: "ChatGPT format",
      description:
        "Conversations only, in OpenAI's ChatGPT export format (conversations.json) for migrating to other apps",
      filename: `chatui-chatgpt-${new Date().toISOString().slice(0, 10)}.json`,
      run: exportOpenAiConversations,
    },
    {
      id: "anthropic",
      label: "Claude format",
      description:
        "Conversations only, in Anthropic's Claude export format (conversations.json) for migrating to other apps",
      filename: `chatui-claude-${new Date().toISOString().slice(0, 10)}.json`,
      run: exportAnthropicConversations,
    },
  ];

  const handleExportOption = (option: (typeof exportOptions)[number]) => {
    try {
      downloadJson(option.run(), option.filename);
      toast.success(`${option.label} exported`);
      setShowExportDialog(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export data");
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result: ImportResult = importData(text);
      if (result.kind === "chatui") {
        toast.success("Data imported. Reloading...");
        setTimeout(() => window.location.reload(), 1000);
      } else {
        const label = result.kind === "openai" ? "ChatGPT" : "Claude";
        if (result.sessions === 0) {
          toast.info(`All conversations from this ${label} export were already imported`);
        } else {
          toast.success(
            `Imported ${result.sessions} conversation${result.sessions !== 1 ? "s" : ""} (${result.messages} messages) from a ${label} export`
          );
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import data"
      );
    }
    e.target.value = "";
  };

  const themeOptions: Array<{ value: "light" | "dark" | "system"; label: string }> = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  return (
    <>
      <div className="mx-auto w-[90%] pb-16">
        {/* ─── General Tab ─── */}
        {activeTab === "general" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold">General</h2>
              <Separator />

              <div className="flex flex-col gap-2">
                <Label>Theme</Label>
                <div className="grid gap-4 sm:grid-cols-3">
                  {themeOptions.map((opt) => {
                    const selected = theme === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setTheme(opt.value)}
                        className={cn(
                          "flex flex-col gap-3 rounded-xl border p-3 text-left transition-all",
                          selected
                            ? "border-primary ring-2 ring-primary/30"
                            : "hover:border-foreground/30",
                        )}
                      >
                        {opt.value === "system" ? (
                          <SystemPreview />
                        ) : (
                          <ThemePreview variant={opt.value} />
                        )}
                        <div className="flex w-full items-center justify-between px-1">
                          <span className="text-sm font-medium">{opt.label}</span>
                          {selected && (
                            <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-3" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Background</Label>
                <BackgroundPatternPicker
                  value={settings.backgroundPattern}
                  onChange={(value) => void updateSettings({ backgroundPattern: value })}
                />
              </div>

              <Separator />

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Chat</span>
                  <span className="text-xs text-muted-foreground">
                    How sending and displaying messages works.
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm">Send on Enter</span>
                    <span className="text-xs text-muted-foreground">
                      Press Enter to send, Shift+Enter for newline
                    </span>
                  </div>
                  <Switch
                    checked={settings.sendOnEnter}
                    onCheckedChange={(v) =>
                      updateSettings({ sendOnEnter: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Show timestamps</span>
                  <Switch
                    checked={settings.showTimestamps}
                    onCheckedChange={(v) =>
                      updateSettings({ showTimestamps: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Sound effects</span>
                  <Switch
                    checked={settings.soundEffects}
                    onCheckedChange={(v) =>
                      updateSettings({ soundEffects: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm">Temporary chats by default</span>
                    <span className="text-xs text-muted-foreground">
                      New chats aren't saved to history unless you keep them
                    </span>
                  </div>
                  <Switch
                    checked={settings.temporaryByDefault}
                    onCheckedChange={(v) =>
                      updateSettings({ temporaryByDefault: v })
                    }
                  />
                </div>
              </div>

              <Separator />

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Terminal commands</span>
                  <span className="text-xs text-muted-foreground">
                    How agent-mode tasks may run commands on your Mac
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm">Approval</span>
                    <span className="text-xs text-muted-foreground">
                      Applies to the agent's run_command and file tools and to
                      coding-agent permissions
                    </span>
                  </div>
                  <Select
                    value={settings.terminalApproval}
                    onValueChange={(v) =>
                      updateSettings({ terminalApproval: v as UserSettings["terminalApproval"] })
                    }
                  >
                    <SelectTrigger size="sm" className="w-44 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ask">Ask every time</SelectItem>
                      <SelectItem value="task">Ask once per task</SelectItem>
                      <SelectItem value="auto">Run automatically</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Compress context (Headroom)</span>
                    <span className="text-xs text-muted-foreground">
                      Shrink tool outputs and chat history before they reach the model,
                      using a local Headroom proxy. Turns off automatically if the proxy
                      isn't installed.
                    </span>
                  </div>
                  <Switch
                    checked={settings.contextCompression}
                    onCheckedChange={(v) => void handleContextCompressionToggle(v)}
                  />
                </div>
                {settings.contextCompression && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {proxyStatus
                      ? proxyStatus.serving ? (
                        <>
                          <CircleDot className="size-3.5 text-primary" />
                          <span>{proxyStatus.url} — available</span>
                        </>
                      ) : proxyStatus.installed ? (
                        <span>Proxy installed, starting…</span>
                      ) : (
                        <span>
                          Proxy not installed — install it with{" "}
                          <code className="rounded bg-muted px-1.5 py-0.5">
                            pip install &quot;headroom-ai[proxy]&quot;
                          </code>
                        </span>
                      )
                      : (
                        <>
                          <Wrench className="size-3.5" />
                          <span>Checking for a running proxy…</span>
                        </>
                      )}
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Replay setup</span>
                  <span className="text-xs text-muted-foreground">
                    Run the welcome wizard again (providers, skills, connectors)
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    resetOnboarding();
                    window.location.reload();
                  }}
                >
                  <RotateCcw className="size-4" />
                  Replay
                </Button>
              </div>

              <Separator />

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Data &amp; migration</span>
                  <span className="text-xs text-muted-foreground">
                    Back up everything or take your conversations to another app.
                    Import understands ChatUI backups as well as ChatGPT and
                    Claude exports.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => setShowExportDialog(true)}>
                    <Download className="size-4" />
                    Export…
                  </Button>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="size-4" />
                    Import…
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImport}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Memory Tab ─── */}
        {activeTab === "memory" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold">Memory</h2>
              <p className="text-sm text-muted-foreground">
                These settings are applied to all models throughout the app.
              </p>
              <Separator />

              <div className="flex flex-col gap-2">
                <Label htmlFor="nickname">Nickname</Label>
                <Input
                  id="nickname"
                  placeholder="e.g. Tom, buddy, chief"
                  value={settings.nickname}
                  onChange={(e) => updateSettings({ nickname: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  How the AI should address you
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="instructions">Global Instructions</Label>
                <Textarea
                  id="instructions"
                  placeholder="e.g. Always respond concisely. Use TypeScript code examples. Be direct and honest."
                  value={settings.instructions}
                  onChange={(e) => updateSettings({ instructions: e.target.value })}
                  className="min-h-32"
                />
                <p className="text-xs text-muted-foreground">
                  These instructions are prepended to every conversation as a system message
                </p>
              </div>

              <Separator />

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tavily-key">Tavily Search API Key (optional)</Label>
                <Input
                  id="tavily-key"
                  type="password"
                  placeholder="tvly-…"
                  defaultValue={getTavilyApiKey()}
                  onChange={(e) => setTavilyApiKey(e.target.value.trim())}
                />
                <p className="text-xs text-muted-foreground">
                  Improves web search quality in Deep Research and Discuss modes. Without a key, a keyless search (Bing + DuckDuckGo) is used. Get a free key at tavily.com.
                </p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Auto-save memory</span>
                  <span className="text-xs text-muted-foreground">
    Automatically extract and remember durable facts from your conversations
                  </span>
                </div>
                <Switch
                  checked={settings.autoMemory}
                  onCheckedChange={(v) => updateSettings({ autoMemory: v })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Embedding Model</span>
                  <span className="text-xs text-muted-foreground">
                    Local model used for semantic memory &amp; attachment search
                  </span>
                </div>
                <Select
                  value={settings.embeddingModel}
                  onValueChange={(v) => {
                    updateSettings({ embeddingModel: v });
                    setEmbeddingModel(v);
                  }}
                >
                  <SelectTrigger size="sm" className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMBEDDING_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Knowledge index</span>
                  <span className="text-xs text-muted-foreground">
                    Embeds chats, files, images, and memories once so the agent can find them by meaning.
                    Skills and connectors are always indexed.
                  </span>
                </div>
                <Switch
                  checked={settings.knowledgeEnabled}
                  onCheckedChange={(v) => updateSettings({ knowledgeEnabled: v })}
                />
              </div>

              {settings.knowledgeEnabled && (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {(
                      [
                        ["chats", "Past chats"],
                        ["files", "Files"],
                        ["images", "Images (captioned with your default model)"],
                        ["memories", "Memories"],
                      ] as Array<[keyof KnowledgeSourceToggles, string]>
                    ).map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <Switch
                          checked={settings.knowledgeSources[key]}
                          onCheckedChange={(v) =>
                            updateSettings({
                              knowledgeSources: { ...settings.knowledgeSources, [key]: v },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="knowledge-endpoint">Embeddings API endpoint (optional)</Label>
                    <Input
                      id="knowledge-endpoint"
                      placeholder="https://api.openai.com/v1 (empty = local model)"
                      value={settings.embeddingEndpoint?.baseUrl ?? ""}
                      onChange={(e) => {
                        const current = settings.embeddingEndpoint;
                        updateSettings({
                          embeddingEndpoint: {
                            baseUrl: e.target.value,
                            model: current?.model ?? "",
                            apiKey: current?.apiKey,
                          },
                        });
                        scheduleKnowledgeSweep(5_000);
                      }}
                    />
                    <Input
                      placeholder="Embedding model (e.g. text-embedding-3-small)"
                      value={settings.embeddingEndpoint?.model ?? ""}
                      onChange={(e) => {
                        const current = settings.embeddingEndpoint;
                        updateSettings({
                          embeddingEndpoint: {
                            baseUrl: current?.baseUrl ?? "",
                            model: e.target.value,
                            apiKey: current?.apiKey,
                          },
                        });
                        scheduleKnowledgeSweep(5_000);
                      }}
                    />
                    <Input
                      type="password"
                      placeholder="API key (optional)"
                      value={settings.embeddingEndpoint?.apiKey ?? ""}
                      onChange={(e) => {
                        const current = settings.embeddingEndpoint;
                        updateSettings({
                          embeddingEndpoint: {
                            baseUrl: current?.baseUrl ?? "",
                            model: current?.model ?? "",
                            apiKey: e.target.value,
                          },
                        });
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Any OpenAI-compatible /v1/embeddings endpoint (OpenAI, Ollama, LM Studio…). Changing the
                      endpoint or model re-embeds the whole index on the next sweep.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {knowledgeStats
                        ? `${knowledgeStats.totalChunks} indexed chunks${
                            knowledgeStats.embeddingModel ? ` · ${knowledgeStats.embeddingModel}` : ""
                          }`
                        : "Index not built yet"}
                    </span>
                    <Button size="sm" variant="outline" disabled={sweeping} onClick={() => void handleRebuildIndex()}>
                      {sweeping ? "Rebuilding…" : "Rebuild index"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Universal memory list */}
              <div className="flex flex-col gap-2">
                <Label>Universal Memory</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a memory manually…"
                    value={newMemoryText}
                    onChange={(e) => setNewMemoryText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newMemoryText.trim()) {
                        addMemory("global", newMemoryText.trim());
                        setNewMemoryText("");
                        setMemoryTick((t) => t + 1);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!newMemoryText.trim()}
                    onClick={() => {
                      addMemory("global", newMemoryText.trim());
                      setNewMemoryText("");
                      setMemoryTick((t) => t + 1);
                    }}
                  >
                    <Plus className="size-4" /> Add
                  </Button>
                </div>
                {(() => {
                  void memoryTick;
                  const entries = loadMemory("global");
                  if (entries.length === 0) {
                    return <p className="text-xs text-muted-foreground">No memories saved yet.</p>;
                  }
                  return (
                    <div className="flex flex-col gap-1.5">
                      {entries.map((entry) => (
                        <div key={entry.id} className="flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs">
                          <span>{entry.text}</span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => { deleteMemory("global", entry.id); setMemoryTick((t) => t + 1); }}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Project memory */}
              {projects.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label>Project Memory</Label>
                  <Select
                    value={memoryProjectId ?? ""}
                    onValueChange={(v) => setMemoryProjectId(v || null)}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue placeholder="Select a project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {memoryProjectId && (() => {
                    void memoryTick;
                    const entries = loadMemory(memoryProjectId);
                    if (entries.length === 0) {
                      return <p className="text-xs text-muted-foreground">No project memories yet.</p>;
                    }
                    return (
                      <div className="flex flex-col gap-1.5">
                        {entries.map((entry) => (
                          <div key={entry.id} className="flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs">
                            <span>{entry.text}</span>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => { deleteMemory(memoryProjectId, entry.id); setMemoryTick((t) => t + 1); }}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Models Tab ─── */}
        {activeTab === "models" && (
          <div className="flex flex-col gap-6">
            {/* Providers Section */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Providers</h2>
                </div>
                <Button
                  onClick={() => {
                    setEditingProvider(null);
                    setShowProviderForm(true);
                  }}
                >
                  <Plus className="size-4" />
                  Add Provider
                </Button>
              </div>

              {loading ? (
                <p className="text-sm text-muted-foreground">Loading providers...</p>
              ) : providers.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center gap-2 py-10">
                    <Server className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No providers configured yet
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setShowProviderForm(true)}
                    >
                      <Plus className="size-4" />
                      Add your first provider
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex flex-col gap-4">
                  {providers.map((provider) => {
                    const logoKey = provider.builtinKey
                      ? getProviderMeta(provider.builtinKey)?.logoKey ?? "custom"
                      : "custom";
                    return (
                        <Card key={provider.id}>
                            <div className="flex items-center justify-between ml-8 mr-6">
                              <div className="flex flex-col gap-1">
                                <CardTitle className="flex items-center gap-2">
                                  <ProviderLogo logoKey={logoKey} className="size-4" />
                                  {provider.name}
                                  <CardDescription className="flex items-center gap-2">
                                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                      {provider.baseUrl || "(local)"}
                                    </code>
                                  </CardDescription>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="mx-1">·</span>
                                    <KeyRound className="size-3" />
                                    {provider.hasKey ? "API key set" : "No API key"}
                                    <span className="mx-1">·</span>
                                    {provider.models.length} model{provider.models.length !== 1 ? "s" : ""}
                                  </div>
                                </CardTitle>
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setEditingProvider(provider);
                                    setShowProviderForm(true);
                                  }}
                                >
                                  <Pencil className="size-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setDeleteTarget(provider)}
                                >
                                  <Trash2 className="size-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                        </Card>
                    );
                  })}
                </div>
              )}
            </div>

            <Separator />

            {/* Models Section */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Models</h2>
                </div>
                <Button
                  onClick={() => setShowModelForm(true)}
                  disabled={providers.length === 0}
                >
                  <Plus className="size-4" />
                  Add Model
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Default Model</span>
                </div>
                <Select
                  value={settings.defaultModel ?? ""}
                  onValueChange={(v) =>
                    updateSettings({ defaultModel: v || null })
                  }
                >
                  <SelectTrigger size="sm" className="w-56">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {allModels.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No models available
                      </SelectItem>
                    ) : (
                      allModels.map((m) => (
                        <SelectItem key={m.id} value={m.name}>
                          <span className="flex items-center gap-2">
                            <ProviderLogo
                              logoKey={getProviderMeta(m.builtinKey ?? "custom")?.logoKey ?? "custom"}
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                            {modelLabel(m)}
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {allModels.length > 0 && (
                <div className="flex flex-col gap-2">
                  {allModels.map((m) => {
                    void visionTick;
                    const provider = providers.find((p) => p.id === m.providerId);
                    const override = getVisionOverride(m.providerId, m.name);
                    const caps = provider ? getModelCapabilitiesSync(provider, m.name) : null;
                    const visionOn = override ?? caps?.vision ?? false;
                    const cycleVision = () => {
                      if (override === undefined) setVisionOverride(m.providerId, m.name, true);
                      else if (override === true) setVisionOverride(m.providerId, m.name, false);
                      else setVisionOverride(m.providerId, m.name, undefined);
                      setVisionTick((t) => t + 1);
                    };
                    return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">
                          {modelLabel(m)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {m.name} · {m.providerName}
                          {settings.defaultModel === m.name && (
                            <span className="ml-2 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px]">
                              default
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={cycleVision}
                          title={`Vision: ${override === undefined ? "auto" : override ? "on" : "off"}${caps ? ` (detected: ${caps.vision ? "yes" : "no"})` : ""}`}
                          className={visionOn ? "text-primary" : "text-muted-foreground"}
                        >
                          {visionOn ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                          <span className="text-[10px]">{override === undefined ? "auto" : override ? "vision" : "no vision"}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            setEditingModel({ providerId: m.providerId, model: { id: m.id, name: m.name, displayName: m.displayName } });
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setDeleteModelTarget({ providerId: m.providerId, model: { id: m.id, name: m.name, displayName: m.displayName } })}
                        >
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}

              {allModels.length === 0 && (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center gap-2 py-10">
                    <Cpu className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No models added yet
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setShowModelForm(true)}
                      disabled={providers.length === 0}
                    >
                      <Plus className="size-4" />
                      Add your first model
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* ─── Skills Tab ─── */}
        {activeTab === "skills" && (
          <SkillsPanel activeDirectory={oc.activeDirectory} />
        )}

        {/* ─── Connectors Tab ─── */}
        {activeTab === "connectors" && (
          <ConnectorsPanel activeDirectory={oc.activeDirectory} />
        )}

        {/* ─── Updates Tab ─── */}
        {activeTab === "updates" && (
          <UpdatesPanel />
        )}

      </div>

      {/* Export Format Dialog */}
      <Dialog
        open={showExportDialog}
        onOpenChange={(o) => !o && setShowExportDialog(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export your data</DialogTitle>
            <DialogDescription>
              Conversations always travel with the portable formats; the ChatUI
              backup also keeps agents, providers, settings, schedules, and
              memories.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            {exportOptions.map((option) => (
              <div
                key={option.id}
                className="flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleExportOption(option)}
                >
                  <Download className="size-4" />
                  Download
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Provider Dialog */}
      <Dialog
        open={showProviderForm}
        onOpenChange={(o) => {
          if (!o) {
            setShowProviderForm(false);
            setEditingProvider(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProvider ? "Edit Provider" : "Add Provider"}
            </DialogTitle>
            <DialogDescription>
              {editingProvider
                ? "Update your provider configuration. Leave API key blank to keep the existing key."
                : "Choose a built-in provider or add a custom OpenAI-compatible endpoint."}
            </DialogDescription>
          </DialogHeader>
          <ProviderForm
            provider={editingProvider}
            onSave={handleSaveProvider}
            onCancel={() => {
              setShowProviderForm(false);
              setEditingProvider(null);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Add Model Dialog */}
      <Dialog
        open={showModelForm}
        onOpenChange={(o) => !o && setShowModelForm(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Model</DialogTitle>
            <DialogDescription>
              Select a provider, then choose a model from its API.
            </DialogDescription>
          </DialogHeader>
          <ModelForm
            providers={providers}
            onSave={handleAddModel}
            onCancel={() => setShowModelForm(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Provider Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Provider</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This will
              remove the provider, its API key, and all its models. This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteProvider}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Model Dialog */}
      <Dialog
        open={!!deleteModelTarget}
        onOpenChange={(o) => !o && setDeleteModelTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Model</DialogTitle>
            <DialogDescription>
              Remove "{deleteModelTarget ? modelLabel(deleteModelTarget.model) : ""}" from this provider?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteModelTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteModel}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Model Display Name Dialog */}
      <Dialog
        open={!!editingModel}
        onOpenChange={(o) => !o && setEditingModel(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Model Name</DialogTitle>
            <DialogDescription>
              Change the display name for "{editingModel ? modelLabel(editingModel.model) : ""}" (id: {editingModel?.model.name})
            </DialogDescription>
          </DialogHeader>
          <EditModelNameForm
            initialName={editingModel?.model.displayName ?? ""}
            onSave={handleSaveModelDisplayName}
            onCancel={() => setEditingModel(null)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditModelNameForm({
  initialName,
  onSave,
  onCancel,
}: {
  initialName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  return (
    <div className="flex flex-col gap-4 pt-2">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name"
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(name);
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(name)}>
          Save
        </Button>
      </div>
    </div>
  );
}
