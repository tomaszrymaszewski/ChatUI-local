import type { ProviderModel } from "@/types";

/**
 * Turn a raw model ID into a human-friendly display name.
 *
 *   accounts/fireworks/models/glm-5p3                  → Glm 5.3
 *   accounts/fireworks/models/deepseek-v4-pro-0813     → Deepseek V4 Pro
 *   claude-haiku-4-5                                   → Claude Haiku 4.5
 *   google/gemini-flash-lite-latest                    → Gemini Flash Lite
 *   Qwen/Qwen3.5-9B                                    → Qwen 3.5 9B
 *
 * Manually set display names (that differ from the raw ID) always win —
 * see modelLabel().
 */

const REGISTRY_PREFIXES = [
  "accounts/fireworks/models/",
  "accounts/fireworks/routers/",
];

/** Tokens that look like dates or build stamps: 0813, 20250929, 2024-08-06. */
function isDateToken(token: string): boolean {
  return /^\d{4}$/.test(token) || /^\d{6,}$/.test(token);
}

function isYearToken(token: string): boolean {
  return /^\d{4}$/.test(token);
}

function isDayMonthToken(token: string): boolean {
  return /^\d{1,2}$/.test(token);
}

/** Strip trailing date-like tokens: 0813 · 20250929 · 2024-08-06 · 07-31. */
function stripTrailingDates(tokens: string[]): string[] {
  const out = [...tokens];
  // YYYY-MM-DD (three trailing tokens: 4-digit year, 1-2 digit month, 1-2 digit day)
  if (
    out.length >= 3 &&
    isYearToken(out[out.length - 3]) &&
    isDayMonthToken(out[out.length - 2]) &&
    isDayMonthToken(out[out.length - 1])
  ) {
    out.splice(out.length - 3, 3);
  }
  // MMDD / YYYYMMDD style stamps
  while (out.length > 0 && isDateToken(out[out.length - 1])) {
    out.pop();
  }
  return out;
}

/** Split a token at the first letter→digit boundary when the letter part is
 *  2+ chars long: qwen3.5 → ["qwen","3.5"], gemma4 → ["gemma","4"].
 *  Short leading letters stay glued: a12b, k2p7, 70b, 4o are kept whole. */
function splitLeadingLetters(token: string): string[] {
  const m = token.match(/^([a-zA-Z]{2,})(\d.*)$/);
  if (m) return [m[1], m[2]];
  return [token];
}

/** 5p3 → 5.3, v3p1 → v3.1 (Fireworks' p = decimal point). */
function expandDecimalPoint(token: string): string {
  return token.replace(/^([a-zA-Z]?\d+)p(\d+)$/, "$1.$2");
}

function titleCase(token: string): string {
  let seenLetter = false;
  let result = "";
  for (const ch of token) {
    if (/[a-zA-Z]/.test(ch)) {
      result += seenLetter ? ch.toLowerCase() : ch.toUpperCase();
      seenLetter = true;
    } else {
      result += ch;
    }
  }
  return result;
}

/** Merge adjacent single-digit tokens into a version: ["4","5"] → "4.5". */
function mergeSingleDigits(tokens: string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /^\d$/.test(prev) && /^\d$/.test(token)) {
      out[out.length - 1] = `${prev}.${token}`;
    } else {
      out.push(token);
    }
  }
  return out;
}

export function formatModelName(modelId: string): string {
  let id = modelId.trim();
  if (!id) return modelId;

  for (const prefix of REGISTRY_PREFIXES) {
    if (id.startsWith(prefix)) {
      id = id.slice(prefix.length);
      break;
    }
  }
  // Vendor namespace: openrouter (google/gemini-…), deepinfra (Qwen/Qwen3.5-…)
  if (id.includes("/")) {
    id = id.split("/").pop() ?? id;
  }
  // Openrouter alias marker: ~anthropic/claude-haiku-latest
  id = id.replace(/^~+/, "");

  let tokens = id.split(/[-_:]/).filter(Boolean);
  tokens = stripTrailingDates(tokens);

  // Drop a trailing "latest" tag (gemini-flash-lite-latest → Gemini Flash Lite)
  if (tokens.length > 1 && tokens[tokens.length - 1].toLowerCase() === "latest") {
    tokens.pop();
  }

  tokens = tokens.flatMap(splitLeadingLetters).flatMap(expandDecimalPoint);
  tokens = mergeSingleDigits(tokens);

  const name = tokens.map(titleCase).join(" ").trim();
  return name || modelId;
}

/**
 * Best display label for a stored model: a manually set display name (that
 * differs from the raw ID) wins; otherwise the ID is formatted. Models saved
 * before formatting existed may have the raw ID stored as displayName —
 * those are treated as unset.
 */
export function modelLabel(model: Pick<ProviderModel, "name" | "displayName">): string {
  if (model.displayName && model.displayName !== model.name) {
    return model.displayName;
  }
  return formatModelName(model.name);
}
