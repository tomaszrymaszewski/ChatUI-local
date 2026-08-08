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
