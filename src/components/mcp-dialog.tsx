import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plug,
  Search,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  ShieldCheck,
  Loader2,
  ChevronDown,
  KeyRound,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  removeMcpEntry,
  type McpEntry,
} from "@/lib/opencode-config";
import { searchMcpRegistry, type RegistryServer } from "@/lib/mcp-registry";
import {
  MCP_CATALOG,
  MCP_CATEGORIES,
  type McpCatalogEntry,
  type McpCategory,
} from "@/lib/mcp-catalog";

function StatusBadge({ status }: { status: McpStatus | undefined }) {
  if (!status) return <Badge variant="secondary" className="text-[10px]">—</Badge>;
  const s = status.status;
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    connected: { label: "Connected", variant: "default" },
    disabled: { label: "Disabled", variant: "secondary" },
    failed: { label: "Failed", variant: "destructive" },
    needs_auth: { label: "Needs sign-in", variant: "outline" },
    needs_client_registration: { label: "Needs setup", variant: "outline" },
  };
  const info = map[s] ?? { label: s, variant: "secondary" as const };
  return <Badge variant={info.variant} className="text-[10px]">{info.label}</Badge>;
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

export function McpDialog({
  open,
  onOpenChange,
  serving,
  activeDirectory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    if (open) void refresh();
  }, [open, refresh, tick]);

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

  const handleDelete = async (name: string) => {
    await removeMcpEntry(directory, name);
    setTick((t) => t + 1);
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

  const entryList = Object.entries(mcpEntries);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="size-5" /> App Connections
          </DialogTitle>
          <DialogDescription>
            Connect the AI to your other apps — like Notion, GitHub, or Figma — so it can read
            and update them for you. Add an app, sign in once in your browser, and you're done.
            These are official connections from each app's maker.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
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

        <div className="max-h-[58vh] overflow-y-auto pr-1">
          {/* ─── Connected ─── */}
          <div className="flex flex-col gap-2 pb-3">
            <span className="text-sm font-medium">Connected apps</span>
            {entryList.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No apps connected yet. Browse the directory below to add one.
              </p>
            )}
            {entryList.map(([name, entry]) => (
              <div key={name} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{name}</span>
                    <StatusBadge status={mcpStatus[name]} />
                  </div>
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.type === "remote" ? entry.url : entry.command?.join(" ")}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {mcpStatus[name]?.status === "needs_auth" && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={authing === name}
                      onClick={() => handleAuth(name)}
                    >
                      {authing === name ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <ShieldCheck className="size-3" />
                      )}
                      Sign in
                    </Button>
                  )}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(name)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Separator />

          {/* ─── Directory ─── */}
          <div className="flex flex-col gap-3 pt-3">
            <span className="text-sm font-medium">Browse official apps</span>

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
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as McpCategory | "All")}
              >
                <SelectTrigger size="sm" className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All categories</SelectItem>
                  {MCP_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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

            {filteredCatalog.map((cat) => {
              const installed = installedIds.has(cat.id);
              const needsAuth = mcpStatus[cat.id]?.status === "needs_auth";
              return (
                <div
                  key={cat.id}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{cat.name}</span>
                      <Badge variant="outline" className="text-[10px]">{cat.category}</Badge>
                      <Badge variant="secondary" className="text-[10px]">Official</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{cat.tagline}</span>
                    <span className="text-[10px] text-muted-foreground/70">
                      {authLabel(cat)} · by {cat.vendor}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
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
                        <Badge variant="secondary" className="text-[10px]">
                          <Check className="size-2.5" /> Added
                        </Badge>
                      )
                    ) : (
                      <Button
                        size="xs"
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
                </div>
              );
            })}
            {filteredCatalog.length === 0 && (
              <p className="text-xs text-muted-foreground">No apps match your search.</p>
            )}
          </div>

          <Separator className="my-3" />

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
      </DialogContent>
    </Dialog>
  );
}
