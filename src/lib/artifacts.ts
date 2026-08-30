export interface Artifact {
  id: string;
  title: string;
  language: string;
  content: string;
  index: number;
}

const RENDERABLE = ["html", "svg", "markdown", "md"];
const MIN_LINES = 8;

function guessTitle(language: string, content: string): string {
  const langLabels: Record<string, string> = {
    html: "HTML",
    svg: "SVG",
    markdown: "Document",
    md: "Document",
    javascript: "Script",
    js: "Script",
    typescript: "Code",
    ts: "Code",
    tsx: "Component",
    jsx: "Component",
    python: "Script",
    py: "Script",
    rust: "Code",
    rs: "Code",
    go: "Code",
    sql: "Query",
    json: "JSON",
    css: "Styles",
  };
  // Try to find a title comment in the first few lines
  const firstLine = content.split("\n")[0] ?? "";
  const commentMatch = firstLine.match(/(?:#|\/\/|<!--)\s*(.+?)\s*(?:-->|$)/);
  if (commentMatch && commentMatch[1] && commentMatch[1].length < 60) return commentMatch[1];
  return langLabels[language] ?? "Artifact";
}

/** Extract artifacts (substantial/renderable code blocks) from message content. */
export function extractArtifacts(content: string): Artifact[] {
  if (!content) return [];
  const artifacts: Artifact[] = [];
  const seen = new Set<string>();
  let idx = 0;

  // Explicit <artifact title="..." lang="...">...</artifact> tags
  const tagRe = /<artifact\s+[^>]*title="([^"]*)"[^>]*lang="([^"]*)"[^>]*>([\s\S]*?)<\/artifact>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content)) !== null) {
    const body = m[3].trim();
    const key = `${m[2]}:${body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    artifacts.push({ id: `art-${idx}`, title: m[1] || "Artifact", language: m[2] || "text", content: body, index: idx++ });
  }

  // Fenced code blocks
  const fenceRe = /```(\w*)\n([\s\S]*?)```/g;
  while ((m = fenceRe.exec(content)) !== null) {
    const lang = (m[1] || "text").toLowerCase();
    const body = m[2];
    const lines = body.split("\n").length;
    if (RENDERABLE.includes(lang) || lines >= MIN_LINES) {
      const key = `${lang}:${body}`;
      if (seen.has(key)) continue;
      seen.add(key);
      artifacts.push({ id: `art-${idx}`, title: guessTitle(lang, body), language: lang, content: body, index: idx++ });
    }
  }

  return artifacts;
}

export function isPreviewable(language: string): boolean {
  return ["html", "svg", "markdown", "md"].includes(language.toLowerCase());
}

export function isRunnable(language: string): boolean {
  return ["python", "py"].includes(language.toLowerCase());
}

export function isReactPreviewable(language: string): boolean {
  return ["jsx", "tsx"].includes(language.toLowerCase());
}

// ─── Edit overrides ────────────────────────────────────────────────────────
// Artifacts are re-derived from message content on every render, so edits
// made in the panel are kept in a session-scoped store keyed by the original
// (as-extracted) artifact.

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

const overrides = new Map<string, string>();

function overrideKey(a: Pick<Artifact, "language" | "content">): string {
  return `${a.language}:${hashString(a.content)}`;
}

export function getArtifactOverride(
  a: Pick<Artifact, "language" | "content">,
): string | undefined {
  return overrides.get(overrideKey(a));
}

export function setArtifactOverride(
  a: Pick<Artifact, "language" | "content">,
  content: string,
): void {
  overrides.set(overrideKey(a), content);
}

export function clearArtifactOverride(
  a: Pick<Artifact, "language" | "content">,
): void {
  overrides.delete(overrideKey(a));
}

export function isArtifactModified(
  a: Pick<Artifact, "language" | "content">,
): boolean {
  const override = overrides.get(overrideKey(a));
  return override !== undefined && override !== a.content;
}
