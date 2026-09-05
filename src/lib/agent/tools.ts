import { z } from "zod";
import { tool, type StructuredTool } from "langchain";
import { executeTool } from "@/lib/tools";
import { runPython } from "@/lib/run-python";
import { runCommand } from "@/lib/run-command";
import { runCodingTask } from "@/lib/coding-delegate";
import { readLocalFile, writeLocalFile } from "@/lib/local-file";
import {
  saveAgentDefinition,
  loadAgentDefinitions,
  updateAgentDefinition,
} from "@/lib/agents";
import {
  isPathAllowed,
  sandboxDeniedMessage,
  ensureAgentWorkspace,
  type AgentSandbox,
} from "@/lib/agent/sandbox";
import type { AgentConfigPatch } from "@/types";
import { getRunContext, type RunContext } from "@/lib/agent/run-context";
import { webSearch } from "@/lib/agent/web-search";
import { CURATED_SKILLS, listBundledSkills, listInstalledSkills } from "@/lib/skills-library";
import { MCP_CATALOG } from "@/lib/mcp-catalog";
import { getMcpEntries } from "@/lib/opencode-config";

let artifactCounter = 0;

/** Which extra tools a run gets: plain chat, an agent-mode task, or the agent builder. */
export type ToolProfile = "chat" | "task" | "setup";

/** Zod schema for the agent-editable settings (update_agent / suggest). */
const agentPatchSchema = z.object({
  name: z.string().optional().describe("New short agent name."),
  purpose: z.string().optional().describe("New one-line purpose shown in the sidebar."),
  system_prompt: z.string().optional().describe("The agent's complete new system prompt."),
  model: z.string().nullable().optional().describe("New model name, or null to go back to the app's default model."),
  skills: z.array(z.string()).optional().describe("Installed skill names the agent may use (full replacement list)."),
  connectors: z.array(z.string()).optional().describe("Connector catalog ids (full replacement list)."),
  terminal: z.boolean().optional().describe("Whether the agent may run shell commands / delegate coding tasks."),
  web: z.boolean().optional().describe("Whether the agent may search/fetch the web."),
  files: z.boolean().optional().describe("Whether the agent may read/write local files (within its allowed folders)."),
  read_chats: z.boolean().optional().describe("Whether the agent may search the user's past chats."),
});

type AgentPatchInput = z.infer<typeof agentPatchSchema>;

/** Map the tool's snake_case patch into the app's AgentConfigPatch. */
function toAgentPatch(input: AgentPatchInput): AgentConfigPatch {
  const patch: AgentConfigPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.purpose !== undefined) patch.purpose = input.purpose;
  if (input.system_prompt !== undefined) patch.systemPrompt = input.system_prompt;
  if (input.model !== undefined) patch.model = input.model;
  if (input.skills !== undefined) patch.skills = input.skills;
  if (input.connectors !== undefined) patch.connectors = input.connectors;
  if (input.terminal !== undefined) patch.terminal = input.terminal;
  if (input.web !== undefined) patch.web = input.web;
  if (input.files !== undefined) patch.files = input.files;
  if (input.read_chats !== undefined) patch.readChats = input.read_chats;
  return patch;
}

/** Short human-readable summary of a patch, for tool results and cards. */
export function summarizeAgentPatch(patch: AgentConfigPatch): string {
  const lines: string[] = [];
  if (patch.name !== undefined) lines.push(`name: "${patch.name}"`);
  if (patch.purpose !== undefined) lines.push(`purpose: ${patch.purpose}`);
  if (patch.systemPrompt !== undefined) lines.push("instructions updated");
  if (patch.model !== undefined) lines.push(patch.model ? `model: ${patch.model}` : "model: app default");
  if (patch.skills !== undefined) lines.push(`skills: ${patch.skills.join(", ") || "(none)"}`);
  if (patch.connectors !== undefined) lines.push(`connectors: ${patch.connectors.join(", ") || "(none)"}`);
  if (patch.terminal !== undefined) lines.push(`terminal: ${patch.terminal ? "on" : "off"}`);
  if (patch.web !== undefined) lines.push(`web: ${patch.web ? "on" : "off"}`);
  if (patch.files !== undefined) lines.push(`files: ${patch.files ? "on" : "off"}`);
  if (patch.readChats !== undefined) lines.push(`read chats: ${patch.readChats ? "on" : "off"}`);
  return lines.join("; ");
}

