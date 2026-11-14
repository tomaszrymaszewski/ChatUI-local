// Turns the previews stored on a tool-call activity (JSON arguments, text
// results) into labelled facts. The chat shows fields and text, never JSON:
// structure is parsed away, while code, file content and plain text keep
// their characters.

import type { ActivityItem } from "@/lib/agent/types";

/** One labelled fact: a single value, or nested facts for an object or list. */
export interface DetailRow {
  label: string;
  text?: string;
  rows?: DetailRow[];
}

/** Sections of a run result, as the run_python tool writes them. */
export interface RunOutput {
  workingDir?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: string;
  timedOut?: boolean;
  /** Text that sits outside the known sections. */
  other?: string;
}

/** What the tool-call panel shows for one activity. */
export interface ToolView {
  facts: DetailRow[];
  /** A command line, shown as written. */
  command?: string;
  /** Code, a script or file content that the call sent. Shown on request. */
  body?: { label: string; text: string };
  run?: RunOutput;
  resultRows?: DetailRow[];
  resultText?: string;
}

const MAX_ITEMS = 8;
const MAX_INLINE_ITEMS = 12;
const MAX_DEPTH = 3;
const APPEND_SUFFIX = " (append)";

const KEY_LABELS = new Map<string, string>([["cwd", "Folder"]]);
const ACRONYMS = new Map<string, string>([
  ["url", "URL"],
  ["urls", "URLs"],
  ["id", "ID"],
  ["ids", "IDs"],
  ["api", "API"],
  ["html", "HTML"],
  ["json", "JSON"],
  ["csv", "CSV"],
  ["pdf", "PDF"],
  ["sql", "SQL"],
]);

/** "max_results" becomes "Max results", "allowedDirectories" becomes "Allowed directories". */
export function humanizeKey(key: string): string {
  const known = KEY_LABELS.get(key);
  if (known) return known;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return key;
  return words
    .map((word, index) => {
      const acronym = ACRONYMS.get(word);
      if (acronym) return acronym;
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

/**
 * Parses JSON that a preview cap may have cut short. Returns undefined unless
 * the text starts like an object or array and can be read after repair.
 */
export function parseLooseJson(input: string): unknown {
  const text = input.trim().replace(/…$/, "").trimEnd();
  if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Cut off inside a value: close what is open, backing up to earlier
    // commas until the prefix reads as complete members.
  }
  for (const cut of [text.length, ...structuralCommas(text).reverse()]) {
    try {
      return JSON.parse(closeJson(text.slice(0, cut))) as unknown;
    } catch {
      // Try an earlier cut.
    }
  }
  return undefined;
}

/** Commas outside string literals, in order. */
function structuralCommas(text: string): number[] {
  const commas: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === ",") {
      commas.push(i);
    }
  }
  return commas;
}

/** Closes an unfinished JSON prefix: the open string, then every open object or array. */
function closeJson(prefix: string): string {
  const openers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of prefix) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      openers.push("}");
    } else if (char === "[") {
      openers.push("]");
    } else if (char === "}" || char === "]") {
      openers.pop();
    }
  }
  let body = prefix;
  if (inString) {
    if (escaped) body = body.slice(0, -1);
    body += '"';
  }
  return body + openers.reverse().join("");
}

function scalarText(value: unknown): string | undefined {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    return value.trim().length > 0 ? value.replace(/\s+$/, "") : "—";
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return undefined;
}

function rowFor(label: string, value: unknown, depth: number): DetailRow {
  const text = scalarText(value);
  if (text !== undefined) return { label, text };
  if (Array.isArray(value) && value.every((item) => scalarText(item) !== undefined)) {
    if (value.length === 0) return { label, text: "—" };
    const shown = value.slice(0, MAX_INLINE_ITEMS).map((item) => scalarText(item) ?? "—");
    const extra =
      value.length > MAX_INLINE_ITEMS ? `, +${value.length - MAX_INLINE_ITEMS} more` : "";
    return { label, text: `${shown.join(", ")}${extra}` };
  }
  if (depth >= MAX_DEPTH) {
    const count = Array.isArray(value) ? value.length : Object.keys(value as object).length;
    return { label, text: Array.isArray(value) ? `${count} items` : `${count} fields` };
  }
  const rows = toDetailRows(value, depth + 1);
  return rows.length > 0 ? { label, rows } : { label, text: "—" };
}

