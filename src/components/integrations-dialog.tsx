import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Puzzle,
  Search,
  Plus,
  Trash2,
  Server,
  BookOpen,
  Check,
  RefreshCw,
  ShieldCheck,
  Loader2,
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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getMcpStatus,
  addMcpServer,
  getLspStatus,
  runOpendcodeMcpAuth,
  getDefaultConfig,
  type McpStatus,
  type LspStatus,
} from "@/lib/opencode";
import {
  readOpencodeConfig,
  getMcpEntries,
  setMcpEntry,
  removeMcpEntry,
  getLspEntries,
  setLspEntry,
  removeLspEntry,
  type McpEntry,
  type LspEntry,
} from "@/lib/opencode-config";
import { searchMcpRegistry, type RegistryServer } from "@/lib/mcp-registry";
import {
  listBundledSkills,
  listAnthropicSkills,
  installBundledSkill,
  installAnthropicSkill,
  listInstalledSkills,
  deleteSkill,
  type SkillCatalogEntry,
  type InstalledSkill,
} from "@/lib/skills-library";

function StatusBadge({ status }: { status: McpStatus | undefined }) {
  if (!status) return <Badge variant="secondary" className="text-[10px]">—</Badge>;
  const s = status.status;
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    connected: { label: "Connected", variant: "default" },
    disabled: { label: "Disabled", variant: "secondary" },
    failed: { label: "Failed", variant: "destructive" },
    needs_auth: { label: "Needs Auth", variant: "outline" },
    needs_client_registration: { label: "Needs Setup", variant: "outline" },
  };
  const info = map[s] ?? { label: s, variant: "secondary" as const };
  return <Badge variant={info.variant} className="text-[10px]">{info.label}</Badge>;
}