/** Apply an AgentConfigPatch (from update_agent or a suggestion card) to a saved agent. */
export function applyAgentConfigPatch(
  agentId: string,
  patch: AgentConfigPatch,
): { name: string } | null {
  const current = loadAgentDefinitions().find((a) => a.id === agentId);
  if (!current) return null;
  const { terminal, web, files, readChats, model, ...rest } = patch;
  const updated = updateAgentDefinition(agentId, {
    ...rest,
    ...(model !== undefined ? { model: model ?? undefined } : {}),
    ...(readChats !== undefined ? { readChats } : {}),
    capabilities: {
      ...current.capabilities,
      ...(terminal !== undefined ? { terminal } : {}),
      ...(web !== undefined ? { web } : {}),
      ...(files !== undefined ? { files } : {}),
    },
  });
  return updated ? { name: updated.name } : null;
}

async function runLegacyTool(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await executeTool({
    id: `lc-${name}-${Date.now()}`,
    name,
    arguments: JSON.stringify(args),
  });
  return result.content;
}

export function buildAgentTools(
  webFetchEnabled: boolean,
  getContext?: () => RunContext | null,
  profile: ToolProfile = "chat",
  /** Task profile: add read_file/write_file (sandboxed agents with the local-files capability). */
  enableFiles = false,
  /** Saved-agent runs: identity + filesystem sandbox + chat-history access. */
  sandbox?: AgentSandbox,
): StructuredTool[] {
  const ctxFn = getContext ?? getRunContext;
  const allowedNote = sandbox?.allowedDirectories
    ? ` You are sandboxed to these folders: ${sandbox.allowedDirectories.join(", ")}.`
    : "";
  const tools: StructuredTool[] = [
    tool(
      async ({ timezone }: { timezone?: string }) =>
        runLegacyTool("get_current_time", { timezone }),
      {
        name: "get_current_time",
        description: "Get the current time. Use when the user asks about the current time.",
        schema: z.object({
          timezone: z.string().optional().describe("Optional IANA timezone (e.g. 'America/New_York'). Defaults to the user's local timezone."),
        }),
      },
    ),
    tool(
      async ({ timezone }: { timezone?: string }) =>
        runLegacyTool("get_current_date", { timezone }),
      {
        name: "get_current_date",
        description: "Get the current date. Use when the user asks about today's date, what day it is, etc.",
        schema: z.object({
          timezone: z.string().optional().describe("Optional IANA timezone. Defaults to the user's local timezone."),
        }),
      },
    ),
    tool(
      async ({ location }: { location: string }) =>
        runLegacyTool("get_weather", { location }),
      {
        name: "get_weather",
        description: "Get current weather for a location. Use when the user asks about weather, temperature, forecast, rain, wind, etc.",
        schema: z.object({
          location: z.string().describe("City name or location (e.g. 'London', 'Tokyo')."),
        }),
      },
    ),
    tool(
      async ({ title, language, content }: { title: string; language: string; content: string }) => {
        const ctx = ctxFn();
        if (!ctx) return "Error: no active run — artifact could not be registered.";
        artifactCounter += 1;
        ctx.emit({
          type: "artifact",
          artifact: {
            id: `agent-art-${Date.now()}-${artifactCounter}`,
            title,
            language: language.toLowerCase(),
            content,
            index: 0,
          },
        });
        return (
          `Artifact "${title}" (${language}) is now open in the user's side panel. ` +
          `Do NOT repeat the artifact content in your reply. Instead, write a brief 1-2 sentence ` +
          `summary mentioning what you created and that the user can view, edit, and download it.`
        );
      },
      {
        name: "create_artifact",
        description:
          "Create a code or markdown document in the user's editable side panel. Use for substantial code " +
          "(python, html, react/jsx, javascript) and long markdown documents (research briefs, reports). " +
          "The user can edit it, run python, preview html/react, and export markdown as PDF/Word/HTML.",
        schema: z.object({
          title: z.string().describe("Short human-readable title, e.g. 'Sales chart' or 'Research brief'."),
          language: z.string().describe("Language identifier: python, html, jsx, javascript, markdown, …"),
          content: z.string().describe("Full file content."),
        }),
      },
    ),
    tool(
      async ({ code }: { code: string }) => {
        const result = await runPython(code);
        const parts: string[] = [];
        if (result.stdout) parts.push(`stdout:\n${result.stdout.slice(0, 8000)}`);
        if (result.stderr) parts.push(`stderr:\n${result.stderr.slice(0, 4000)}`);
        if (result.timedOut) parts.push("(execution timed out)");
        parts.push(`exit code: ${result.exitCode}`);
        return parts.join("\n\n");
      },
      {
        name: "run_python",
        description:
          "Run Python code on the user's system python3 and return stdout/stderr. " +
          "Use to execute or verify code you wrote (calculations, data processing, quick checks).",
        schema: z.object({
          code: z.string().describe("Complete Python script to execute."),
        }),
      },
    ),
    tool(
      async (input: {
        title: string;
        description?: string;
        submit_label?: string;
        fields: Array<{
          name: string;
          label: string;
          type: "text" | "textarea" | "number" | "select" | "checkbox" | "directory";
          description?: string;
          options?: string[];
          required?: boolean;
          default?: string | number | boolean;
        }>;
      }) => {
        // Pauses the tool until the user fills (or skips) a structured-input
        // form. We bypass langgraph's interrupt()/resume() machinery because
        // AsyncLocalStorage (which interrupt relies on) is never initialized in
        // the WKWebView browser environment, so interrupt() always throws
        // "Called interrupt() outside the context of a graph". Instead, the
        // hook wires a plain Promise through the run context.
        const ctx = ctxFn();
        if (!ctx?.requestInput) {
          return "Error: structured input is not available in this context. Ask the user in prose instead.";
        }
        const resolution = await ctx.requestInput({
          title: input.title,
          description: input.description,
          submitLabel: input.submit_label,
          fields: input.fields,
        });
        if ("cancelled" in resolution) {
          return "The user skipped the form. Continue with sensible defaults or ask in prose.";
        }
        return typeof resolution.values === "string"
          ? resolution.values
          : JSON.stringify(resolution.values);
      },
      {
        name: "request_structured_input",
        description:
          "Ask the user to fill a short structured form instead of typing free text. Use when a task " +
          "needs specific parameters (e.g. research topic + depth, code task spec, document outline, " +
          "or a project folder — use a 'directory' field so the user gets a folder picker). " +
          "The composer transforms into the form; the user can always switch back to free text.",
        schema: z.object({
          title: z.string().describe("Form title, e.g. 'Deep research setup'."),
          description: z.string().optional().describe("One-line explanation of why the form is needed."),
          submit_label: z.string().optional().describe("Submit button label, e.g. 'Start research'."),
          fields: z.array(
            z.object({
              name: z.string(),
              label: z.string(),
              type: z.enum(["text", "textarea", "number", "select", "checkbox", "directory"]),
              description: z.string().optional(),
              options: z.array(z.string()).optional().describe("Choices for select fields."),
              required: z.boolean().optional(),
              default: z.union([z.string(), z.number(), z.boolean()]).optional(),
            }),
          ).describe("2-6 fields. Keep it short."),
        }),
      },
    ),
    tool(
      async ({ query }: { query: string }) => {
        const q = query.toLowerCase().trim();
        const installed = await listInstalledSkills("global").catch(() => [] as Array<{ name: string }>);
        const installedNames = new Set(installed.map((s) => s.name));

        const bundled = listBundledSkills();
        const all = [
          ...bundled.map((b) => ({
            name: b.name,
            title: b.name,
            description: b.description,
            category: "Built-in",
            source: "bundled",
          })),
          ...CURATED_SKILLS.map((c) => ({
            name: c.name,
            title: c.title,
            description: c.description,
            category: c.category,
            source: c.sourceLabel,
          })),
        ];

        const scored = all
          .map((s) => {
            const haystack = `${s.name} ${s.title} ${s.description} ${s.category}`.toLowerCase();
            let score = 0;
            if (s.name === q || s.title.toLowerCase() === q) score = 100;
            else if (s.name.startsWith(q) || s.title.toLowerCase().startsWith(q)) score = 80;
            else if (haystack.includes(q)) score = 60;
            else {
              const terms = q.split(/\s+/).filter(Boolean);
              const hits = terms.filter((t) => haystack.includes(t)).length;
              if (hits > 0) score = hits * 15;
            }
            return { ...s, score, installed: installedNames.has(s.name) };
          })
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6);

        if (scored.length === 0) {
          return `No skills found for "${query}". The user can browse the full catalog in Settings → Skills.`;
        }

        const lines = scored.map(
          (s, i) =>
            `[${i + 1}] ${s.title} (${s.name})${s.installed ? " [INSTALLED]" : ""}\n    ${s.description}\n    Category: ${s.category} · Source: ${s.source}`,
        );
        return `Found ${scored.length} skill(s) for "${query}":\n\n${lines.join("\n\n")}`;
      },
      {
        name: "search_skills",
        description:
          "Search the skill catalog (bundled + curated) for skills matching a query. " +
          "Returns the skill name, description, category, and whether it is already installed. " +
          "Use this when the user's task might benefit from a skill that isn't installed yet " +
          "(e.g. creating Word/Excel/PPT/PDF documents, frontend design, testing). " +
          "If a matching skill is found and not installed, call suggest with kind=skill.",
        schema: z.object({
          query: z.string().describe("What the user wants to do, e.g. 'create word document' or 'react best practices'."),
        }),
      },
    ),
    tool(
      async ({ query }: { query: string }) => {
        const q = query.toLowerCase().trim();
        const config = await import("@/lib/opencode-config").then((m) => m.readOpencodeConfig(null)).catch(() => ({}));
        const entries = getMcpEntries(config);
        const connectedIds = new Set(Object.entries(entries).filter(([, e]) => e.enabled !== false).map(([id]) => id));

        const scored = MCP_CATALOG.map((c) => {
          const haystack = `${c.name} ${c.tagline} ${c.category} ${(c.keywords ?? []).join(" ")}`.toLowerCase();
          let score = 0;
          if (c.id === q || c.name.toLowerCase() === q) score = 100;
          else if (c.id.startsWith(q) || c.name.toLowerCase().startsWith(q)) score = 80;
          else if (haystack.includes(q)) score = 60;
          else {
            const terms = q.split(/\s+/).filter(Boolean);
            const hits = terms.filter((t) => haystack.includes(t)).length;
            if (hits > 0) score = hits * 15;
          }
          return {
            id: c.id,
            name: c.name,
            tagline: c.tagline,
            category: c.category,
            auth: c.auth,
            connected: connectedIds.has(c.id),
            score,
          };
        })
          .filter((c) => c.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6);

        if (scored.length === 0) {
          return `No connectors found for "${query}". The user can browse the full catalog in Settings → Connectors. For Google (Gmail, Calendar, Docs) or Microsoft 365 (Outlook, Excel, Word), suggest the Zapier connector.`;
        }

        const lines = scored.map(
          (c, i) =>
            `[${i + 1}] ${c.name}${c.connected ? " [CONNECTED]" : ""}\n    ${c.tagline}\n    Category: ${c.category} · Auth: ${c.auth}`,
        );
        return `Found ${scored.length} connector(s) for "${query}":\n\n${lines.join("\n\n")}`;
      },
      {
        name: "search_connectors",
        description:
          "Search the connector catalog (MCP servers) for connectors matching a query. " +
          "Returns the connector name, tagline, category, auth type, and whether it is already connected. " +
          "Use this when the user wants to interact with an external app (email, calendar, docs, " +
          "project management, etc.) and no matching connector is connected yet. " +
          "If a matching connector is found and not connected, call suggest with kind=connector. " +
          "For Google Workspace (Gmail, Calendar, Docs) and Microsoft 365 (Outlook, Excel, Word), " +
          "the Zapier connector covers all of them — search for 'gmail' or 'office' to find it.",
        schema: z.object({
          query: z.string().describe("What the user wants to connect to, e.g. 'gmail', 'google calendar', 'notion', 'office'."),
        }),
      },
    ),
    tool(
      async (input: {
        kind: "skill" | "connector" | "mode" | "agent_mode" | "agent_config";
        target: string;
        title: string;
        reason: string;
        agent_patch?: AgentPatchInput;
      }) => {
        const ctx = ctxFn();
        if (!ctx) return "Error: no active run — suggestion could not be shown.";
        ctx.emit({
          type: "suggestion",
          suggestion: {
            kind: input.kind,
            target: input.target,
            title: input.title,
            reason: input.reason,
            ...(input.kind === "agent_config" && input.agent_patch
              ? { agentPatch: toAgentPatch(input.agent_patch) }
              : {}),
          },
        });
        return `Suggestion "${input.title}" has been shown to the user as an actionable card. Continue your reply naturally — do not repeat the suggestion in text.`;
      },
      {
        name: "suggest",
        description:
          "Show the user an actionable suggestion card in place of the text composer. " +
          "Use after search_skills or search_connectors finds something useful that isn't " +
          "installed/connected yet, when the user's request would benefit from a mode " +
          "(research, discuss, learn), when the conversation has become a hands-on task " +
          "(running commands, editing files, multi-step local work) that the Agents tab " +
          "should take over (kind=agent_mode), or when a change to YOUR OWN agent settings " +
          "would help (kind=agent_config with an agent_patch — the user gets a one-click " +
          "Apply card). The card has a button to install/connect/enable/switch/apply and a " +
          "dismiss option. Call this instead of just mentioning the suggestion in prose.",
        schema: z.object({
          kind: z.enum(["skill", "connector", "mode", "agent_mode", "agent_config"]),
          target: z.string().describe(
            "For skill: the skill name (e.g. 'docx'). For connector: the catalog id (e.g. 'zapier'). For mode: 'research', 'council', or 'learn'. For agent_mode: 'task'. For agent_config: your own agent id from the configuration section of your prompt.",
          ),
          title: z.string().describe("Short headline for the card, e.g. 'Install Word Documents skill'."),
          reason: z.string().describe("1-2 sentences explaining why this is being suggested."),
          agent_patch: agentPatchSchema.optional().describe(
            "kind=agent_config only: the settings change you are proposing. Never include folder/project access — that is user-only.",
          ),
        }),
      },
    ),
  ];

  if (profile === "task") {
    tools.push(
      tool(
        async ({ command, cwd, reason }: { command: string; cwd?: string; reason?: string }) => {
          const ctx = ctxFn();
          if (!ctx?.requestApproval) {
            return "Error: command approval is not available in this context. Tell the user what you wanted to run instead.";
          }
          // The controller applies the terminal-approval setting here: it may
          // resolve immediately (auto / already-approved-this-task) or show an
          // approve/deny card to the user.
          const { approved } = await ctx.requestApproval({
            command,
            cwd,
            source: "run_command",
            reason,
          });
          if (!approved) {
            return "The user denied this command. Do not retry it — ask what to do differently or continue without it.";
          }
          const result = await runCommand(command, cwd);
          const parts: string[] = [];
          if (result.stdout) parts.push(`stdout:\n${result.stdout.slice(0, 8000)}`);
          if (result.stderr) parts.push(`stderr:\n${result.stderr.slice(0, 4000)}`);
          if (result.timedOut) parts.push("(command timed out and was killed)");
          parts.push(`exit code: ${result.exitCode}`);
          return parts.join("\n\n");
        },
        {
          name: "run_command",
          description:
            "Run a shell command on the user's Mac (login shell, so their PATH is available) and return " +
            "stdout/stderr. Use for file operations, git, builds, tests, inspecting the system — anything " +
            "a terminal can do. Prefer short, safe, targeted commands. The user approves commands " +
            "depending on their settings.",
          schema: z.object({
            command: z.string().describe("The shell command to execute."),
            cwd: z.string().optional().describe("Working directory (absolute path)."),
            reason: z.string().optional().describe("One line: why this command is needed."),
          }),
        },
      ),
      tool(
        async ({ prompt, directory }: { prompt: string; directory: string }) => {
          if (
            sandbox?.allowedDirectories &&
            !(await isPathAllowed(directory, sandbox.allowedDirectories))
          ) {
            return sandboxDeniedMessage(sandbox.allowedDirectories);
          }
          let result;
          try {
            const ctx = ctxFn();
            result = await runCodingTask({ prompt, directory, requestApproval: ctx?.requestApproval });
          } catch (err) {
            return `Coding task failed: ${err instanceof Error ? err.message : String(err)}`;
          }
          const lines: string[] = [
            result.timedOut
              ? "The coding agent timed out and was stopped. Partial results:"
              : "The coding agent finished.",
          ];
          lines.push(`Its final reply:\n${result.summary.slice(0, 6000)}`);
          if (result.filesChanged.length > 0) {
            lines.push(
              "Files changed:\n" +
                result.filesChanged
                  .map((f) => `- ${f.file} (+${f.additions}/-${f.deletions})`)
                  .join("\n"),
            );
          } else {
            lines.push("No files were changed.");
          }
          return lines.join("\n\n");
        },
        {
          name: "run_coding_task",
          description:
            "Delegate a coding task to the local coding agent (opencode), which edits files, runs " +
            "commands, and returns a summary + diff. Use this for real coding work instead of writing " +
            "code files yourself. ALWAYS confirm the project folder with the user first " +
            "(request_structured_input with a 'directory' field) and reuse that folder for the " +
            "rest of the task." + allowedNote,
          schema: z.object({
            prompt: z
              .string()
              .describe("Full task description for the coding agent: what to build/fix, constraints, where to look."),
            directory: z.string().describe("Absolute path of the project folder to work in."),
          }),
        },
      ),
    );

    if (sandbox?.agentId) {
      tools.push(
        tool(
          async (input: AgentPatchInput) => {
            const agentId = sandbox.agentId!;
            const patch = toAgentPatch(input);
            if (Object.keys(patch).length === 0) {
              return "Nothing to update — pass at least one field to change.";
            }
            const applied = applyAgentConfigPatch(agentId, patch);
            if (!applied) {
              return "Error: your agent definition could not be found or updated.";
            }
            return (
              `Your settings have been updated (${summarizeAgentPatch(patch)}). ` +
              `The new model and permissions apply from the next run onward; the new system prompt ` +
              `and skills apply from the next session. Folder, project, and knowledge-file access ` +
              `can only be changed by the user in your agent settings.`
            );
          },
          {
            name: "update_agent",
            description:
              "Update your own saved-agent settings: name, purpose, system prompt, model, skills, " +
              "connectors, and permissions (terminal / web / files / read chats). Call this whenever " +
              "the user asks you to change your setup by chatting (e.g. 'from now on, be more concise', " +
              "'use a different model'). Pass ONLY the fields that change. You cannot change your " +
              "folder, project, or knowledge-file access — those are user-only, so ask the user to " +
              "edit them in your agent settings.",
            schema: agentPatchSchema,
          },
        ),
      );
    }

    if (sandbox?.readChats) {
      tools.push(
        tool(
          async ({ query, session_id }: { query?: string; session_id?: string }) => {
            interface StoredSession {
              id: string;
              title: string;
              updatedAt?: string;
              isTemporary?: boolean;
            }
            let sessions: StoredSession[] = [];
            try {
              sessions = JSON.parse(localStorage.getItem("chatui:sessions") ?? "[]");
            } catch {
              return "Could not read the chat history.";
            }
            sessions = sessions.filter((s) => s && !s.isTemporary);

            // Read one session in full.
            if (session_id) {
              const session = sessions.find((s) => s.id === session_id);
              if (!session) return `No chat found with id "${session_id}". Use search_chats with a query to find the right id first.`;
              let messages: Array<{ role?: string; content?: string }> = [];
              try {
                messages = JSON.parse(
                  localStorage.getItem(`chatui:messages:${session_id}`) ?? "[]",
                );
              } catch {
                return `Could not read the messages of "${session.title}".`;
              }
              const MAX_MSGS = 40;
              const body = messages
                .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
                .slice(0, MAX_MSGS)
                .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content).slice(0, 500)}`)
                .join("\n\n");
              return `Chat "${session.title}" (${messages.length} messages, showing up to ${MAX_MSGS}):\n\n${body || "(empty)"}`.slice(0, 12000);
            }

            if (!query?.trim()) {
              return "Pass a search query, or a session_id (from a previous search) to read one chat in full.";
            }
            const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
            const matches: Array<{ session: StoredSession; hits: number; snippet: string }> = [];
            for (const session of sessions) {
              const title = session.title.toLowerCase();
              let hits = terms.filter((t) => title.includes(t)).length * 3;
              let snippet = "";
              let raw: string | null = null;
              try {
                raw = localStorage.getItem(`chatui:messages:${session.id}`);
              } catch {
                raw = null;
              }
              const lower = (raw ?? "").toLowerCase();
              for (const t of terms) {
                if (lower.includes(t)) hits += 1;
              }
              if (hits === 0) continue;
              const idx = lower.indexOf(terms.find((t) => lower.includes(t)) ?? "");
              if (idx >= 0) {
                snippet = (raw ?? "").slice(Math.max(0, idx - 120), idx + 240).replace(/\s+/g, " ");
              }
              matches.push({ session, hits, snippet });
            }
            if (matches.length === 0) {
              return `No chats matched "${query}".`;
            }
            matches.sort((a, b) => b.hits - a.hits);
            const top = matches.slice(0, 8);
            const lines = top.map(
              (m, i) =>
                `[${i + 1}] ${m.session.title}\n    id: ${m.session.id}` +
                (m.session.updatedAt ? `\n    last updated: ${m.session.updatedAt.slice(0, 10)}` : "") +
                (m.snippet ? `\n    …${m.snippet}…` : ""),
            );
            return (
              `Found ${matches.length} chat(s) for "${query}" (top ${top.length}). ` +
              `Call search_chats again with session_id to read one in full:\n\n${lines.join("\n\n")}`
            );
          },
          {
            name: "search_chats",
            description:
              "Search the user's past chat sessions by keyword, or read one chat in full by its id. " +
              "Use it when the user refers to an earlier conversation ('what did we decide about X?', " +
              "'find that chat about the apartment'). First search with a query to get session ids + " +
              "snippets, then call again with session_id to read the full conversation.",
            schema: z.object({
              query: z.string().optional().describe("Keywords to search chat titles and messages for."),
              session_id: z.string().optional().describe("Read this chat in full (from a previous search result)."),
            }),
          },
        ),
      );
    }

    if (enableFiles) {
      tools.push(
        tool(
          async ({ path, reason }: { path: string; reason?: string }) => {
            if (
              sandbox?.allowedDirectories &&
              !(await isPathAllowed(path, sandbox.allowedDirectories))
            ) {
              return sandboxDeniedMessage(sandbox.allowedDirectories);
            }
            const ctx = ctxFn();
            if (!ctx?.requestApproval) {
              return "Error: file access approval is not available in this context. Tell the user which file you wanted to read.";
            }
            const { approved } = await ctx.requestApproval({
              command: path,
              action: "read",
              source: "local_file",
              reason,
            });
            if (!approved) {
              return "The user denied reading this file. Do not retry it — ask what to do differently or continue without it.";
            }
            let result;
            try {
              result = await readLocalFile(path);
            } catch (err) {
              return `Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`;
            }
            if (result.kind === "binary") {
              return `${result.path} — binary file, ${result.size} bytes.\n${result.note ?? ""}`;
            }
            const header =
              result.kind === "pdf-text"
                ? `${result.path} (PDF, text extracted)`
                : result.kind === "directory"
                  ? `${result.path} (folder listing)`
                  : `${result.path} (${result.size} bytes)`;
            const parts = [header, result.content];
            if (result.truncated) {
              parts.push(
                `(truncated — the file is ${result.size} bytes; ask the user if you need a specific later section)`,
              );
            }
            if (result.note) parts.push(result.note);
            return parts.join("\n\n");
          },
          {
            name: "read_file",
            description:
              "Read a file from the user's Mac: text files return their content, PDFs return extracted text, " +
              "and a folder path returns its listing. Use it whenever the user points you at a local document " +
              "or folder (e.g. \"look at ~/Documents/…/report.pdf\"). The user approves each access." + allowedNote,
            schema: z.object({
              path: z
                .string()
                .describe("Absolute path of the file or folder on the user's Mac (~ works too)."),
              reason: z.string().optional().describe("One line: why you need this file."),
            }),
          },
        ),
        tool(
          async ({ path, content, reason }: { path: string; content: string; reason?: string }) => {
            if (
              sandbox?.allowedDirectories &&
              !(await isPathAllowed(path, sandbox.allowedDirectories))
            ) {
              return sandboxDeniedMessage(sandbox.allowedDirectories);
            }
            const ctx = ctxFn();
            if (!ctx?.requestApproval) {
              return "Error: file access approval is not available in this context. Tell the user which file you wanted to write.";
            }
            const { approved } = await ctx.requestApproval({
              command: path,
              action: "write",
              source: "local_file",
              reason,
            });
            if (!approved) {
              return "The user denied writing this file. Do not retry it — ask what to do differently or continue without it.";
            }
            try {
              const result = await writeLocalFile(path, content);
              return result.created
                ? `Created ${result.path} (${result.bytes} bytes).`
                : `Overwrote ${result.path} with the new content (${result.bytes} bytes).`;
            } catch (err) {
              return `Could not write ${path}: ${err instanceof Error ? err.message : String(err)}`;
            }
          },
          {
            name: "write_file",
            description:
              "Create or overwrite a file on the user's Mac with the given full content. The parent folder must " +
              "already exist. When editing an existing file, read it first, then write the complete new content. " +
              "The user approves each write." + allowedNote,
            schema: z.object({
              path: z
                .string()
                .describe("Absolute path of the file to create or overwrite (~ works too)."),
              content: z.string().describe("The complete new content of the file."),
              reason: z.string().optional().describe("One line: why you are writing this file."),
            }),
          },
        ),
      );
    }
  }

  if (profile === "setup") {
    tools.push(
      tool(
        async (input: {
          name: string;
          purpose: string;
          system_prompt: string;
          skills?: string[];
          connectors?: string[];
          terminal?: boolean;
          web?: boolean;
          files?: boolean;
          model?: string | null;
          read_chats?: boolean;
        }) => {
          const def = saveAgentDefinition({
            name: input.name.trim(),
            purpose: input.purpose.trim(),
            systemPrompt: input.system_prompt.trim(),
            skills: input.skills ?? [],
            connectors: input.connectors ?? [],
            capabilities: {
              terminal: input.terminal ?? false,
              web: input.web ?? true,
              files: input.files ?? false,
              computerUse: false,
            },
            model: input.model ?? undefined,
            readChats: input.read_chats ?? false,
          });
          // The agent's private on-disk workspace (~/Documents/chatUI/agents/<id>).
          void ensureAgentWorkspace(def.id).catch(() => {});
          return (
            `Agent "${def.name}" has been created and now appears in the sidebar under Agents. ` +
            `It runs sandboxed on-device: it gets a private workspace folder for its files, and terminal/file ` +
            `access stays off unless enabled. Confirm this to the user in one short sentence, recap what the ` +
            `agent does, and mention they can tune everything later in the agent's settings (gear menu) or by ` +
            `chatting with the agent itself.`
          );
        },
        {
          name: "create_agent",
          description:
            "Create the new agent from the agreed setup. Call exactly once, after the user confirmed " +
            "the name, purpose, skills, connectors, and capabilities.",
          schema: z.object({
            name: z.string().describe("Short agent name, e.g. 'Invoice Wrangler'."),
            purpose: z.string().describe("One-line description shown in the sidebar."),
            system_prompt: z
              .string()
              .describe("The agent's complete system prompt: identity, how it works, its limits."),
            skills: z.array(z.string()).optional().describe("Installed skill names to include."),
            connectors: z.array(z.string()).optional().describe("Connector catalog ids (e.g. 'zapier') to include."),
            terminal: z.boolean().optional().describe("Whether it may run shell commands / delegate coding (default false)."),
            web: z.boolean().optional().describe("Whether it may search/fetch the web (default true)."),
            files: z.boolean().optional().describe("Whether it may read/write local files via read_file/write_file, sandboxed to its workspace + user-granted folders, each access user-approved (default false)."),
            model: z.string().nullable().optional().describe("Model name this agent should always run on, or null for the app's default model."),
            read_chats: z.boolean().optional().describe("Whether it may search the user's past chats (default false)."),
          }),
        },
      ),
    );
  }

  if (webFetchEnabled) {
    tools.push(
      tool(
        async ({ query, max_results }: { query: string; max_results?: number }) => {
          const results = await webSearch(query, max_results ?? 5);
          if (results.length === 0) {
            return `No search results found for "${query}". Try rephrasing the query or use web_fetch on a specific URL.`;
          }
          const lines = results.map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n    URL: ${r.url}${r.snippet ? `\n    ${r.snippet}` : ""}`,
          );
          return `Found ${results.length} result(s) for "${query}":\n\n${lines.join("\n\n")}`;
        },
        {
          name: "web_search",
          description:
            "Search the web for information on a given query. Returns titles, URLs, and snippets for the top results. " +
            "Use this FIRST when you need current or external information, then use web_fetch to read the most promising URLs in full.",
          schema: z.object({
            query: z.string().describe("Search query to execute."),
            max_results: z
              .number()
              .optional()
              .describe("Maximum number of results to return (default: 5)."),
          }),
        },
      ),
      tool(
        async ({ url }: { url: string }) => runLegacyTool("web_fetch", { url }),
        {
          name: "web_fetch",
          description: "Fetch the content of a web page and return it as text. Use to read URLs, look things up online, and research sources.",
          schema: z.object({
            url: z.string().describe("The URL to fetch."),
          }),
        },
      ),
    );
  }

  return tools;
}
