/**
 * Post-run suggestion cards — a separate system from the agent's reply.
 *
 * The agent used to emit suggestion cards itself (a `suggest` tool the model
 * called mid-run), which put card logic inside every model call and let the
 * model interrupt its answer to advertise. Cards are now generated once the
 * message has ended: one small auxiliary model call over the conversation
 * transcript plus the compact capability catalogs (not-installed skills,
 * not-connected connectors). It decides whether a card would help the user's
 * next step — install a skill, connect a connector, or switch on a special
 * chat mode — and ChatView shows the card via the agent controller.
 */

import type { Provider } from "@/types";
import type { SuggestionRequest } from "@/lib/agent/types";
import { getProviderApiKey, type FollowUpTranscriptEntry } from "@/lib/llm";
import { completeAnthropicMessage, isAnthropicProvider } from "@/lib/providers/anthropic";
import { listAllCatalogSkills } from "@/lib/skill-registry";
import { listInstalledSkills } from "@/lib/skills-library";
import { listAllConnectors } from "@/lib/mcp-catalog";
import { isConnected } from "@/lib/mcp-store";
import { hasToken, readMcpAuth } from "@/lib/mcp-auth";

export interface SuggestionSkillOption {
  name: string;
  title: string;
  description: string;
}

export interface SuggestionConnectorOption {
  id: string;
  name: string;
  tagline: string;
}

/** Special chat modes a card can switch on (task mode no longer exists). */
export const SUGGESTION_MODES = ["research", "learn", "council"] as const;
export type SuggestionMode = (typeof SUGGESTION_MODES)[number];

/** Recent exchanges folded into the suggestion prompt (capped in size). */
const SUGGESTION_TAKE_MESSAGES = 8;
const SUGGESTION_TAKE_CHARS = 500;
/** Catalog digests stay bounded even when the registry grows. */
const MAX_SKILL_OPTIONS = 40;
const MAX_CONNECTOR_OPTIONS = 40;
const OPTION_DESCRIPTION_CHARS = 140;