/** Facts for a parsed JSON value: an object's entries, or a list's items. */
export function toDetailRows(value: unknown, depth = 0): DetailRow[] {
  if (Array.isArray(value)) {
    const rows = value
      .slice(0, MAX_ITEMS)
      .map((item, index) => rowFor(`Item ${index + 1}`, item, depth));
    if (value.length > MAX_ITEMS) {
      rows.push({ label: "More", text: `${value.length - MAX_ITEMS} not shown` });
    }
    return rows;
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).map(([key, child]) => rowFor(humanizeKey(key), child, depth));
  }
  const text = scalarText(value);
  return text === undefined ? [] : [{ label: "Value", text }];
}

/**
 * Reads the sections of a run result: "stdout:", "stderr:", "exit code: N",
 * "(working directory: …)" and "(execution timed out)". Undefined when the
 * text has none of them, so plain results stay plain.
 */
export function parseRunOutput(text: string): RunOutput | undefined {
  const out: RunOutput = {};
  let recognized = false;
  let open: "stdout" | "stderr" | "other" | null = null;
  const append = (key: "stdout" | "stderr" | "other", block: string) => {
    const previous = out[key];
    out[key] = previous === undefined ? block : `${previous}\n\n${block}`;
  };
  for (const block of text.split("\n\n")) {
    const trimmed = block.trim();
    const exit = /^exit code:\s*(.+)$/.exec(trimmed);
    const folder = /^\(working directory: (.+)\)$/.exec(trimmed);
    if (block.startsWith("stdout:")) {
      recognized = true;
      open = "stdout";
      append("stdout", block.slice("stdout:".length).replace(/^\n/, ""));
    } else if (block.startsWith("stderr:")) {
      recognized = true;
      open = "stderr";
      append("stderr", block.slice("stderr:".length).replace(/^\n/, ""));
    } else if (exit) {
      recognized = true;
      open = null;
      out.exitCode = exit[1].trim();
    } else if (folder) {
      recognized = true;
      open = null;
      out.workingDir = folder[1].trim();
    } else if (trimmed === "(execution timed out)") {
      recognized = true;
      open = null;
      out.timedOut = true;
    } else {
      append(open ?? "other", block);
    }
  }
  return recognized ? out : undefined;
}

/** Text before the first blank line (the header) and everything after it (the body). */
function splitPreview(preview: string): { head: string; body?: string } {
  const at = preview.indexOf("\n\n");
  if (at < 0) return { head: preview };
  return { head: preview.slice(0, at), body: preview.slice(at + 2) };
}

function pathFacts(path: string): DetailRow[] {
  const trimmed = path.trim().replace(/\/+$/, "") || path.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return [{ label: "File", text: trimmed }];
  const folder = slash === 0 ? "/" : trimmed.slice(0, slash);
  return [
    { label: "File", text: trimmed.slice(slash + 1) },
    { label: "Folder", text: folder },
  ];
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Everything the tool-call panel shows for one activity. */
export function buildToolView(item: ActivityItem): ToolView {
  const preview = item.argsPreview ?? "";
  const view: ToolView = { facts: [] };

  if (item.name === "run_python" || item.name === "run_node") {
    if (preview) view.body = { label: "Code", text: preview };
  } else if (item.name === "run_applescript") {
    if (preview) view.body = { label: "Script", text: preview };
  } else if (item.name === "run_command") {
    if (preview) view.command = preview;
  } else if (item.name === "write_local_file" && preview) {
    const { head, body } = splitPreview(preview);
    const append = head.endsWith(APPEND_SUFFIX);
    view.facts = pathFacts(append ? head.slice(0, -APPEND_SUFFIX.length) : head);
    if (append) view.facts.push({ label: "Mode", text: "Append" });
    const bytes = item.file?.bytes;
    if (bytes !== undefined) view.facts.push({ label: "Size", text: formatByteCount(bytes) });
    if (body) view.body = { label: "Content", text: body };
  } else if (item.name === "create_artifact" && preview) {
    const { head, body } = splitPreview(preview);
    const match = /^(.*) \(([^()]*)\)$/s.exec(head);
    if (match) {
      view.facts = [
        { label: "Title", text: match[1] },
        { label: "Language", text: match[2] || "—" },
      ];
    }
    if (body) view.body = { label: "Content", text: body };
  } else if (item.name === "read_local_file" && preview) {
    view.facts = pathFacts(preview);
  } else if (preview) {
    const parsed = parseLooseJson(preview);
    if (parsed !== undefined) view.facts = toDetailRows(parsed);
    else view.body = { label: "Input", text: preview };
  }

  const detail = item.detail?.trim() ?? "";
  if (detail) {
    const run = parseRunOutput(detail);
    if (run) {
      view.run = run;
    } else if (detail.startsWith("{") || detail.startsWith("[")) {
      const parsed = parseLooseJson(detail);
      if (parsed !== undefined) view.resultRows = toDetailRows(parsed);
    } else {
      view.resultText = item.detail;
    }
  }
  return view;
}
