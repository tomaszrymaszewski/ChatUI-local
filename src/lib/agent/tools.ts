import { z } from "zod";
import { tool, type StructuredTool } from "langchain";
import { executeTool } from "@/lib/tools";
import { runPython } from "@/lib/run-python";
import { getRunContext, type RunContext } from "@/lib/agent/run-context";
import { webSearch } from "@/lib/agent/web-search";
import { CURATED_SKILLS, listBundledSkills, listInstalledSkills } from "@/lib/skills-library";
import { MCP_CATALOG } from "@/lib/mcp-catalog";
import { getMcpEntries } from "@/lib/opencode-config";

let artifactCounter = 0;

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
): StructuredTool[] {
  const ctxFn = getContext ?? getRunContext;
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
          type: "text" | "textarea" | "number" | "select" | "checkbox";
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
          "needs specific parameters (e.g. research topic + depth, code task spec, document outline). " +
          "The composer transforms into the form; the user can always switch back to free text.",
        schema: z.object({
          title: z.string().describe("Form title, e.g. 'Deep research setup'."),
          description: z.string().optional().describe("One-line explanation of why the form is needed."),
          submit_label: z.string().optional().describe("Submit button label, e.g. 'Start research'."),
          fields: z.array(
            z.object({
              name: z.string(),
              label: z.string(),
              type: z.enum(["text", "textarea", "number", "select", "checkbox"]),
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
        kind: "skill" | "connector" | "mode";
        target: string;
        title: string;
        reason: string;
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
          },
        });
        return `Suggestion "${input.title}" has been shown to the user as an actionable card. Continue your reply naturally — do not repeat the suggestion in text.`;
      },
      {
        name: "suggest",
        description:
          "Show the user an actionable suggestion card in place of the text composer. " +
          "Use after search_skills or search_connectors finds something useful that isn't " +
          "installed/connected yet, or when the user's request would benefit from a mode " +
          "(research, discuss, learn). The card has a button to install/connect/enable " +
          "and a dismiss option. Call this instead of just mentioning the suggestion in prose.",
        schema: z.object({
          kind: z.enum(["skill", "connector", "mode"]),
          target: z.string().describe(
            "For skill: the skill name (e.g. 'docx'). For connector: the catalog id (e.g. 'zapier'). For mode: 'research', 'council', or 'learn'.",
          ),
          title: z.string().describe("Short headline for the card, e.g. 'Install Word Documents skill'."),
          reason: z.string().describe("1-2 sentences explaining why this is being suggested."),
        }),
      },
    ),
  ];

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
