import { useState, useEffect, useCallback, useMemo, type ComponentType, type SVGProps } from "react";
import {
  Plug,
  Search,
  Plus,
  Check,
  RefreshCw,
  ShieldCheck,
  Loader2,
  KeyRound,
  ExternalLink,
  Globe,
  Brain,
  Workflow,
  Flame,
  Trash2,
  ChevronRight,
  ArrowLeft,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { openBrowserSignIn } from "@/lib/browser-signin";
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
import { openUrl } from "@tauri-apps/plugin-opener";
import { readMcpAuth, hasToken, beginMcpOauth, clearMcpTokens, type McpAuthData } from "@/lib/mcp-auth";
import {
  ensureMcpMigrated,
  loadMcpServers,
  saveMcpServer,
  removeMcpServer,
  type McpServerEntry,
} from "@/lib/mcp-store";
import { searchMcpRegistry, type RegistryServer } from "@/lib/mcp-registry";
import {
  customOAuthArgsFor,
  listCachedConnectors,
  MCP_CATEGORIES,
  type McpCatalogEntry,
  type McpCategory,
} from "@/lib/mcp-catalog";
import { useOpencodeContext } from "@/lib/opencode-context";

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
  "cloudflare-docs": { Icon: CloudflareLogo, tile: "bg-[#F38020]/10 text-[#F38020]" },
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
  "playwright-browser": { Icon: Globe, tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
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
      return entry.customOAuth ? "Needs your Google client" : "Sign in once";
    case "apikey":
      return "Needs an API key";
    case "none":
      return "No sign-in needed";
  }
}

/** A row in the app lists: catalog entry, or a manually added server. */
interface DisplayRow {
  id: string;
  name: string;
  tagline: string;
  catalog: McpCatalogEntry | null;
}

/**
 * Full-page connector browser (the composer chip's "Connect apps" page):
 * search, an Installed section, then the catalog grouped by category —
 * each category drills into its own page. Manage and Custom app live in the
 * top-right; the back arrow top-left returns to chat (or up a level).
 */
