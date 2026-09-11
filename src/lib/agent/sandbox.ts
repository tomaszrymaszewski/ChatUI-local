import { invoke } from "@tauri-apps/api/core";

/**
 * Filesystem sandbox for saved-agent runs. Saved agents are restricted to an
 * allowlist of directories (their private workspace + user-granted folders
 * and projects); standalone tasks run unrestricted (approval-gated as before).
 *
 * - `allowedDirectories: undefined` → unrestricted (standalone task runs).
 * - `allowedDirectories: []` → sandboxed with nowhere allowed (workspace
 *   creation failed or the user granted nothing) — file tools refuse paths
 *   with an explanatory message instead of silently allowing everything.
 */
export interface AgentSandbox {
  /** The saved agent this run belongs to (enables update_agent etc.). */
  agentId?: string;
  /** The agent's private workspace dir (always allowed; also in allowedDirectories). */
  workspace?: string;
  allowedDirectories?: string[];
  /** May read sessions that are not this agent's own: "all" | "selected" (undefined = off). */
  externalChats?: "all" | "selected";
  /** Session ids readable when externalChats === "selected". */
  allowedExternalSessions?: string[];
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let homeDirPromise: Promise<string | null> | null = null;

/** Home dir via the Rust shell (cached); null outside Tauri/tests. */
function homeDir(): Promise<string | null> {
  if (!isTauri()) return Promise.resolve(null);
  homeDirPromise ??= invoke<string>("get_home_dir").catch(() => null);
  return homeDirPromise;
}

/**
 * Normalize a path for allowlist comparison: expand a leading `~` with the
 * given home dir, drop "." segments, and resolve ".." lexically. Pure —
 * no filesystem access — so it stays testable.
 */
export function normalizePath(path: string, home?: string | null): string {
  let p = path.trim();
  if (home && (p === "~" || p.startsWith("~/"))) {
    p = home + p.slice(1);
  }
  const isAbs = p.startsWith("/");
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return (isAbs ? "/" : "") + out.join("/");
}

/**
 * True when `path` is `directory` itself or inside it. Compared case-blind
 * (macOS filesystems are case-insensitive by default).
 */
export function isPathWithin(
  path: string,
  directory: string,
  home?: string | null,
): boolean {
  const p = normalizePath(path, home).toLowerCase();
  const d = normalizePath(directory, home).toLowerCase();
  if (!d) return false;
  return p === d || p.startsWith(`${d}/`);
}

/**
 * True when the agent may touch `path` given its allowlist. An empty
 * allowlist allows nothing (sandboxed shut); undefined allows everything.
 */
export async function isPathAllowed(
  path: string,
  allowed: string[],
): Promise<boolean> {
  if (allowed.length === 0) return false;
  const home = await homeDir();
  return allowed.some((dir) => isPathWithin(path, dir, home));
}

/** Human-readable denial message listing where the agent may work. */
export function sandboxDeniedMessage(allowed: string[]): string {
  const list = allowed.filter(Boolean);
  const where = list.length > 0 ? list.join(", ") : "only its private workspace (not created yet)";
  return (
    "Access denied: that path is outside your sandbox. " +
    `You may only access: ${where}. ` +
    "Ask the user to add the folder in your agent settings (Access → Folders)."
  );
}

/** Minimal session shape shared by the store and the ChatView lists. */
export interface ReadableSession {
  id: string;
  agentId?: string;
  isTemporary?: boolean;
}

/**
 * True when the agent may read `session` via search_chats, given its sandbox:
 * its own past sessions are always readable; everything else (chats from the
 * Chat tab, other agents' and standalone task sessions) is external access,
 * granted wholesale ("all") or per session id ("selected"). Temporary
 * sessions are never readable.
 */
export function isSessionReadable(
  session: ReadableSession,
  sandbox: AgentSandbox,
): boolean {
  if (session.isTemporary) return false;
  if (!!sandbox.agentId && session.agentId === sandbox.agentId) return true;
  if (sandbox.externalChats === "all") return true;
  if (sandbox.externalChats === "selected") {
    return (sandbox.allowedExternalSessions ?? []).includes(session.id);
  }
  return false;
}

/**
 * The agent's private, persistent workspace folder under
 * ~/Documents/chatUI/agents/<agentId>. Ensured on demand (created when the
 * agent is first saved or starts its first session). Returns undefined when
 * the filesystem is unavailable (browser dev / tests).
 */
export async function ensureAgentWorkspace(
  agentId: string,
): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  try {
    const base = await invoke<string>("ensure_chat_ui_directory");
    const agentsDir = `${base}/agents`;
    const ws = `${agentsDir}/${agentId}`;
    if (!(await invoke<boolean>("path_exists", { path: ws }))) {
      await invoke("create_subdirectory", {
        parentPath: agentsDir,
        name: agentId,
      }).catch(() => {
        // Lost a create race or already exists — path_exists above is the
        // source of truth, so ignore.
      });
    }
    return ws;
  } catch {
    return undefined;
  }
}

/** Best-effort workspace cleanup when an agent is deleted. */
export async function removeAgentWorkspace(agentId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const base = await invoke<string>("ensure_chat_ui_directory");
    const ws = `${base}/agents/${agentId}`;
    if (await invoke<boolean>("path_exists", { path: ws })) {
      await invoke("remove_path", { path: ws });
    }
  } catch {
    // best-effort only
  }
}