export function IntegrationsDialog({
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
  const [tab, setTab] = useState<"mcp" | "lsp" | "skills">("mcp");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [mcpEntries, setMcpEntries] = useState<Record<string, McpEntry>>({});
  const [mcpStatus, setMcpStatus] = useState<Record<string, McpStatus>>({});
  const [lspEntries, setLspEntries] = useState<Record<string, LspEntry>>({});
  const [lspStatus, setLspStatus] = useState<LspStatus[]>([]);
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryResults, setRegistryResults] = useState<RegistryServer[]>([]);
  const [registrySearching, setRegistrySearching] = useState(false);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogEntry[]>([]);
  const [authing, setAuthing] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Manual MCP form
  const [mcpName, setMcpName] = useState("");
  const [mcpType, setMcpType] = useState<"remote" | "local">("remote");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpEnabled, setMcpEnabled] = useState(true);

  // Manual LSP form
  const [lspName, setLspName] = useState("");
  const [lspCommand, setLspCommand] = useState("");
  const [lspExtensions, setLspExtensions] = useState("");

  const directory = scope === "project" ? activeDirectory : null;

  const refresh = useCallback(async () => {
    const configObj = await readOpencodeConfig(directory);
    setMcpEntries(getMcpEntries(configObj));
    setLspEntries(getLspEntries(configObj));
    if (serving) {
      try {
        const status = await getMcpStatus(config, directory ?? undefined);
        setMcpStatus(status);
      } catch { /* ignore */ }
      try {
        const lsp = await getLspStatus(config, directory ?? undefined);
        setLspStatus(lsp);
      } catch { /* ignore */ }
    }
    const globalSkills = await listInstalledSkills("global");
    const projectSkills = activeDirectory ? await listInstalledSkills("project", activeDirectory) : [];
    setInstalledSkills([...globalSkills, ...projectSkills]);
    const bundled = listBundledSkills();
    const anthropic = await listAnthropicSkills();
    setSkillCatalog([...bundled, ...anthropic]);
  }, [config, serving, directory, activeDirectory]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh, tick]);

  // Debounced registry search
  useEffect(() => {
    if (tab !== "mcp" || !registryQuery.trim()) {
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
  }, [registryQuery, tab]);

  const handleAddFromRegistry = async (server: RegistryServer) => {
    if (!server.id) return;
    const name = server.id.replace(/[/.]/g, "-").replace(/^-+|-+$/g, "");
    if (!name) return;
    const entry: McpEntry = server.remoteUrl
      ? { type: "remote", url: server.remoteUrl, enabled: true }
      : { type: "local", command: ["npx", "-y", server.packageName ?? name], enabled: true };
    try {
      await setMcpEntry(directory, name, entry);
      if (serving) {
        try {
          await addMcpServer(config, { name, config: entry as any }, directory ?? undefined);
        } catch { /* config write still persists */ }
      }
      toast.success(`Added MCP: ${name}`);
      setTick((t) => t + 1);
    } catch (err) {
      toast.error("Failed to add MCP");
    }
  };

  const handleAddManualMcp = async () => {
    if (!mcpName.trim()) return;
    const entry: McpEntry =
      mcpType === "remote"
        ? { type: "remote", url: mcpUrl.trim(), enabled: mcpEnabled }
        : { type: "local", command: mcpCommand.trim().split(/\s+/).filter(Boolean), enabled: mcpEnabled };
    try {
      await setMcpEntry(directory, mcpName.trim(), entry);
      if (serving) {
        try {
          await addMcpServer(config, { name: mcpName.trim(), config: entry as any }, directory ?? undefined);
        } catch { /* ignore */ }
      }
      toast.success(`Added MCP: ${mcpName.trim()}`);
      setMcpName(""); setMcpUrl(""); setMcpCommand("");
      setTick((t) => t + 1);
    } catch {
      toast.error("Failed to add MCP");
    }
  };

  const handleDeleteMcp = async (name: string) => {
    await removeMcpEntry(directory, name);
    setTick((t) => t + 1);
  };

  const handleAuth = async (name: string) => {
    setAuthing(name);
    try {
      await runOpendcodeMcpAuth(name);
      // Poll for status
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const status = await getMcpStatus(config, directory ?? undefined);
          if (status[name]?.status === "connected") {
            toast.success(`${name} authenticated`);
            break;
          }
        } catch { /* keep polling */ }
      }
    } catch {
      toast.error(`Failed to authenticate ${name}`);
    } finally {
      setAuthing(null);
      setTick((t) => t + 1);
    }
  };

  const handleAddLsp = async () => {
    if (!lspName.trim() || !lspCommand.trim()) return;
    const entry: LspEntry = {
      command: lspCommand.trim().split(/\s+/).filter(Boolean),
      extensions: lspExtensions.trim().split(/[, ]+/).filter(Boolean),
    };
    try {
      await setLspEntry(directory, lspName.trim(), entry);
      toast.success(`Added LSP: ${lspName.trim()}`);
      setLspName(""); setLspCommand(""); setLspExtensions("");
      setTick((t) => t + 1);
    } catch {
      toast.error("Failed to add LSP");
    }
  };

  const handleDeleteLsp = async (name: string) => {
    await removeLspEntry(directory, name);
    setTick((t) => t + 1);
  };

  const handleInstallSkill = async (skill: SkillCatalogEntry) => {
    try {
      if (skill.source === "bundled") {
        await installBundledSkill(skill.name, scope, activeDirectory ?? undefined);
      } else {
        await installAnthropicSkill(skill.name, scope, activeDirectory ?? undefined);
      }
      toast.success(`Installed skill: ${skill.name}`);
      setTick((t) => t + 1);
    } catch {
      toast.error(`Failed to install skill: ${skill.name}`);
    }
  };

  const handleDeleteSkill = async (skill: InstalledSkill) => {
    try {
      await deleteSkill(skill.name, skill.scope, activeDirectory ?? undefined);
      setTick((t) => t + 1);
    } catch {
      toast.error("Failed to delete skill");
    }
  };

  const mcpEntryList = Object.entries(mcpEntries);
  const lspEntryList = Object.entries(lspEntries);
  const installedNames = new Set(installedSkills.map((s) => s.name));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Puzzle className="size-5" /> Integrations
          </DialogTitle>
          <DialogDescription>
            Manage MCP servers, LSP servers, and skills. Changes are written to opencode.json.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Scope:</span>
            <Select value={scope} onValueChange={(v) => setScope(v as "global" | "project")}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global (~/.config)</SelectItem>
                <SelectItem value="project" disabled={!activeDirectory}>
                  {activeDirectory ? `Project (${activeDirectory.replace(/.*\//, "")})` : "Project (no dir)"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTick((t) => t + 1)}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full">
            <TabsTrigger value="mcp" className="flex-1"><Puzzle className="size-3.5" /> MCP</TabsTrigger>
            <TabsTrigger value="lsp" className="flex-1"><Server className="size-3.5" /> LSP</TabsTrigger>
            <TabsTrigger value="skills" className="flex-1"><BookOpen className="size-3.5" /> Skills</TabsTrigger>
          </TabsList>

          {/* ─── MCP Tab ─── */}
          <TabsContent value="mcp" className="max-h-[60vh] overflow-y-auto">
            <div className="flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Configured MCP servers</span>
                {mcpEntryList.length === 0 && <p className="text-xs text-muted-foreground">No MCP servers configured.</p>}
                {mcpEntryList.map(([name, entry]) => (
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
                        <Button size="xs" variant="outline" disabled={authing === name} onClick={() => handleAuth(name)}>
                          {authing === name ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
                          Auth
                        </Button>
                      )}
                      <Button size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => handleDeleteMcp(name)}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Add from registry</span>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search the MCP registry (e.g. github, sentry, context7)…"
                    value={registryQuery}
                    onChange={(e) => setRegistryQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {registrySearching && <p className="text-xs text-muted-foreground">Searching…</p>}
                {registryResults.slice(0, 8).map((server) => (
                  <div key={server.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div className="min-w-0 flex flex-col">
                      <span className="truncate text-sm font-medium">{server.title}</span>
                      <span className="truncate text-xs text-muted-foreground">{server.description}</span>
                    </div>
                    <Button size="xs" onClick={() => handleAddFromRegistry(server)}>
                      <Plus className="size-3" /> Add
                    </Button>
                  </div>
                ))}
                {registryQuery && !registrySearching && registryResults.length === 0 && (
                  <p className="text-xs text-muted-foreground">No results.</p>
                )}
              </div>

              <Separator />

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Add manually</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="my-mcp" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={mcpType} onValueChange={(v) => setMcpType(v as "remote" | "local")}>
                      <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="remote">Remote (URL)</SelectItem>
                        <SelectItem value="local">Local (command)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {mcpType === "remote" ? (
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">URL</Label>
                    <Input value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" />
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Command</Label>
                    <Input value={mcpCommand} onChange={(e) => setMcpCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-foo" />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch size="sm" checked={mcpEnabled} onCheckedChange={setMcpEnabled} /> Enabled
                  </label>
                  <Button size="sm" disabled={!mcpName.trim() || (mcpType === "remote" ? !mcpUrl.trim() : !mcpCommand.trim())} onClick={handleAddManualMcp}>
                    <Plus className="size-3.5" /> Add MCP
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ─── LSP Tab ─── */}
          <TabsContent value="lsp" className="max-h-[60vh] overflow-y-auto">
            <div className="flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Configured LSP servers</span>
                {lspEntryList.length === 0 && <p className="text-xs text-muted-foreground">No LSP servers configured.</p>}
                {lspEntryList.map(([name, entry]) => {
                  const status = lspStatus.find((s) => s.id === name);
                  return (
                    <div key={name} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{name}</span>
                          {status && (
                            <Badge variant={status.status === "connected" ? "default" : "destructive"} className="text-[10px]">
                              {status.status}
                            </Badge>
                          )}
                        </div>
                        <span className="truncate text-xs text-muted-foreground">{entry.command?.join(" ")}</span>
                      </div>
                      <Button size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => handleDeleteLsp(name)}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Add LSP server</span>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Name</Label>
                  <Input value={lspName} onChange={(e) => setLspName(e.target.value)} placeholder="typescript" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Command</Label>
                  <Input value={lspCommand} onChange={(e) => setLspCommand(e.target.value)} placeholder="typescript-language-server --stdio" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Extensions (comma separated)</Label>
                  <Input value={lspExtensions} onChange={(e) => setLspExtensions(e.target.value)} placeholder="ts, tsx, js, jsx" />
                </div>
                <Button size="sm" disabled={!lspName.trim() || !lspCommand.trim()} onClick={handleAddLsp}>
                  <Plus className="size-3.5" /> Add LSP
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ─── Skills Tab ─── */}
          <TabsContent value="skills" className="max-h-[60vh] overflow-y-auto">
            <div className="flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Installed skills</span>
                {installedSkills.length === 0 && <p className="text-xs text-muted-foreground">No skills installed.</p>}
                {installedSkills.map((skill) => (
                  <div key={`${skill.scope}-${skill.name}`} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div className="flex items-center gap-2">
                      <Check className="size-3.5 text-green-500" />
                      <span className="text-sm font-medium">{skill.name}</span>
                      <Badge variant="secondary" className="text-[10px]">{skill.scope}</Badge>
                    </div>
                    <Button size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => handleDeleteSkill(skill)}>
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Skill library</span>
                {skillCatalog.map((skill) => (
                  <div key={`${skill.source}-${skill.name}`} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div className="min-w-0 flex flex-col">
                      <span className="truncate text-sm font-medium">{skill.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{skill.description}</span>
                    </div>
                    {installedNames.has(skill.name) ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px]"><Check className="size-2.5" /> Installed</Badge>
                    ) : (
                      <Button size="xs" className="shrink-0" onClick={() => handleInstallSkill(skill)}>
                        <Plus className="size-3" /> Install
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
