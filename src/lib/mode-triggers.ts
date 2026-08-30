/**
 * Detects a chat mode from the first word(s) of the composer text.
 *
 * - "discuss ..."        → "council"
 * - "teach me ..."       → "learn"
 * - "i want to learn ..." → "learn"
 * - "research ..."       → "research"
 *
 * Matching is case-insensitive and tolerates leading whitespace. The trigger
 * word must be followed by a word boundary (space, tab, newline) — this
 * prevents "discussion" or "researcher" from triggering.
 *
 * Returns null when no trigger is detected.
 */

export type DetectedMode = "council" | "learn" | "research";

export function detectModeTrigger(text: string): DetectedMode | null {
  const trimmed = text.replace(/^\s+/, "");
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (/^discuss\b/.test(lower)) return "council";
  if (/^teach me\b/.test(lower)) return "learn";
  if (/^i want to learn\b/.test(lower)) return "learn";
  if (/^research\b/.test(lower)) return "research";

  return null;
}
