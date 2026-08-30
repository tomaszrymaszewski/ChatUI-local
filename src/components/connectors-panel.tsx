import { useState, useEffect, useCallback, useMemo, type ComponentType, type SVGProps } from "react";
import {
  Plug,
  Search,
  Plus,
  Check,
  RefreshCw,
  ShieldCheck,
  Loader2,
  ChevronDown,
  KeyRound,
  ExternalLink,
  Globe,
  Brain,
  Workflow,
  Flame,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  NotionLogo,
  TodoistLogo,
  LinearLogo,
  AtlassianLogo,
  ZapierLogo,
  AirtableLogo,
  FigmaLogo,
  WebflowLogo,
  GithubLogo,
  VercelLogo,
  CloudflareLogo,
  SentryLogo,
  PostmanLogo,
  UpstashLogo,
  SupabaseLogo,
  MongodbLogo,
  PrismaLogo,
  HuggingFaceLogo,
  StripeLogo,
  PaypalLogo,
  MicrosoftLogo,
} from "@/components/brand-logos";
import {
  getMcpStatus,
  addMcpServer,
  runOpendcodeMcpAuth,
  getDefaultConfig,
  type McpStatus,
} from "@/lib/opencode";
import {
  readOpencodeConfig,
  getMcpEntries,
  setMcpEntry,
  type McpEntry,
} from "@/lib/opencode-config";
import { searchMcpRegistry, type RegistryServer } from "@/lib/mcp-registry";
import {
  MCP_CATALOG,
  MCP_CATEGORIES,
  type McpCatalogEntry,
  type McpCategory,
} from "@/lib/mcp-catalog";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const MCP_ICONS: Record<string, { Icon: IconComponent; tile: string }> = {
  notion: { Icon: NotionLogo, tile: "bg-foreground/10 text-foreground" },
  todoist: { Icon: TodoistLogo, tile: "bg-[#E44332]/10 text-[#E44332]" },
  linear: { Icon: LinearLogo, tile: "bg-[#5E6AD2]/10 text-[#5E6AD2]" },
  atlassian: { Icon: AtlassianLogo, tile: "bg-[#0052CC]/10 text-[#0052CC] dark:text-[#579DFF]" },
  zapier: { Icon: ZapierLogo, tile: "bg-[#FF4F00]/10 text-[#FF4F00]" },
  airtable: { Icon: AirtableLogo, tile: "bg-[#18BFFF]/10 text-[#0FA0DD] dark:text-[#18BFFF]" },
  figma: { Icon: FigmaLogo, tile: "bg-[#F24E1E]/10 text-[#F24E1E]" },
  webflow: { Icon: WebflowLogo, tile: "bg-[#4353FF]/10 text-[#4353FF]" },
  github: { Icon: GithubLogo, tile: "bg-foreground/10 text-foreground" },
  vercel: { Icon: VercelLogo, tile: "bg-foreground/10 text-foreground" },
  cloudflare: { Icon: CloudflareLogo, tile: "bg-[#F38020]/10 text-[#F38020]" },
  sentry: { Icon: SentryLogo, tile: "bg-[#6C5FC7]/10 text-[#6C5FC7]" },
  postman: { Icon: PostmanLogo, tile: "bg-[#FF6C37]/10 text-[#FF6C37]" },
  context7: { Icon: UpstashLogo, tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  supabase: { Icon: SupabaseLogo, tile: "bg-[#3FCF8E]/10 text-[#2BA671] dark:text-[#3FCF8E]" },
  mongodb: { Icon: MongodbLogo, tile: "bg-green-500/10 text-green-600 dark:text-green-400" },
  prisma: { Icon: PrismaLogo, tile: "bg-foreground/10 text-foreground" },
  huggingface: { Icon: HuggingFaceLogo, tile: "bg-[#FFD21E]/15 text-[#F5A623]" },
  stripe: { Icon: StripeLogo, tile: "bg-[#635BFF]/10 text-[#635BFF]" },
  paypal: { Icon: PaypalLogo, tile: "bg-[#00457C]/10 text-[#0070E0]" },
  exa: { Icon: Search, tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  firecrawl: { Icon: Flame, tile: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  "microsoft-learn": { Icon: MicrosoftLogo, tile: "bg-foreground/5" },
  fetch: { Icon: Globe, tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  memory: { Icon: Brain, tile: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  "sequential-thinking": { Icon: Workflow, tile: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" },
};

const FALLBACK_ICON: { Icon: IconComponent; tile: string } = {
  Icon: Plug,
  tile: "bg-muted text-muted-foreground",
};

export function mcpIcon(id: string): { Icon: IconComponent; tile: string } {
  return MCP_ICONS[id] ?? FALLBACK_ICON;
}

function authLabel(entry: McpCatalogEntry): string {
  switch (entry.auth) {
    case "oauth":
      return "Sign in once";
    case "apikey":
      return "Needs an API key";
    case "none":
      return "No sign-in needed";
  }
}

export function ConnectorsPanel({
  serving,
  activeDirectory,
}: {
  serving: boolean;
  activeDirectory: string | null;
}) {
  const config = useMemo(() => getDefaultConfig(), []);
  const [scope, setScope] = useState<"global" | "project">("global");
  const [mcpEntries, setMcpEntries] = useState<Record<string, McpEntry>>({});
  const [mcpStatus, setMcpStatus] = useState<Record<string, McpStatus>>({});
  const [authing, setAuthing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<McpCategory | "All">("All");

  // API-key entry form
  const [apikeyTarget, setApikeyTarget] = useState<McpCatalogEntry | null>(null);
  const [apikeyValues, setApikeyValues] = useState<Record<string, string>>({});

  // Advanced (manual + registry search)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryResults, setRegistryResults] = useState<RegistryServer[]>([]);
  const [registrySearching, setRegistrySearching] = useState(false);
  const [mcpName, setMcpName] = useState("");
  const [mcpType, setMcpType] = useState<"remote" | "local">("remote");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");

  const directory = scope === "project" ? activeDirectory : null;

  const refresh = useCallback(async () => {
    const configObj = await readOpencodeConfig(directory);
    setMcpEntries(getMcpEntries(configObj));
    if (serving) {
      try {
        const status = await getMcpStatus(config, directory ?? undefined);
        setMcpStatus(status);
      } catch {
        /* ignore */
      }
    }
  }, [config, serving, directory]);

  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

  // Debounced registry search (advanced only)
  useEffect(() => {
    if (!advancedOpen || !registryQuery.trim()) {
      setRegistryResults([]);
      return;
    }
    setRegistrySearching(true);
    const timer = setTimeout(async () => {
      const results = await searchMcpRegistry(registryQuery);
      setRegistryResults(results);
      setRegistrySearching(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [registryQuery, advancedOpen]);

  const installedIds = useMemo(() => new Set(Object.keys(mcpEntries)), [mcpEntries]);

  const addEntry = async (name: string, entry: McpEntry) => {
    await setMcpEntry(directory, name, entry);
    if (serving) {
      try {
        await addMcpServer(config, { name, config: entry as never }, directory ?? undefined);
      } catch {
        /* config write still persists */
      }
    }
  };

  const handleAddCatalog = async (cat: McpCatalogEntry) => {
    if (cat.auth === "apikey" && cat.envKeys && cat.envKeys.length > 0) {
      // Open the API-key form instead of adding immediately.
      setApikeyTarget(cat);
      setApikeyValues(Object.fromEntries(cat.envKeys.map((k) => [k, ""])));
      return;
    }
    setAdding(cat.id);
    try {
      const entry: McpEntry =
        cat.install.type === "remote"
          ? { type: "remote", url: cat.install.url, enabled: true }
          : { type: "local", command: cat.install.command, enabled: true };
      await addEntry(cat.id, entry);
      toast.success(`Added ${cat.name}`);
      setTick((t) => t + 1);
    } catch {
      toast.error(`Failed to add ${cat.name}`);
    } finally {
      setAdding(null);
    }
  };

  const confirmApikeyAdd = async () => {
    if (!apikeyTarget) return;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(apikeyValues)) {
      if (!v.trim()) {
        toast.error(`Please enter a value for ${k}`);
        return;
      }
      env[k] = v.trim();
    }
    setAdding(apikeyTarget.id);
    try {
      const entry: McpEntry =
        apikeyTarget.install.type === "remote"
          ? { type: "remote", url: apikeyTarget.install.url, enabled: true, environment: env }
          : { type: "local", command: apikeyTarget.install.command, enabled: true, environment: env };
      await addEntry(apikeyTarget.id, entry);
      toast.success(`Added ${apikeyTarget.name}`);
      setApikeyTarget(null);
      setApikeyValues({});
      setTick((t) => t + 1);
    } catch {
      toast.error(`Failed to add ${apikeyTarget.name}`);
    } finally {
      setAdding(null);
    }
  };

  const handleAuth = async (name: string) => {
    setAuthing(name);
    try {
      await runOpendcodeMcpAuth(name);
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const status = await getMcpStatus(config, directory ?? undefined);
          if (status[name]?.status === "connected") {
            toast.success(`${name} connected`);
            break;
          }
        } catch {
          /* keep polling */
        }
      }
    } catch {
      toast.error(`Failed to sign in to ${name}`);
    } finally {
      setAuthing(null);
      setTick((t) => t + 1);
    }
  };

  const handleAddManual = async () => {
    if (!mcpName.trim()) return;
    const entry: McpEntry =
      mcpType === "remote"
        ? { type: "remote", url: mcpUrl.trim(), enabled: true }
        : { type: "local", command: mcpCommand.trim().split(/\s+/).filter(Boolean), enabled: true };
    try {
      await addEntry(mcpName.trim(), entry);
      toast.success(`Added ${mcpName.trim()}`);
      setMcpName("");
      setMcpUrl("");
      setMcpCommand("");
      setTick((t) => t + 1);
    } catch {
      toast.error("Failed to add MCP");
    }
  };

  const handleAddFromRegistry = async (server: RegistryServer) => {
    if (!server.id) return;
    const name = server.id.replace(/[/.]/g, "-").replace(/^-+|-+$/g, "");
    if (!name) return;
    const entry: McpEntry = server.remoteUrl
      ? { type: "remote", url: server.remoteUrl, enabled: true }
      : { type: "local", command: ["npx", "-y", server.packageName ?? name], enabled: true };
    try {
      await addEntry(name, entry);
      toast.success(`Added ${server.title || name}`);
      setTick((t) => t + 1);
    } catch {
      toast.error("Failed to add MCP");
    }
  };

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MCP_CATALOG.filter((e) => {
      if (category !== "All" && e.category !== category) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.tagline.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Plug className="size-5" /> Connectors
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect the AI to your other apps — like Notion, GitHub, or Figma — so it can read
          and update them for you. Add an app, sign in once in your browser, and you're done.
          These are official connections from each app's maker.
        </p>
      </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search apps…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Save to:</span>
              <Select value={scope} onValueChange={(v) => setScope(v as "global" | "project")}>
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">All projects (~/.config)</SelectItem>
                  <SelectItem value="project" disabled={!activeDirectory}>
                    {activeDirectory
                      ? `This project (${activeDirectory.replace(/.*\//, "")})`
                      : "This project (open one first)"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setTick((t) => t + 1)}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(["All", ...MCP_CATEGORIES] as Array<McpCategory | "All">).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  category === c
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">

          {/* ─── Directory ─── */}
          <div className="flex flex-col gap-3 pt-4">
            <span className="text-sm font-medium">Browse official apps</span>

            {/* API-key form */}
            {apikeyTarget && (
              <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="size-3.5" /> {apikeyTarget.name} needs a key
                </div>
                {apikeyTarget.envKeys?.map((k) => (
                  <div key={k} className="flex flex-col gap-1">
                    <Label className="text-xs">{k}</Label>
                    <Input
                      value={apikeyValues[k] ?? ""}
                      onChange={(e) =>
                        setApikeyValues((prev) => ({ ...prev, [k]: e.target.value }))
                      }
                      placeholder={`Paste your ${k}…`}
                      type="password"
                    />
                  </div>
                ))}
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setApikeyTarget(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={adding === apikeyTarget.id} onClick={confirmApikeyAdd}>
                    {adding === apikeyTarget.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Add
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {filteredCatalog.map((cat) => {
                const installed = installedIds.has(cat.id);
                const needsAuth = mcpStatus[cat.id]?.status === "needs_auth";
                const { Icon, tile } = mcpIcon(cat.id);
                return (
                  <div
                    key={cat.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border p-4 transition-colors",
                      installed
                        ? needsAuth
                          ? "border-amber-500/40 bg-amber-500/5"
                          : "border-emerald-500/30 bg-emerald-500/5"
                        : "hover:border-foreground/20 hover:bg-muted/50",
                    )}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-lg",
                          tile,
                        )}
                      >
                        <Icon className="size-5" />
                      </div>
                      {installed ? (
                        needsAuth ? (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={authing === cat.id}
                            onClick={() => handleAuth(cat.id)}
                          >
                            {authing === cat.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <ExternalLink className="size-3" />
                            )}
                            Sign in
                          </Button>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
                          >
                            <Check className="size-2.5" /> Added
                          </Badge>
                        )
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={adding === cat.id}
                          onClick={() => handleAddCatalog(cat)}
                        >
                          {adding === cat.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Plus className="size-3" />
                          )}
                          Add
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold leading-tight">{cat.name}</span>
                      <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {cat.tagline}
                      </span>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10px] text-muted-foreground/70">
                      <span className="truncate">{authLabel(cat)} · {cat.vendor}</span>
                      <span className="shrink-0 rounded-full border px-2 py-0.5">{cat.category}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {filteredCatalog.length === 0 && (
              <p className="text-xs text-muted-foreground">No apps match your search.</p>
            )}
          </div>

          <Separator className="my-4" />

          {/* ─── Advanced ─── */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span>Advanced: search all & add manually</span>
                <ChevronDown
                  className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-muted-foreground">
                    Search the full public MCP registry (includes community servers).
                  </span>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search the registry (e.g. github, sentry)…"
                      value={registryQuery}
                      onChange={(e) => setRegistryQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  {registrySearching && <p className="text-xs text-muted-foreground">Searching…</p>}
                  {registryResults.slice(0, 6).map((server) => (
                    <div
                      key={server.id}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
                    >
                      <div className="min-w-0 flex flex-col">
                        <span className="truncate text-sm font-medium">{server.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {server.description}
                        </span>
                      </div>
                      <Button size="xs" onClick={() => handleAddFromRegistry(server)}>
                        <Plus className="size-3" /> Add
                      </Button>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium">Add manually</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={mcpName}
                        onChange={(e) => setMcpName(e.target.value)}
                        placeholder="my-mcp"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Type</Label>
                      <Select
                        value={mcpType}
                        onValueChange={(v) => setMcpType(v as "remote" | "local")}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="remote">Remote (URL)</SelectItem>
                          <SelectItem value="local">Local (command)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {mcpType === "remote" ? (
                    <Input
                      value={mcpUrl}
                      onChange={(e) => setMcpUrl(e.target.value)}
                      placeholder="https://mcp.example.com/mcp"
                    />
                  ) : (
                    <Input
                      value={mcpCommand}
                      onChange={(e) => setMcpCommand(e.target.value)}
                      placeholder="npx -y @modelcontextprotocol/server-foo"
                    />
                  )}
                  <Button
                    size="sm"
                    disabled={
                      !mcpName.trim() ||
                      (mcpType === "remote" ? !mcpUrl.trim() : !mcpCommand.trim())
                    }
                    onClick={handleAddManual}
                  >
                    <Plus className="size-3.5" /> Add MCP
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" />
          <span>
            Connections run locally through your AI engine and stay on your machine. Each app's
            maker provides its own connection — you only grant access to what you choose.
          </span>
        </div>
    </div>
  );
}