export function ConnectorsPage({ onBack }: { onBack: () => void }) {
  const oc = useOpencodeContext();
  const activeDirectory = oc.activeDirectory;

  const [scope, setScope] = useState<"global" | "project">("global");
  const [mcpEntries, setMcpEntries] = useState<Record<string, McpServerEntry>>({});
  const [mcpAuth, setMcpAuth] = useState<McpAuthData>({});
  const [authing, setAuthing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<McpCategory | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [customAppOpen, setCustomAppOpen] = useState(false);

  // API-key entry form
  const [apikeyTarget, setApikeyTarget] = useState<McpCatalogEntry | null>(null);
  const [apikeyValues, setApikeyValues] = useState<Record<string, string>>({});

  // Bring-your-own-OAuth-client form (Google Workspace connectors)
  const [oauthTarget, setOauthTarget] = useState<McpCatalogEntry | null>(null);
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");

  // Browser sign-in form: opens the agent browser so the user can log into
  // websites (Gmail, …) by hand; the session persists for agent runs.
  const [browserSigninOpen, setBrowserSigninOpen] = useState(false);
  const [browserSigninUrl, setBrowserSigninUrl] = useState("");
  const [browserSigninBusy, setBrowserSigninBusy] = useState(false);

  // Custom app dialog: manual add + registry search
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryResults, setRegistryResults] = useState<RegistryServer[]>([]);
  const [registrySearching, setRegistrySearching] = useState(false);
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpToken, setMcpToken] = useState("");

  const directory = scope === "project" ? activeDirectory : null;

  const refresh = useCallback(async () => {
    await ensureMcpMigrated();
    const all = loadMcpServers();
    // Scope filter: global entries everywhere, project entries only in
    // their project.
    const scoped: Record<string, McpServerEntry> = {};
    for (const [name, entry] of Object.entries(all)) {
      if (scope === "project" ? entry.projectDir === activeDirectory : !entry.projectDir) {
        scoped[name] = entry;
      }
    }
    setMcpEntries(scoped);
    // Sign-in status comes from the token store on disk.
    setMcpAuth(await readMcpAuth());
  }, [activeDirectory, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

  // Debounced registry search (custom app dialog only)
  useEffect(() => {
    if (!customAppOpen || !registryQuery.trim()) {
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
  }, [registryQuery, customAppOpen]);

  const catalog = useMemo(() => listCachedConnectors(), [tick]);
  const installedIds = useMemo(() => new Set(Object.keys(mcpEntries)), [mcpEntries]);

  const addEntry = async (name: string, entry: McpServerEntry) => {
    saveMcpServer(name, entry);
  };

  const openOauthForm = (cat: McpCatalogEntry) => {
    const existing = loadMcpServers()[cat.id];
    setOauthTarget(cat);
    setOauthClientId(existing?.oauthClientId ?? "");
    setOauthClientSecret(existing?.oauthClientSecret ?? "");
  };

  const handleAddCatalog = async (cat: McpCatalogEntry) => {
    if (cat.customOAuth) {
      // Google-style connectors need the user's own OAuth client first.
      openOauthForm(cat);
      return;
    }
    if (cat.auth === "apikey" && cat.envKeys && cat.envKeys.length > 0) {
      // Open the API-key form instead of adding immediately.
      setApikeyTarget(cat);
      setApikeyValues(Object.fromEntries(cat.envKeys.map((k) => [k, ""])));
      return;
    }
    setAdding(cat.id);
    try {
      const entry: McpServerEntry = {
        type: "remote",
        url: cat.install.url,
        enabled: true,
        ...(directory ? { projectDir: directory } : {}),
        addedAt: new Date().toISOString(),
      };
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
      const entry: McpServerEntry = {
        type: "remote",
        url: apikeyTarget.install.url,
        enabled: true,
        environment: env,
        ...(directory ? { projectDir: directory } : {}),
        addedAt: new Date().toISOString(),
      };
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

  const confirmOAuthAdd = async () => {
    if (!oauthTarget?.customOAuth) return;
    if (!oauthClientId.trim() || !oauthClientSecret.trim()) {
      toast.error("Paste both the OAuth client ID and secret");
      return;
    }
    setAdding(oauthTarget.id);
    try {
      const entry: McpServerEntry = {
        type: "remote",
        url: oauthTarget.install.url,
        enabled: true,
        oauthClientId: oauthClientId.trim(),
        oauthClientSecret: oauthClientSecret.trim(),
        ...(directory ? { projectDir: directory } : {}),
        addedAt: new Date().toISOString(),
      };
      await addEntry(oauthTarget.id, entry);
      const target = oauthTarget;
      setOauthTarget(null);
      setOauthClientId("");
      setOauthClientSecret("");
      setTick((t) => t + 1);
      // Credentials saved — start the sign-in right away.
      await handleAuth(target.id);
    } catch {
      toast.error(`Failed to add ${oauthTarget.name}`);
    } finally {
      setAdding(null);
    }
  };

  const handleUninstall = async (id: string, name: string) => {
    setUninstalling(id);
    try {
      // Drop the stored entry (its tools leave the agent's set immediately)
      // and, best-effort, the sign-in tokens on disk.
      removeMcpServer(id);
      try {
        await clearMcpTokens(id);
      } catch {
        /* token cleanup is best-effort */
      }
      toast.success(`Removed ${name}`);
    } catch {
      toast.error(`Failed to remove ${name}`);
    } finally {
      setUninstalling(null);
      setTick((t) => t + 1);
    }
  };

  const handleAuth = async (name: string) => {
    // Read the store directly — state can lag a just-saved entry (the OAuth
    // form saves credentials and starts sign-in in one go).
    const entry = loadMcpServers()[name] ?? mcpEntries[name];
    if (!entry) return;
    const cat = listCachedConnectors().find((c) => c.id === name);
    if (cat?.customOAuth && !entry.oauthClientId) {
      openOauthForm(cat);
      return;
    }
    setAuthing(name);
    try {
      // Native OAuth flow: the Rust side registers a client (or uses the
      // user's own for bring-your-own-client connectors), binds the
      // callback listener, and returns the authorize URL for the browser.
      const url = await beginMcpOauth(
        name,
        entry.url,
        cat ? customOAuthArgsFor(cat, entry.oauthClientId, entry.oauthClientSecret) : undefined,
      );
      await openUrl(url);
      // The browser flow writes tokens to the store when done; poll it
      // for up to ~5 minutes.
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          if (hasToken(await readMcpAuth(), name)) {
            toast.success(`${name} connected`);
            break;
          }
        } catch {
          /* keep polling */
        }
      }
    } catch (err) {
      // Surface the Rust error (e.g. "no dynamic client registration") so
      // the user knows whether to retry or paste a personal token below.
      toast.error(
        err instanceof Error && err.message
          ? `Could not sign in to ${name}: ${err.message}`
          : typeof err === "string" && err
            ? `Could not sign in to ${name}: ${err}`
            : `Failed to sign in to ${name}`,
      );
    } finally {
      setAuthing(null);
      setTick((t) => t + 1);
    }
  };

  const handleAddManual = async () => {
    if (!mcpName.trim() || !mcpUrl.trim()) return;
    try {
      // An optional personal token (Zapier's per-user MCP URL secret, a PAT,
      // ...) is stored as an explicit auth header — no external tooling needed.
      const rawToken = mcpToken.trim();
      const headers =
        rawToken.length > 0
          ? {
              Authorization: /^\s*bearer\s/i.test(rawToken)
                ? rawToken.trim()
                : `Bearer ${rawToken}`,
            }
          : undefined;
      await addEntry(mcpName.trim(), {
        type: "remote",
        url: mcpUrl.trim(),
        enabled: true,
        ...(headers ? { headers } : {}),
        ...(directory ? { projectDir: directory } : {}),
        addedAt: new Date().toISOString(),
      });
      toast.success(`Added ${mcpName.trim()}`);
      setMcpName("");
      setMcpUrl("");
      setMcpToken("");
      setCustomAppOpen(false);
      setTick((t) => t + 1);
    } catch {
      toast.error("Failed to add MCP");
    }
  };

  const handleAddFromRegistry = async (server: RegistryServer) => {
    if (!server.id) return;
    if (!server.remoteUrl) {
      // Local (stdio) servers cannot run in the app's webview.
      toast.error("Only remote (URL) MCP servers can be used in the app.");
      return;
    }
    const name = server.id.replace(/[/.]/g, "-").replace(/^-+|-+$/g, "");
    if (!name) return;
    try {
      await addEntry(name, {
        type: "remote",
        url: server.remoteUrl,
        enabled: true,
        ...(directory ? { projectDir: directory } : {}),
        addedAt: new Date().toISOString(),
      });
      toast.success(`Added ${server.title || name}`);
      setCustomAppOpen(false);
      setTick((t) => t + 1);
    } catch {
      toast.error("Failed to add MCP");
    }
  };

  const needsAuth = useCallback(
    (id: string, cat: McpCatalogEntry | null) =>
      !!cat && cat.auth === "oauth" && !hasToken(mcpAuth, id),
    [mcpAuth],
  );

  // Installed rows: catalog entries that are installed, plus manually added
  // servers that aren't in the catalog.
  const installedRows = useMemo(() => {
    const rows: DisplayRow[] = [];
    for (const cat of catalog) {
      if (installedIds.has(cat.id)) {
        rows.push({ id: cat.id, name: cat.name, tagline: cat.tagline, catalog: cat });
      }
    }
    for (const name of Object.keys(mcpEntries)) {
      if (rows.some((r) => r.id === name)) continue;
      const cat = catalog.find((c) => c.id === name) ?? null;
      if (cat) continue;
      rows.push({
        id: name,
        name,
        tagline: mcpEntries[name].url,
        catalog: null,
      });
    }
    return rows;
  }, [catalog, mcpEntries, installedIds]);

  const matchesQuery = useCallback(
    (e: McpCatalogEntry) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.tagline.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.keywords ?? []).some((k) => k.toLowerCase().includes(q))
      );
    },
    [query],
  );

  const searchResults = useMemo(
    () => catalog.filter(matchesQuery),
    [catalog, matchesQuery],
  );

  const categorySections = useMemo(
    () =>
      MCP_CATEGORIES.map((c) => ({
        category: c,
        entries: catalog.filter((e) => e.category === c),
      })).filter((s) => s.entries.length > 0),
    [catalog],
  );

  /** Row action: Add, Sign in, or a quiet "connected" check. */
  const rowAction = (row: DisplayRow) => {
    const installed = installedIds.has(row.id);
    if (!installed) {
      return (
        <Button
          size="icon-xs"
          variant="ghost"
          className="rounded-full text-muted-foreground hover:text-foreground"
          title={`Add ${row.name}`}
          disabled={adding === row.id}
          onClick={() => row.catalog && handleAddCatalog(row.catalog)}
        >
          {adding === row.id ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
        </Button>
      );
    }
    if (needsAuth(row.id, row.catalog)) {
      return (
        <Button
          size="xs"
          variant="outline"
          disabled={authing === row.id}
          onClick={() => handleAuth(row.id)}
        >
          {authing === row.id ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ExternalLink className="size-3" />
          )}
          Sign in
        </Button>
      );
    }
    return (
      <button
        type="button"
        title={`Remove ${row.name}`}
        aria-label={`Remove ${row.name}`}
        disabled={uninstalling === row.id}
        onClick={() => void handleUninstall(row.id, row.name)}
        className="group flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 transition-colors hover:bg-red-500 hover:text-white focus-visible:bg-red-500 focus-visible:text-white disabled:opacity-60 dark:text-emerald-400 dark:hover:text-white dark:focus-visible:text-white"
      >
        {uninstalling === row.id ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <>
            <Check className="size-3.5 group-hover:hidden group-focus-visible:hidden" />
            <X className="hidden size-3.5 group-hover:block group-focus-visible:block" />
          </>
        )}
      </button>
    );
  };

  const connectorRow = (row: DisplayRow) => {
    const { Icon, tile } = mcpIcon(row.id);
    return (
      <div
        key={row.id}
        className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50"
      >
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tile)}>
          <Icon className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{row.name}</span>
          <span className="truncate text-xs text-muted-foreground">{row.tagline}</span>
        </div>
        <div className="shrink-0">{rowAction(row)}</div>
      </div>
    );
  };

  const sectionHeader = (
    title: string,
    opts?: { onOpen?: () => void },
  ) => (
    <button
      type="button"
      onClick={opts?.onOpen}
      disabled={!opts?.onOpen}
      className={cn(
        "group flex items-center gap-1 text-sm font-semibold",
        opts?.onOpen && "transition-colors hover:text-foreground/70",
      )}
    >
      {title}
      {opts?.onOpen && (
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  );

  const backTarget = category
    ? () => setCategory(null)
    : manageOpen
      ? () => setManageOpen(false)
      : onBack;

  const title = category ?? (manageOpen ? "Manage connections" : "Connectors");

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Top bar: back left, Manage / Custom app right ─── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={backTarget} aria-label="Go back">
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        {!category && !manageOpen && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setBrowserSigninOpen((v) => !v)}>
              <Globe className="size-3.5" />
              Browser sign-in
            </Button>
            <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}>
              Manage
            </Button>
            <Button size="sm" onClick={() => setCustomAppOpen(true)}>
              <Plus className="size-3.5" />
              Custom app
            </Button>
          </div>
        )}
      </div>

      {/* ─── Browser sign-in: log into websites for agents that browse ─── */}
      {browserSigninOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Globe className="size-3.5" /> Sign in to a website for your agents
          </div>
          <p className="text-xs text-muted-foreground">
            Opens the agent browser's own profile so you can sign in once (e.g. Gmail).
            Agents reuse the saved session on later runs. Close the window when you're done —
            agents can't use the browser while it stays open.
          </p>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Website (optional)</Label>
            <Input
              value={browserSigninUrl}
              onChange={(e) => setBrowserSigninUrl(e.target.value)}
              placeholder="https://mail.google.com"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setBrowserSigninOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={browserSigninBusy}
              onClick={async () => {
                setBrowserSigninBusy(true);
                try {
                  await openBrowserSignIn(browserSigninUrl);
                  toast.success("Browser opened — sign in, then close the window.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                } finally {
                  setBrowserSigninBusy(false);
                }
              }}
            >
              {browserSigninBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ExternalLink className="size-3.5" />
              )}
              Open browser
            </Button>
          </div>
        </div>
      )}

      {!manageOpen && !category && (
        <p className="text-sm text-muted-foreground">
          Connect apps so the AI can read and update them for you. Add an app,
          sign in once in your browser, and you're done.
        </p>
      )}

      {/* ─── Search ─── */}
      {!manageOpen && (
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search apps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-full border-transparent bg-muted/50 pl-10"
          />
        </div>
      )}

      {/* ─── Entry forms (API key / Google OAuth client) ─── */}
      {oauthTarget?.customOAuth && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-3.5" /> {oauthTarget.name} needs your Google client
          </div>
          <p className="text-xs text-muted-foreground">
            {oauthTarget.customOAuth.setupHint}{" "}
            <button
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => void openUrl(oauthTarget.customOAuth!.setupUrl)}
            >
              Open Google Cloud console
            </button>
          </p>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">OAuth client ID</Label>
            <Input
              value={oauthClientId}
              onChange={(e) => setOauthClientId(e.target.value)}
              placeholder="….apps.googleusercontent.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">OAuth client secret</Label>
            <Input
              value={oauthClientSecret}
              onChange={(e) => setOauthClientSecret(e.target.value)}
              placeholder="Paste your client secret…"
              type="password"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOauthTarget(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={adding === oauthTarget.id} onClick={confirmOAuthAdd}>
              {adding === oauthTarget.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Save & sign in
            </Button>
          </div>
        </div>
      )}

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

      {/* ─── Manage: scope + installed list ─── */}
      {manageOpen && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">New connections save to:</span>
              <Select value={scope} onValueChange={(v) => setScope(v as "global" | "project")}>
                <SelectTrigger size="sm" className="w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">All sessions (app-wide)</SelectItem>
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

          {installedRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No connectors added yet. Pick apps from the catalog to get started.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {installedRows.map((row) => {
                const { Icon, tile } = mcpIcon(row.id);
                return (
                  <div
                    key={row.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tile)}>
                      <Icon className="size-4.5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{row.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {row.catalog ? authLabel(row.catalog) : "Custom connection"}
                        {mcpEntries[row.id]?.url ? ` · ${mcpEntries[row.id].url}` : ""}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {needsAuth(row.id, row.catalog) && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={authing === row.id}
                          onClick={() => handleAuth(row.id)}
                        >
                          {authing === row.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <ExternalLink className="size-3" />
                          )}
                          Sign in
                        </Button>
                      )}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${row.name}`}
                        title="Remove"
                        disabled={uninstalling === row.id}
                        onClick={() => handleUninstall(row.id, row.name)}
                        className="text-muted-foreground hover:text-destructive dark:hover:text-destructive"
                      >
                        {uninstalling === row.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Browse: search results, or Installed + category sections ─── */}
      {!manageOpen && (
        <div className="flex flex-col gap-6">
          {query.trim() ? (
            <div className="flex flex-col gap-1">
              {sectionHeader("Results")}
              {searchResults.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  No apps match “{query.trim()}”.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                  {searchResults.map((cat) =>
                    connectorRow({ id: cat.id, name: cat.name, tagline: cat.tagline, catalog: cat }),
                  )}
                </div>
              )}
            </div>
          ) : category ? (
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                {catalog
                  .filter((e) => e.category === category)
                  .map((cat) =>
                    connectorRow({ id: cat.id, name: cat.name, tagline: cat.tagline, catalog: cat }),
                  )}
              </div>
            </div>
          ) : (
            <>
              {installedRows.length > 0 && (
                <div className="flex flex-col gap-1">
                  {sectionHeader("Installed")}
                  <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                    {installedRows.map(connectorRow)}
                  </div>
                </div>
              )}

              {categorySections.map((section) => (
                <div key={section.category} className="flex flex-col gap-1">
                  {sectionHeader(section.category, {
                    onOpen: () => setCategory(section.category),
                  })}
                  <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                    {section.entries.slice(0, 4).map((cat) =>
                      connectorRow({ id: cat.id, name: cat.name, tagline: cat.tagline, catalog: cat }),
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0" />
            <span>
              Connections run locally through your AI engine and stay on your machine. Each app's
              maker provides its own connection — you only grant access to what you choose.
            </span>
          </div>
        </div>
      )}

      {/* ─── Custom app dialog: manual add + registry search ─── */}
      <Dialog open={customAppOpen} onOpenChange={setCustomAppOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="size-5" /> Custom app
            </DialogTitle>
            <DialogDescription>
              Connect any remote MCP server by URL. Local stdio servers cannot
              run in the app.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
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
                <Label className="text-xs">URL</Label>
                <Input
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                  placeholder="https://mcp.example.com/mcp"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Access token (optional)</Label>
              <Input
                value={mcpToken}
                onChange={(e) => setMcpToken(e.target.value)}
                placeholder="Paste a personal token if the provider gave you one…"
                type="password"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Use the token field when sign-in isn't offered, e.g. a Zapier
              per-user MCP URL secret or any other personal access token.
            </p>
            <Button
              size="sm"
              disabled={!mcpName.trim() || !mcpUrl.trim()}
              onClick={handleAddManual}
            >
              <Plus className="size-3.5" /> Add MCP
            </Button>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium">Or search the public MCP registry</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search the registry (e.g. github, sentry)…"
                value={registryQuery}
                onChange={(e) => setRegistryQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {registrySearching && (
              <p className="text-xs text-muted-foreground">Searching…</p>
            )}
            {registryResults.slice(0, 6).map((server) => (
              <div
                key={server.id}
                className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
              >
                <div className="flex min-w-0 flex-col">
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
