import { useState } from "react";
import {
  ArrowUp,
  SquarePen,
  Sparkles,
  Plug,
  GraduationCap,
  ListTodo,
  Microscope,
  UsersRound,
  Check,
  Loader2,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputGroup } from "@/components/ui/input-group";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  installBundledSkill,
  installRegistrySkill,
  getBundledSkillContent,
} from "@/lib/skills-library";
import { listAllCatalogSkills } from "@/lib/skill-registry";
import { summarizeAgentPatch } from "@/lib/agent/tools";
import { customOAuthArgsFor, MCP_CATALOG } from "@/lib/mcp-catalog";
import { getMcpServer, saveMcpServer } from "@/lib/mcp-store";
import { beginMcpOauth, hasToken, readMcpAuth } from "@/lib/mcp-auth";
import type { AgentConfigPatch } from "@/types";
import type { SuggestionRequest } from "@/lib/agent/types";

export function SuggestionCard({
  suggestion,
  onDismiss,
  onInstallSkill,
  onOpenConnectors,
  onEnableMode,
  onApplyAgentConfig,
}: {
  suggestion: SuggestionRequest;
  onDismiss: () => void;
  onInstallSkill: (name: string) => Promise<void>;
  onOpenConnectors: () => void;
  onEnableMode: (mode: "council" | "learn" | "research" | "task") => void;
  onApplyAgentConfig?: (agentId: string, patch: AgentConfigPatch) => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [applied, setApplied] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const catalogEntry = MCP_CATALOG.find((c) => c.id === suggestion.target);
  const storedEntry =
    suggestion.kind === "connector" ? getMcpServer(suggestion.target) : undefined;
  // Bring-your-own-client connectors need the user's OAuth client before
  // sign-in can start — collected on the card below, never in Settings.
  const needsCustomCreds = !!catalogEntry?.customOAuth && !storedEntry?.oauthClientId;
  // API-key connectors need their keys — collected on the card below.
  const isApikeyEntry =
    suggestion.kind === "connector" &&
    !!catalogEntry &&
    catalogEntry.auth === "apikey" &&
    !!catalogEntry.envKeys &&
    catalogEntry.envKeys.length > 0;
  const hasStoredKeys =
    !!isApikeyEntry &&
    catalogEntry!.envKeys!.every((k) => !!storedEntry?.environment?.[k]);
  // Everything with credentials in place connects right from the card.
  const directConnect =
    suggestion.kind === "connector" &&
    !!catalogEntry &&
    catalogEntry.install.type === "remote" &&
    (catalogEntry.auth !== "apikey" || hasStoredKeys) &&
    !needsCustomCreds;
  const showKeyForm = !!isApikeyEntry && !hasStoredKeys && !connected;
  const showOAuthForm = needsCustomCreds && !connected;

  // Credential drafts live in card state only — secrets never enter chat.
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");

  const icon =
    suggestion.kind === "skill" ? (
      <Sparkles className="size-4" />
    ) : suggestion.kind === "connector" ? (
      <Plug className="size-4" />
    ) : suggestion.kind === "agent_mode" ? (
      <ListTodo className="size-4" />
    ) : suggestion.kind === "agent_config" ? (
      <Settings2 className="size-4" />
    ) : suggestion.target === "learn" ? (
      <GraduationCap className="size-4" />
    ) : suggestion.target === "research" ? (
      <Microscope className="size-4" />
    ) : suggestion.target === "task" ? (
      <ListTodo className="size-4" />
    ) : (
      <UsersRound className="size-4" />
    );

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await onInstallSkill(suggestion.target);
      setInstalled(true);
      toast.success(`Installed skill: ${suggestion.target}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to install skill: ${suggestion.target}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleConnect = () => {
    onOpenConnectors();
    onDismiss();
  };

  /** Browser OAuth sign-in with the freshly saved credentials, then poll
   * for the tokens. Reads the store directly so just-saved credentials are
   * picked up. The card stays put until this succeeds or the user dismisses. */
  const runOAuthSignIn = async () => {
    if (!catalogEntry || catalogEntry.install.type !== "remote") return;
    const fresh = getMcpServer(catalogEntry.id);
    const custom = customOAuthArgsFor(
      catalogEntry,
      fresh?.oauthClientId,
      fresh?.oauthClientSecret,
    );
    const url = await beginMcpOauth(catalogEntry.id, catalogEntry.install.url, custom);
    await openUrl(url);
    // The browser flow writes tokens when done; poll for up to ~5 min.
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        if (hasToken(await readMcpAuth(), catalogEntry.id)) {
          setConnected(true);
          toast.success(`${catalogEntry.name} connected — its tools are available from your next message`);
          onDismiss();
          return;
        }
      } catch {
        /* keep polling */
      }
    }
    toast.error(`Sign-in to ${catalogEntry.name} didn't complete`);
  };

  /** One-click connect: add the connector, then run the native OAuth
   * sign-in in the browser when the provider needs it. */
  const handleDirectConnect = async () => {
    if (!catalogEntry || catalogEntry.install.type !== "remote") return;
    setConnecting(true);
    try {
      if (!getMcpServer(catalogEntry.id)) {
        saveMcpServer(catalogEntry.id, {
          type: "remote",
          url: catalogEntry.install.url,
          enabled: true,
          addedAt: new Date().toISOString(),
        });
      }
      if (catalogEntry.auth === "oauth") {
        await runOAuthSignIn();
      } else {
        setConnected(true);
        toast.success(`${catalogEntry.name} connected — its tools are available from your next message`);
        onDismiss();
      }
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : typeof err === "string" && err
            ? err
            : `Failed to connect ${catalogEntry.name}`,
      );
    } finally {
      setConnecting(false);
    }
  };

  /** Save API keys from the card form, then connect without leaving the session. */
  const handleSaveKeysAndConnect = async () => {
    if (!catalogEntry || catalogEntry.install.type !== "remote" || !isApikeyEntry) return;
    const missing = catalogEntry.envKeys!.filter((k) => !apiKeys[k]?.trim());
    if (missing.length > 0) {
      toast.error(`Fill in ${missing.join(", ")}`);
      return;
    }
    setConnecting(true);
    try {
      const environment = Object.fromEntries(
        catalogEntry.envKeys!.map((k) => [k, apiKeys[k].trim()]),
      );
      saveMcpServer(catalogEntry.id, {
        type: "remote",
        url: catalogEntry.install.url,
        enabled: true,
        environment,
        addedAt: new Date().toISOString(),
      });
      setConnected(true);
      toast.success(`${catalogEntry.name} connected — its tools are available from your next message`);
      onDismiss();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to save keys`);
    } finally {
      setConnecting(false);
    }
  };

  /** Save the OAuth client from the card form, then start browser sign-in. */
  const handleSaveOAuthAndConnect = async () => {
    if (!catalogEntry || catalogEntry.install.type !== "remote") return;
    if (!oauthClientId.trim() || !oauthClientSecret.trim()) {
      toast.error("Paste both the OAuth client ID and secret");
      return;
    }
    setConnecting(true);
    try {
      saveMcpServer(catalogEntry.id, {
        type: "remote",
        url: catalogEntry.install.url,
        enabled: true,
        oauthClientId: oauthClientId.trim(),
        oauthClientSecret: oauthClientSecret.trim(),
        addedAt: new Date().toISOString(),
      });
      await runOAuthSignIn();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : `Failed to connect ${catalogEntry.name}`,
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleEnableMode = () => {
    // kind=agent_mode is the legacy alias for task mode (its target was
    // always "task"); enable Task mode directly instead of trusting it.
    onEnableMode(
      suggestion.kind === "agent_mode"
        ? "task"
        : (suggestion.target as "council" | "learn" | "research" | "task"),
    );
    onDismiss();
  };

  const handleApplyConfig = () => {
    if (!suggestion.agentPatch || !onApplyAgentConfig) return;
    onApplyAgentConfig(suggestion.target, suggestion.agentPatch!);
    setApplied(true);
    toast.success("Agent settings updated");
    onDismiss();
  };

  return (
    <InputGroup className="h-auto flex-col items-stretch gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            {icon}
            <span className="truncate text-sm font-medium">{suggestion.title}</span>
          </div>
          <span className="truncate text-xs text-muted-foreground mt-0.5">
            {suggestion.reason}
          </span>
          {suggestion.kind === "agent_config" && suggestion.agentPatch && (
            <span className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
              {summarizeAgentPatch(suggestion.agentPatch)}
            </span>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Dismiss and go back to text input"
        >
          <SquarePen className="size-3.5" />
          Back to text
        </button>
      </div>

      <div className="flex items-center gap-2">
        {suggestion.kind === "skill" && !installed && (
          <Button size="sm" onClick={() => void handleInstall()} disabled={installing}>
            {installing ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            Install skill
          </Button>
        )}
        {suggestion.kind === "skill" && installed && (
          <Button size="sm" variant="outline" onClick={onDismiss} disabled>
            <Check />
            Installed
          </Button>
        )}
        {suggestion.kind === "connector" && directConnect && !connected && (
          <Button size="sm" onClick={() => void handleDirectConnect()} disabled={connecting}>
            {connecting ? <Loader2 className="animate-spin" /> : <Plug />}
            Connect
          </Button>
        )}
        {suggestion.kind === "connector" && connected && (
          <Button size="sm" variant="outline" onClick={onDismiss} disabled>
            <Check />
            Connected
          </Button>
        )}
        {suggestion.kind === "connector" &&
          !directConnect &&
          !showKeyForm &&
          !showOAuthForm &&
          !connected && (
            <Button size="sm" onClick={handleConnect}>
              <Plug />
              Open Connectors
            </Button>
          )}
        {suggestion.kind === "mode" && (
          <Button size="sm" onClick={handleEnableMode}>
            <ArrowUp />
            Turn on
          </Button>
        )}
        {suggestion.kind === "agent_mode" && (
          <Button size="sm" onClick={handleEnableMode}>
            <ListTodo />
            Turn on Task mode
          </Button>
        )}
        {suggestion.kind === "agent_config" && !applied && (
          <Button
            size="sm"
            onClick={handleApplyConfig}
            disabled={!suggestion.agentPatch || !onApplyAgentConfig}
          >
            <Settings2 />
            Apply changes
          </Button>
        )}
        {suggestion.kind === "agent_config" && applied && (
          <Button size="sm" variant="outline" onClick={onDismiss} disabled>
            <Check />
            Applied
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>

      {/* Inline credential forms: auth completes in-session (plus the
          browser for OAuth) — never in Settings, and secrets never enter
          chat. The card stays until connect succeeds or the user dismisses. */}
      {showKeyForm && (
        <div className="flex flex-col gap-2">
          {catalogEntry!.envKeys!.map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <Label className="text-xs">{k.toUpperCase()}</Label>
              <Input
                value={apiKeys[k] ?? ""}
                onChange={(e) => setApiKeys((prev) => ({ ...prev, [k]: e.target.value }))}
                placeholder={`Paste your ${k}…`}
                type="password"
              />
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Keys stay on this device and are never sent as chat.
          </p>
          <div>
            <Button
              size="sm"
              onClick={() => void handleSaveKeysAndConnect()}
              disabled={connecting}
            >
              {connecting ? <Loader2 className="animate-spin" /> : <Plug />}
              Save & connect
            </Button>
          </div>
        </div>
      )}
      {showOAuthForm && (
        <div className="flex flex-col gap-2">
          {catalogEntry!.customOAuth?.setupHint && (
            <p className="text-[11px] text-muted-foreground">
              {catalogEntry!.customOAuth!.setupHint}
            </p>
          )}
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
          <div>
            <Button
              size="sm"
              onClick={() => void handleSaveOAuthAndConnect()}
              disabled={connecting}
            >
              {connecting ? <Loader2 className="animate-spin" /> : <Plug />}
              Save & sign in
            </Button>
          </div>
        </div>
      )}
    </InputGroup>
  );
}

/**
 * Helper that resolves a skill name to the correct install function.
 * Bundled skills use installBundledSkill; registry/custom skills use
 * installRegistrySkill.
 */
export async function installSkillByName(name: string): Promise<void> {
  if (getBundledSkillContent(name)) {
    await installBundledSkill(name, "global");
    return;
  }
  const catalog = await listAllCatalogSkills();
  const skill = catalog.find((s) => s.name === name);
  if (skill?.repo) {
    await installRegistrySkill(
      { name: skill.name, repo: skill.repo, dir: skill.dir, branch: skill.branch },
      "global",
    );
    return;
  }
  throw new Error(`Unknown skill: ${name}`);
}