function clip(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

/**
 * The prompt for the post-run suggestion call. Pure (tested) — the network
 * call lives in generatePostRunSuggestion.
 */
export function buildPostRunSuggestionPrompt(opts: {
  transcript: FollowUpTranscriptEntry[];
  skills: SuggestionSkillOption[];
  connectors: SuggestionConnectorOption[];
  allowModes: boolean;
}): { system: string; user: string } {
  const modeList = SUGGESTION_MODES.join(", ");
  const system =
    "You review a finished assistant reply and decide whether to offer the user ONE capability " +
    "card for their next step. Kinds: " +
    "\"skill\" (install a catalog skill the task clearly needs — pick only from the list), " +
    "\"connector\" (connect an external app the user wants to use — pick only from the list)" +
    (opts.allowModes
      ? `, or "mode" (switch on a special chat mode when the conversation clearly calls for it: ` +
        "research = deep multi-round cited research, learn = structured tutoring, council = a panel deliberates a decision)"
      : "") +
    ". Rules: most replies need NO card — only suggest when it is clearly useful for what the " +
    "user is doing next; the lists contain only things the user does NOT have yet. Output ONLY " +
    'JSON: {"kind":"skill"|"connector"' +
    (opts.allowModes ? '|"mode"' : "") +
    ',"target":"<exact name/id/mode from the lists>","title":"<short headline>","reason":"<one sentence why>"} ' +
    'or {"kind":"none"}.';

  const lines = opts.transcript
    .filter((m) => m.content.trim())
    .slice(-SUGGESTION_TAKE_MESSAGES)
    .map(
      (m) =>
        `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content.trim().slice(0, SUGGESTION_TAKE_CHARS)}`,
    );

  const sections: string[] = ["Conversation:", ...lines];
  if (opts.skills.length > 0) {
    sections.push(
      "Not-installed skills (name — title: description):",
      ...opts.skills.map(
        (s) => `- ${s.name} — ${s.title}: ${clip(s.description, OPTION_DESCRIPTION_CHARS)}`,
      ),
    );
  }
  if (opts.connectors.length > 0) {
    sections.push(
      "Not-connected connectors (id — name: what it does):",
      ...opts.connectors.map((c) => `- ${c.id} — ${c.name}: ${clip(c.tagline, OPTION_DESCRIPTION_CHARS)}`),
    );
  }
  if (opts.allowModes) {
    sections.push(`Modes: ${modeList}`);
  }
  return { system, user: sections.join("\n") };
}

/**
 * Parse the model's JSON verdict into a validated SuggestionRequest. Targets
 * must come from the provided catalogs (or the mode whitelist) — anything
 * else (hallucinated names, wrong kind, "none") returns null. Pure (tested).
 */
export function parsePostRunSuggestion(
  raw: string,
  opts: {
    skills: SuggestionSkillOption[];
    connectors: SuggestionConnectorOption[];
    allowModes: boolean;
  },
): SuggestionRequest | null {
  const text = raw.trim();
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const rec = parsed as { kind?: unknown; target?: unknown; title?: unknown; reason?: unknown };
  if (typeof rec.kind !== "string" || typeof rec.target !== "string") return null;
  const title = typeof rec.title === "string" ? rec.title.trim().slice(0, 80) : "";
  const reason = typeof rec.reason === "string" ? rec.reason.trim().slice(0, 240) : "";

  if (rec.kind === "skill") {
    const skill = opts.skills.find((s) => s.name === rec.target);
    if (!skill) return null;
    return {
      kind: "skill",
      target: skill.name,
      title: title || `Install the ${skill.title} skill`,
      reason: reason || `The "${skill.title}" skill matches what this conversation is about.`,
    };
  }
  if (rec.kind === "connector") {
    const connector = opts.connectors.find((c) => c.id === rec.target);
    if (!connector) return null;
    return {
      kind: "connector",
      target: connector.id,
      title: title || `Connect ${connector.name}`,
      reason: reason || connector.tagline,
    };
  }
  if (rec.kind === "mode" && opts.allowModes) {
    if (!(SUGGESTION_MODES as readonly string[]).includes(rec.target)) return null;
    const mode = rec.target as SuggestionMode;
    return {
      kind: "mode",
      target: mode,
      title: title || `Turn on ${mode} mode`,
      reason: reason || `This conversation would benefit from ${mode} mode.`,
    };
  }
  return null;
}

/**
 * The user's capability gaps, ready for the suggestion prompt: catalog
 * skills that are not installed and catalog connectors that are not
 * connected. Best-effort — unavailable sources contribute nothing.
 */
export async function collectSuggestionOptions(): Promise<{
  skills: SuggestionSkillOption[];
  connectors: SuggestionConnectorOption[];
}> {
  const [catalog, installed, connectors] = await Promise.all([
    listAllCatalogSkills().catch(() => []),
    listInstalledSkills("global").catch(() => []),
    listAllConnectors().catch(() => []),
  ]);
  const installedNames = new Set(installed.map((s) => s.name));
  const skills = catalog
    .filter((s) => !installedNames.has(s.name))
    .slice(0, MAX_SKILL_OPTIONS)
    .map((s) => ({ name: s.name, title: s.title, description: s.description }));

  const authData = await readMcpAuth().catch(() => ({}));
  const connectorsOut = connectors
    .filter((c) => {
      // OAuth entries only count as connected with a stored token.
      const connected =
        c.auth === "oauth" ? isConnected(c.id) && hasToken(authData, c.id) : isConnected(c.id);
      return !connected;
    })
    .slice(0, MAX_CONNECTOR_OPTIONS)
    .map((c) => ({ id: c.id, name: c.name, tagline: c.tagline }));
  return { skills, connectors: connectorsOut };
}

/**
 * One post-run model call deciding the user's next capability card. Returns
 * null when nothing is worth suggesting, the catalogs are empty, or any
 * failure occurs — callers simply show no card.
 */
export async function generatePostRunSuggestion(opts: {
  provider: Provider;
  model: string;
  transcript: FollowUpTranscriptEntry[];
  skills: SuggestionSkillOption[];
  connectors: SuggestionConnectorOption[];
  allowModes: boolean;
}): Promise<SuggestionRequest | null> {
  if (opts.skills.length === 0 && opts.connectors.length === 0 && !opts.allowModes) {
    return null;
  }
  let apiKey: string;
  try {
    apiKey = await getProviderApiKey(opts.provider.id);
  } catch {
    return null;
  }
  const { system, user } = buildPostRunSuggestionPrompt(opts);
  const parse = (raw: string) =>
    parsePostRunSuggestion(raw, {
      skills: opts.skills,
      connectors: opts.connectors,
      allowModes: opts.allowModes,
    });
  const baseUrl = opts.provider.baseUrl.replace(/\/$/, "");
  if (isAnthropicProvider(opts.provider.baseUrl)) {
    try {
      const raw = await completeAnthropicMessage(
        apiKey,
        baseUrl,
        opts.model,
        [{ role: "system", content: system }, { role: "user", content: user }],
        400,
      );
      return parse(raw);
    } catch {
      return null;
    }
  }
  const url = `${baseUrl}/chat/completions`;
  const baseBody: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  // Same max-tokens dance as the other post-run helpers (titles, ghosts):
  // newer reasoning models require max_completion_tokens, older endpoints
  // only know max_tokens.
  const tryRequest = async (maxField: string): Promise<Response> => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...baseBody, [maxField]: 400 }),
    });
  };
  let response: Response;
  try {
    response = await tryRequest("max_completion_tokens");
    if (!response.ok && response.status === 400) {
      response = await tryRequest("max_tokens");
    }
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const data = await response.json();
    const raw =
      data.choices?.[0]?.message?.content?.trim() ||
      data.choices?.[0]?.message?.reasoning_content?.trim() ||
      "";
    return parse(raw);
  } catch {
    return null;
  }
}
