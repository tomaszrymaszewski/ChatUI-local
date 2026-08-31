import {
  checkHealth,
  createSession,
  sendMessageAsync,
  subscribeToGlobalEvents,
  getMessages,
  getSessionDiff,
  replyPermission,
  abortSession,
  getStoredConfig,
  getDefaultConfig,
  opencodeStatus,
  opencodeServeStart,
  type OpenCodeServerConfig,
  type Permission,
  type GlobalEvent,
} from "@/lib/opencode";
import type { RunContext } from "@/lib/agent/run-context";

/**
 * Headless coding-task delegation to opencode (the local coding agent whose
 * server the app already spawns on port 2138). The manager agent calls this
 * through the run_coding_task tool; opencode does the actual code editing in
 * the chosen project folder while we wait for its session to go idle, relay
 * permission requests through the same approval card as run_command, and
 * return the final summary + diff.
 */

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

async function resolveServerConfig(): Promise<OpenCodeServerConfig> {
  const stored = getStoredConfig();
  // Under Tauri, make sure the app-managed server is actually up. The app no
  // longer auto-starts it on launch, so start it on demand here — coding
  // delegation is the one remaining consumer of the opencode server.
  try {
    const status = await opencodeStatus();
    if (!status.serving) {
      await opencodeServeStart();
    }
    return stored ?? getDefaultConfig();
  } catch {
    // not under Tauri — fall through to the health check
  }
  const config = stored ?? getDefaultConfig();
  const health = await checkHealth(config).catch(() => null);
  if (!health?.healthy) {
    throw new Error(
      "The opencode server is not running. Run `opencode serve` on port 2138, then try again.",
    );
  }
  return config;
}

export interface CodingTaskOptions {
  prompt: string;
  /** Absolute path of the project folder opencode should work in. */
  directory: string;
  /** Approval hook — same card as run_command (respects the terminal-approval setting). */
  requestApproval?: RunContext["requestApproval"];
  timeoutMs?: number;
}

export interface CodingTaskResult {
  /** The coding agent's final answer text. */
  summary: string;
  filesChanged: Array<{ file: string; additions: number; deletions: number }>;
  timedOut: boolean;
}

export async function runCodingTask(opts: CodingTaskOptions): Promise<CodingTaskResult> {
  const config = await resolveServerConfig();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const session = await createSession(
    config,
    `Coding task — ${opts.prompt.slice(0, 48)}`,
    opts.directory,
  );

  let timedOut = false;
  let settleWait: (() => void) | null = null;
  let failWait: ((err: Error) => void) | null = null;
  const waitPromise = new Promise<void>((resolve, reject) => {
    settleWait = resolve;
    failWait = reject;
  });
  // If the timeout wins the race and the session errors afterwards, the
  // rejection would otherwise be unhandled.
  waitPromise.catch(() => {});

  let promptSent = false;
  const unsubscribe = subscribeToGlobalEvents(config, (gEvent: GlobalEvent) => {
    const event = gEvent.payload;
    const props = event.properties as Record<string, unknown>;
    if (event.type === "session.idle") {
      // Idle events before our prompt is sent are just instance startup noise.
      if (promptSent && props.sessionID === session.id) settleWait?.();
    } else if (event.type === "session.error") {
      const err = props.error as { data?: { message?: string } } | undefined;
      const message = err?.data?.message ?? "opencode session error";
      failWait?.(new Error(message));
    } else if (event.type === "permission.updated") {
      // The permission payload IS the properties object (see opencode-context).
      const perm = props as unknown as Permission;
      if (perm?.id && perm.sessionID === session.id) {
        void handlePermission(config, perm, opts.requestApproval);
      }
    }
  });

  try {
    await sendMessageAsync(
      config,
      session.id,
      { parts: [{ type: "text", text: opts.prompt }] },
      opts.directory,
    );
    promptSent = true;

    await Promise.race([
      waitPromise,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          void abortSession(config, session.id, opts.directory).catch(() => {});
          resolve();
        }, timeoutMs);
      }),
    ]);
  } finally {
    unsubscribe();
  }

  // Collect the final answer + diff (best-effort after abort/timeout too).
  const [entries, diff] = await Promise.all([
    getMessages(config, session.id, opts.directory).catch(() => []),
    getSessionDiff(config, session.id, opts.directory).catch(() => []),
  ]);

  const lastAssistant = [...entries]
    .reverse()
    .find((e) => e.info.role === "assistant");
  const summary = (lastAssistant?.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n")
    .trim();

  return {
    summary:
      summary ||
      "(the coding agent finished without a final text reply — check its session output)",
    filesChanged: diff.map((d) => ({
      file: d.file,
      additions: d.additions,
      deletions: d.deletions,
    })),
    timedOut,
  };
}

async function handlePermission(
  config: OpenCodeServerConfig,
  perm: Permission,
  requestApproval?: RunContext["requestApproval"],
): Promise<void> {
  let approved = true;
  if (requestApproval) {
    const command = [
      perm.title || `opencode permission (${perm.type})`,
      perm.pattern
        ? Array.isArray(perm.pattern)
          ? perm.pattern.join(", ")
          : perm.pattern
        : "",
    ]
      .filter(Boolean)
      .join(" — ");
    const resolution = await requestApproval({
      command,
      source: "opencode",
      reason: "The coding agent asks to run this while working on your task.",
    }).catch(() => ({ approved: false }));
    approved = resolution.approved;
  }
  await replyPermission(
    config,
    perm.sessionID,
    perm.id,
    approved ? "always" : "reject",
  ).catch(() => {});
}
