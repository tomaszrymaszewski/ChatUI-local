import type { Provider } from "@/types";
import type { AgentWorkflow } from "@/types";
import type { AgentMessage } from "@/lib/agent/runtime";
import type { AgentRunResult } from "@/lib/agent/types";
import { getAgentController } from "@/hooks/use-deep-agent";
import { loadAgentDefinitions } from "@/lib/agents";
import { fetchProviders } from "@/lib/llm";
import { loadUserSettings } from "@/hooks/use-user-settings";
import { loadProjectDirectories } from "@/hooks/use-projects";
import { createAgentSessionHeadless } from "@/hooks/use-sessions";
import {
  appendMessageHeadless,
  updateMessageHeadless,
} from "@/hooks/use-messages";
import { ensureAgentWorkspace } from "@/lib/agent/sandbox";
import { renderStepPrompt } from "@/lib/workflows";

/**
 * Headless agent runs for the scheduler and workflows: no UI, no React tree.
 * Each run gets a real agent-mode session (visible in the sidebar, openable
 * like any chat) and streams through the same controller registry the UI uses,
 * so the dashboard's "running now" view works for scheduled work too.
 *
 * Mirrors ChatView's agentRunContext: saved agents run sandboxed on their own
 * prompt/skills/connectors, restricted to their workspace + granted
 * folders/projects. Standalone runs (no agentId) use the task-agent defaults.
 */

export interface HeadlessRunOutcome {
  sessionId: string;
  /** Final assistant content ("" on failure). */
  content: string;
  cancelled: boolean;
  error?: string;
}

async function resolveProvider(modelName: string): Promise<Provider | null> {
  const providers = await fetchProviders();
  return providers.find((p) => p.models.some((m) => m.name === modelName)) ?? null;
}

/**
 * Run one prompt as one agent (or the standalone task agent when agentId is
 * omitted). Resolves everything from storage — safe to call outside React.
 */
export async function runHeadlessTask(opts: {
  agentId?: string;
  prompt: string;
  /** Session title shown in the sidebar. */
  title: string;
}): Promise<HeadlessRunOutcome> {
  const agentDef = opts.agentId
    ? loadAgentDefinitions().find((a) => a.id === opts.agentId)
    : undefined;
  if (opts.agentId && !agentDef) {
    throw new Error("Agent not found — it may have been deleted");
  }

  const instructions = agentDef
    ? [
        `You are "${agentDef.name}", a personal agent. Purpose: ${agentDef.purpose}`,
        agentDef.systemPrompt,
      ]
      .filter(Boolean)
      .join("\n\n")
    : undefined;

  const modelName = agentDef?.model ?? loadUserSettings().defaultModel;
  const provider = modelName ? await resolveProvider(modelName) : null;
  if (!provider || !modelName) {
    throw new Error(
      agentDef?.model
        ? `Model "${agentDef.model}" isn't configured in any provider`
        : "No default model configured — pick one in Settings",
    );
  }

  // Filesystem sandbox for saved agents: private workspace + granted folders
  // + granted projects' folders (same composition as ChatView).
  let workspace: string | undefined;
  let allowedDirectories: string[] | undefined;
  if (agentDef) {
    workspace = await ensureAgentWorkspace(agentDef.id).catch(() => undefined);
    const projectDirs = (agentDef.allowedProjects ?? [])
      .map((pid) => loadProjectDirectories().find((p) => p.id === pid)?.directory)
      .filter((d): d is string => !!d);
    allowedDirectories = [
      ...(workspace ? [workspace] : []),
      ...(agentDef.allowedFolders ?? []),
      ...projectDirs,
    ];
  }

  const session = createAgentSessionHeadless(opts.title, agentDef?.id);
  const sessionId = session.id;
  const userMsg = appendMessageHeadless(sessionId, {
    id: crypto.randomUUID(),
    role: "user",
    content: opts.prompt,
    timestamp: new Date(),
    session_id: sessionId,
    parent_id: null,
  });
  const assistantMsg = appendMessageHeadless(sessionId, {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    timestamp: new Date(),
    model: modelName,
    session_id: sessionId,
    parent_id: userMsg.id,
  });

  const messages: AgentMessage[] = [{ role: "user", content: opts.prompt }];
  const ctrl = getAgentController(sessionId);

  // Best-effort persistence while the run streams (same cadence as the UI).
  const saveInterval = setInterval(() => {
    updateMessageHeadless(sessionId, assistantMsg.id, {
      content: ctrl.streamingContent,
      reasoning: ctrl.streamingReasoning || undefined,
      activities: ctrl.activities.length ? [...ctrl.activities] : undefined,
      reasoningStreams: ctrl.reasoningStreams.length ? [...ctrl.reasoningStreams] : undefined,
    });
  }, 2500);

  let result: AgentRunResult;
  try {
    result = await ctrl.run({
      provider,
      modelName,
      messages,
      instructions,
      mode: "task",
      webFetchEnabled: agentDef?.capabilities.web ?? true,
      unattended: true,
      taskProfile: {
        toolProfile: "task",
        enableCommandTools: agentDef ? agentDef.capabilities.terminal : true,
        enableFileTools: !!agentDef,
        mcpNames: agentDef?.connectors,
        ...(agentDef && allowedDirectories
          ? {
              sandbox: {
                agentId: agentDef.id,
                workspace,
                allowedDirectories,
                readChats: agentDef.readChats ?? false,
              },
            }
          : {}),
      },
    });
  } catch (err) {
    clearInterval(saveInterval);
    const message = err instanceof Error ? err.message : String(err);
    updateMessageHeadless(sessionId, assistantMsg.id, {
      content: `⚠️ Run failed: ${message}`,
    });
    return { sessionId, content: "", cancelled: false, error: message };
  }
  clearInterval(saveInterval);

  // Persist the final transcript.
  updateMessageHeadless(sessionId, assistantMsg.id, {
    content: result.content,
    reasoning: result.reasoning || undefined,
    activities: result.activities,
    reasoningStreams: result.reasoningStreams,
    artifacts: result.artifacts,
  });

  return {
    sessionId,
    content: result.content,
    cancelled: result.cancelled,
    error: result.cancelled ? "Run was stopped" : undefined,
  };
}

/**
 * Run a workflow: steps execute in order, each step's prompt gets the previous
 * step's output via {{previous}}. Every step is its own session.
 * Returns the outcomes per step (index-aligned with workflow.steps).
 */
export async function runWorkflowSteps(
  workflow: AgentWorkflow,
): Promise<HeadlessRunOutcome[]> {
  const outcomes: HeadlessRunOutcome[] = [];
  let previous: string | null = null;
  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const prompt = renderStepPrompt(step, previous);
    outcomes.push(
      await runHeadlessTask({
        agentId: step.agentId,
        prompt,
        title: `${workflow.name} — step ${i + 1}/${workflow.steps.length}`,
      }),
    );
    previous = outcomes[i].content || null;
  }
  return outcomes;
}
