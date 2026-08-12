import { invoke } from "@tauri-apps/api/core";

export interface SkillCatalogEntry {
  name: string;
  description: string;
  source: "bundled" | "anthropics";
}

export interface InstalledSkill {
  name: string;
  scope: "global" | "project";
  path: string;
}

// ─── Curated skill catalog (official / top-quality sources) ─────────────────

export type SkillCategory =
  | "Documents"
  | "Design & Creative"
  | "Writing"
  | "Coding"
  | "Workflow"
  | "Built-in";

export interface CuratedSkill {
  /** Folder name used on disk (`<skillsDir>/<name>/SKILL.md`). */
  name: string;
  /** Friendly display name. */
  title: string;
  /** Plain-English description for non-technical users. */
  description: string;
  category: SkillCategory;
  /** "Official — Anthropic" / "Official — Vercel" / "Community — Matt Pocock" etc. */
  sourceLabel: string;
  /** GitHub repo "owner/repo" to fetch from. */
  repo: string;
  /** Directory within the repo containing the skill files. */
  dir: string;
}

export const CURATED_SKILLS: CuratedSkill[] = [
  // ── Documents (official — Anthropic, power Claude's file features) ──
  { name: "pdf", title: "PDF Documents", description: "Create and edit polished PDF files — reports, forms, and handouts.", category: "Documents", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/pdf" },
  { name: "docx", title: "Word Documents", description: "Create and edit Microsoft Word (.docx) files with proper formatting.", category: "Documents", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/docx" },
  { name: "xlsx", title: "Spreadsheets", description: "Create and edit Excel (.xlsx) spreadsheets with formulas and charts.", category: "Documents", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/xlsx" },
  { name: "pptx", title: "Presentations", description: "Create and edit PowerPoint (.pptx) slide decks that look great.", category: "Documents", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/pptx" },

  // ── Design & Creative ──
  { name: "frontend-design", title: "Frontend Design", description: "Design beautiful, polished web interfaces with great taste.", category: "Design & Creative", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/frontend-design" },
  { name: "canvas-design", title: "Canvas Design", description: "Create visual designs and artwork on an HTML canvas.", category: "Design & Creative", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/canvas-design" },
  { name: "brand-guidelines", title: "Brand Guidelines", description: "Keep everything on-brand — colors, fonts, tone, and logo rules.", category: "Design & Creative", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/brand-guidelines" },
  { name: "theme-factory", title: "Theme Factory", description: "Build cohesive color themes and design systems for apps.", category: "Design & Creative", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/theme-factory" },
  { name: "algorithmic-art", title: "Algorithmic Art", description: "Generate generative art and creative visuals with code.", category: "Design & Creative", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/algorithmic-art" },

  // ── Writing ──
  { name: "internal-comms", title: "Internal Communications", description: "Write clear company updates, announcements, and team messages.", category: "Writing", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/internal-comms" },
  { name: "doc-coauthoring", title: "Document Co-authoring", description: "Collaboratively draft and refine long-form documents.", category: "Writing", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/doc-coauthoring" },

  // ── Coding ──
  { name: "webapp-testing", title: "Web App Testing", description: "Reliably test web apps with Playwright — clicks, forms, and flows.", category: "Coding", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/webapp-testing" },
  { name: "mcp-builder", title: "MCP Builder", description: "Build your own MCP servers to connect new apps to the AI.", category: "Coding", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/mcp-builder" },
  { name: "web-artifacts-builder", title: "Web Artifacts", description: "Build interactive, self-contained web widgets and tools.", category: "Coding", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/web-artifacts-builder" },
  { name: "skill-creator", title: "Skill Creator", description: "Create your own custom skills to teach the AI new tasks.", category: "Coding", sourceLabel: "Official — Anthropic", repo: "anthropics/skills", dir: "skills/skill-creator" },
  { name: "react-best-practices", title: "React Best Practices", description: "Write modern React the way the Vercel team recommends.", category: "Coding", sourceLabel: "Official — Vercel", repo: "vercel-labs/agent-skills", dir: "skills/react-best-practices" },
  { name: "web-design-guidelines", title: "Web Design Guidelines", description: "Follow proven rules for clean, usable web design.", category: "Coding", sourceLabel: "Official — Vercel", repo: "vercel-labs/agent-skills", dir: "skills/web-design-guidelines" },
  { name: "supabase-postgres-best-practices", title: "Supabase & Postgres", description: "Use Supabase and Postgres the right way — schema, RLS, performance.", category: "Coding", sourceLabel: "Official — Supabase", repo: "supabase/agent-skills", dir: "skills/supabase-postgres-best-practices" },

  // ── Workflow (top community, vetted via skills.sh leaderboard) ──
  { name: "brainstorming", title: "Brainstorming", description: "Explore ideas from fresh angles and solve problems creatively.", category: "Workflow", sourceLabel: "Community — obra/superpowers", repo: "obra/superpowers", dir: "skills/brainstorming" },
  { name: "systematic-debugging", title: "Systematic Debugging", description: "Track down bugs methodically instead of guessing.", category: "Workflow", sourceLabel: "Community — obra/superpowers", repo: "obra/superpowers", dir: "skills/systematic-debugging" },
  { name: "test-driven-development", title: "Test-Driven Development", description: "Write tests first, then code — for reliable results.", category: "Workflow", sourceLabel: "Community — obra/superpowers", repo: "obra/superpowers", dir: "skills/test-driven-development" },
  { name: "code-review", title: "Code Review", description: "Review code for quality, bugs, and improvements.", category: "Workflow", sourceLabel: "Community — Matt Pocock", repo: "mattpocock/skills", dir: "skills/engineering/code-review" },
  { name: "research", title: "Research", description: "Research topics online, cross-check facts, and cite sources.", category: "Workflow", sourceLabel: "Community — Matt Pocock", repo: "mattpocock/skills", dir: "skills/engineering/research" },
];

export const SKILL_CATEGORIES: SkillCategory[] = [
  "Documents",
  "Design & Creative",
  "Writing",
  "Coding",
  "Workflow",
  "Built-in",
];

export function listCuratedSkills(): CuratedSkill[] {
  return CURATED_SKILLS;
}

// ─── Bundled skills (authored, always available offline) ───────────────────

const BUNDLED_SKILLS: Array<{ name: string; description: string; content: string }> = [
  {
    name: "fastapi",
    description: "Build FastAPI applications in Python — routes, Pydantic models, dependency injection, async DB, testing.",
    content: `---
name: fastapi
description: Build FastAPI applications in Python — routes, Pydantic models, dependency injection, async DB, testing.
---
## FastAPI Development Guide

### Project structure
- \`app/main.py\` — app instance + router includes
- \`app/routers/\` — route modules
- \`app/models.py\` — Pydantic schemas
- \`app/db.py\` — database session (SQLAlchemy async)

### Conventions
- Use \`async def\` for routes that do I/O.
- Validate with Pydantic v2 models; use \`response_model\` for output.
- Use dependency injection for DB sessions and auth.
- Prefer \`HTTPException\` with correct status codes.
- Run with \`uvicorn app.main:app --reload\`.

### Testing
- Use \`httpx.AsyncClient\` + \`pytest-asyncio\`.
- Test via \`ASGITransport(app=app)\`.
`,
  },
  {
    name: "nextjs",
    description: "Build Next.js apps — App Router, server components, route handlers, data fetching, deployment.",
    content: `---
name: nextjs
description: Build Next.js apps — App Router, server components, route handlers, data fetching, deployment.
---
## Next.js Development Guide

### App Router conventions
- \`app/page.tsx\` — route component (default server component).
- \`app/layout.tsx\` — root layout.
- \`app/api/<route>/route.ts\` — route handlers (GET, POST, etc.).
- Use \`'use client'\` only when you need interactivity, hooks, or browser APIs.

### Data fetching
- Server components can be async and fetch directly.
- Use \`revalidatePath\` / \`revalidateTag\` for on-demand ISR.
- Prefer server actions for mutations.

### Styling
- Tailwind CSS by default. Use the \`cn()\` helper for conditional classes.

### Deployment
- \`next build\` then deploy to Vercel or \`opennextjs-cloudflare\` for Cloudflare.
`,
  },
  {
    name: "frontend-ui",
    description: "Implement polished frontend UI — component composition, responsive layout, accessibility, design systems.",
    content: `---
name: frontend-ui
description: Implement polished frontend UI — component composition, responsive layout, accessibility, design systems.
---
## Frontend UI Guide

### Principles
- Compose small, single-purpose components.
- Use semantic HTML (button, nav, main, section) for accessibility.
- Ensure keyboard navigation works (focus rings, tab order).
- Design mobile-first; use Tailwind responsive prefixes (sm:, md:, lg:).

### Patterns
- Dialogs: trap focus, restore focus on close, close on Escape.
- Forms: label every input, show validation inline, disable submit while loading.
- Lists: virtualize long lists; use keys that are stable IDs.
- Loading: skeletons match final layout; avoid layout shift.

### Polish
- Respect \`prefers-color-scheme\` / theme tokens.
- Use transitions for state changes (opacity, transform) — keep under 200ms.
- Empty states and error states are first-class, not afterthoughts.
`,
  },
  {
    name: "research",
    description: "Research topics online — search, read sources, cross-check facts, cite URLs, synthesize findings.",
    content: `---
name: research
description: Research topics online — search, read sources, cross-check facts, cite URLs, synthesize findings.
---
## Research Workflow

1. Break the question into sub-queries.
2. Use web_fetch to read authoritative sources (official docs, papers, reputable sites).
3. Cross-check claims across at least two independent sources.
4. Note publication dates; prefer recent information.
5. Cite every claim with a URL.
6. Synthesize a structured answer: summary, key findings, sources.
`,
  },
];

export function listBundledSkills(): SkillCatalogEntry[] {
  return BUNDLED_SKILLS.map((s) => ({ name: s.name, description: s.description, source: "bundled" }));
}

export function getBundledSkillContent(name: string): string | undefined {
  return BUNDLED_SKILLS.find((s) => s.name === name)?.content;
}

// ─── Anthropic skills repo (fetched from GitHub at runtime) ────────────────

interface GitTree {
  tree: Array<{ path: string; type: string }>;
}

let anthropicTreeCache: SkillCatalogEntry[] | null = null;

export async function listAnthropicSkills(): Promise<SkillCatalogEntry[]> {
  if (anthropicTreeCache) return anthropicTreeCache;
  try {
    const res = await fetch("https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1");
    if (!res.ok) return [];
    const data = (await res.json()) as GitTree;
    const skills: SkillCatalogEntry[] = [];
    for (const item of data.tree) {
      const m = item.path.match(/^skills\/([^/]+)\/SKILL\.md$/);
      if (m) {
        skills.push({ name: m[1], description: "Anthropic skill — install to view full content.", source: "anthropics" });
      }
    }
    anthropicTreeCache = skills;
    return skills;
  } catch {
    return [];
  }
}

// ─── Install / delete / list installed ─────────────────────────────────────

async function globalSkillsDir(): Promise<string> {
  const home = await invoke<string>("get_home_dir");
  return `${home}/.config/opencode/skills`;
}

function projectSkillsDir(projectDir: string): string {
  return `${projectDir}/.opencode/skills`;
}

export async function installBundledSkill(name: string, scope: "global" | "project", projectDir?: string): Promise<void> {
  const content = getBundledSkillContent(name);
  if (!content) throw new Error(`Unknown bundled skill: ${name}`);
  const base = scope === "global" ? await globalSkillsDir() : projectSkillsDir(projectDir!);
  await invoke("write_text_file", { path: `${base}/${name}/SKILL.md`, content });
}

export async function installAnthropicSkill(name: string, scope: "global" | "project", projectDir?: string): Promise<void> {
  const base = scope === "global" ? await globalSkillsDir() : projectSkillsDir(projectDir!);
  // Fetch the tree to find all files for this skill
  const res = await fetch("https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1");
  if (!res.ok) throw new Error("Failed to fetch skill file list");
  const data = (await res.json()) as GitTree;
  const files = data.tree.filter((t) => t.path.startsWith(`skills/${name}/`) && t.type === "blob");
  for (const file of files) {
    const raw = await fetch(`https://raw.githubusercontent.com/anthropics/skills/main/${file.path}`);
    if (!raw.ok) continue;
    const content = await raw.text();
    const relPath = file.path.slice(`skills/${name}/`.length);
    await invoke("write_text_file", { path: `${base}/${name}/${relPath}`, content });
  }
}

export async function listInstalledSkills(scope: "global" | "project", projectDir?: string): Promise<InstalledSkill[]> {
  try {
    const base = scope === "global" ? await globalSkillsDir() : projectSkillsDir(projectDir!);
    const exists = await invoke<boolean>("path_exists", { path: base });
    if (!exists) return [];
    const entries = await invoke<Array<{ name: string; path: string }>>("list_dir_entries", { path: base });
    return entries.map((e) => ({ name: e.name, scope, path: e.path }));
  } catch {
    return [];
  }
}

export async function deleteSkill(name: string, scope: "global" | "project", projectDir?: string): Promise<void> {
  const base = scope === "global" ? await globalSkillsDir() : projectSkillsDir(projectDir!);
  await invoke("remove_path", { path: `${base}/${name}` });
}

// ─── Generic GitHub skill installer (for any curated source repo) ───────────

/**
 * Install a curated skill by fetching its files from GitHub and writing them
 * to the opencode skills directory. Works for any repo using the
 * `skills/<name>/` convention (anthropics/skills, vercel-labs/agent-skills,
 * obra/superpowers, mattpocock/skills, supabase/agent-skills, …).
 */
export async function installCuratedSkill(
  skill: CuratedSkill,
  scope: "global" | "project",
  projectDir?: string,
): Promise<void> {
  const base = scope === "global" ? await globalSkillsDir() : projectSkillsDir(projectDir!);
  const treeUrl = `https://api.github.com/repos/${skill.repo}/git/trees/main?recursive=1`;
  const res = await fetch(treeUrl);
  if (!res.ok) throw new Error(`Failed to fetch skill file list from ${skill.repo}`);
  const data = (await res.json()) as GitTree;
  const prefix = `${skill.dir}/`;
  const files = data.tree.filter((t) => t.path.startsWith(prefix) && t.type === "blob");
  if (files.length === 0) throw new Error(`No files found under ${prefix} in ${skill.repo}`);
  for (const file of files) {
    const raw = await fetch(`https://raw.githubusercontent.com/${skill.repo}/main/${file.path}`);
    if (!raw.ok) continue;
    const content = await raw.text();
    const relPath = file.path.slice(prefix.length);
    await invoke("write_text_file", { path: `${base}/${skill.name}/${relPath}`, content });
  }
}

// ─── Chat integration: load installed skill content into the system prompt ──

/**
 * Read the SKILL.md of every globally-installed skill and return a single
 * string suitable for appending to the chat model's system prompt. This makes
 * installed skills actively shape chat replies (not just the agent's).
 * Token-capped to keep the prompt small.
 */
export async function loadInstalledSkillsPrompt(): Promise<string> {
  try {
    const installed = await listInstalledSkills("global");
    if (installed.length === 0) return "";
    const parts: string[] = [];
    let totalChars = 0;
    const MAX_CHARS = 6000;
    for (const skill of installed) {
      try {
        const skillMdPath = `${skill.path}/SKILL.md`;
        const exists = await invoke<boolean>("path_exists", { path: skillMdPath });
        if (!exists) continue;
        const content = await invoke<string>("read_text_file", { path: skillMdPath });
        const trimmed = content.slice(0, 2000);
        if (totalChars + trimmed.length > MAX_CHARS) break;
        parts.push(trimmed);
        totalChars += trimmed.length;
      } catch {
        // skip unreadable skills
      }
    }
    if (parts.length === 0) return "";
    return `The following skills are installed and active. Follow their guidance when the user's request is relevant:\n\n${parts.join("\n\n---\n\n")}`;
  } catch {
    return "";
  }
}
