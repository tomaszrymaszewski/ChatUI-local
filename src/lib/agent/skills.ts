import { invoke } from "@tauri-apps/api/core";
import { listInstalledSkills, readSkillUsage } from "@/lib/skills-library";

export interface SkillFile {
  content: string[];
  created_at: string;
  modified_at: string;
}

/**
 * Cap on how many installed skills are advertised to the model per run. Every
 * advertised skill costs prompt tokens on EVERY model call (the deepagents
 * skills middleware appends name + description to the system message), so a
 * large installed library is truncated to the most recently used ones — the
 * full catalog stays reachable via search_skills.
 */
export const MAX_ADVERTISED_SKILLS = 30;

/**
 * App runtime overrides for catalog skills whose creation workflow doesn't
 * fit how this app executes code. The pptx/docx skills route document
 * creation through Node/npm (pptxgenjs, docx-js) — slow to bootstrap and
 * package-heavy. This app runs Python documents on the system python3 with
 * nothing to download, so the note flips creation to the Python libraries
 * while leaving the skills' read/edit/QA workflows untouched. Injected into
 * the virtual SKILL.md right after the front-matter, so the agent reads it
 * as part of the skill itself (a bare system-prompt rule is easy to ignore
 * against the skill's own "Create → npm script" instruction).
 */
const SKILL_RUNTIME_NOTES: Record<string, string> = {
  pptx:
    "> **App runtime note (overrides the creation workflow below):** create decks with " +
    "**python-pptx** via `run_python` — Python is much faster here and needs no package downloads. " +
    "The pptxgenjs/Node creation path below is disabled in this app — do NOT use it; apply its " +
    "styling and quality guidance with python-pptx instead. The skill's Python scripts " +
    "(thumbnails, XML editing, validation) work as written. If a Python import is missing, " +
    "`pip install` it (small).",
  docx:
    "> **App runtime note (overrides the creation workflow below):** create documents with " +
    "**python-docx** via `run_python` — Python is much faster here and needs no package downloads. " +
    "The docx-js/Node creation path below is disabled in this app — do NOT use it; apply its " +
    "formatting guidance with python-docx instead. Reading via pandoc and the unzip → edit-XML " +
    "workflow for existing files work as written. If a Python import is missing, `pip install` it (small).",
};

/**
 * Insert the app runtime note for a skill (if any) into its SKILL.md content,
 * after the front-matter block so front-matter parsing still sees the
 * original name/description first. Exported for tests and reused by the
 * search_skills inline path.
 */
export function applySkillRuntimeNotes(name: string, content: string): string {
  const note = SKILL_RUNTIME_NOTES[name];
  if (!note) return content;
  return insertAfterFrontMatter(content, note);
}

/**
 * Prepend a disk-location header to a virtual SKILL.md, after the front-matter
 * so front-matter parsing still works. The agent's `/skills/<name>/SKILL.md`
 * path is virtual (StateBackend — readable only via read_file / read_local_file);
 * the real folder on disk is where scripts and supporting files live. Without
 * this header the model guesses real locations when a shell command fails —
 * historically ending up inside other apps' skill folders.
 */
export function applySkillDiskHeader(name: string, skillPath: string, content: string): string {
  const header =
    `> **Disk location:** this skill is installed at \`${skillPath}\` on the user's Mac. ` +
    `Scripts, references, and supporting files live in that folder — access them with ` +
    `run_python / run_command / read_local_file using paths under it. Read THIS file via ` +
    `\`read_file\` on the virtual path \`/skills/${name}/SKILL.md\` (shell commands such as ` +
    `\`cat\` cannot see virtual paths).`;
  return insertAfterFrontMatter(content, header);
}

/** Insert a markdown note right after the YAML front-matter (if any). */
function insertAfterFrontMatter(content: string, note: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        lines.splice(i + 1, 0, "", note);
        return lines.join("\n");
      }
    }
  }
  return `${note}\n\n${content}`;
}

/**
 * Map a virtual skill path from the agent's filesystem (`/skills/<name>/…`
 * in the StateBackend) onto the real global skills directory on disk, so
 * disk-backed tools (read_local_file) can serve it — the shell and disk
 * tools cannot see virtual paths. Returns null for paths outside /skills/
 * (and for traversal attempts). Exported for tests.
 */
export function virtualSkillPathToReal(path: string, skillsDir: string): string | null {
  const prefix = "/skills/";
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (!rest || rest.includes("..")) return null;
  return `${skillsDir}/${rest}`;
}

/**
 * Collect installed skills (global + optional project scope) as virtual
 * filesystem entries for the Deep Agents skills middleware. Skills live at
 * `/skills/<name>/SKILL.md` in the agent's StateBackend; the harness reads
 * front-matter at startup and full content on demand (progressive disclosure).
 */
export async function loadSkillFiles(
  projectDir?: string | null,
): Promise<Record<string, SkillFile>> {
  const files: Record<string, SkillFile> = {};
  const now = new Date().toISOString();
  const scopes: Array<{ scope: "global" | "project"; dir?: string }> = [
    { scope: "global" },
  ];
  if (projectDir) scopes.push({ scope: "project", dir: projectDir });

  const usage = readSkillUsage();
  const installed: Array<{ name: string; path: string }> = [];
  for (const { scope, dir } of scopes) {
    try {
      for (const skill of await listInstalledSkills(scope, dir)) {
        installed.push({ name: skill.name, path: skill.path });
      }
    } catch {
      // scope unavailable (e.g. plain browser dev) — continue without it
    }
  }

  // MRU cap: advertise only the most recently used installed skills when the
  // library outgrows the prompt budget (usage is touched on install/read).
  const ranked = installed
    .map((s, i) => ({ ...s, last: usage[s.name] ?? 0, order: i }))
    .sort((a, b) => b.last - a.last || a.order - b.order)
    .slice(0, MAX_ADVERTISED_SKILLS);

  for (const skill of ranked) {
    try {
      const skillMdPath = `${skill.path}/SKILL.md`;
      const exists = await invoke<boolean>("path_exists", { path: skillMdPath });
      if (!exists) continue;
      const content = await invoke<string>("read_text_file", { path: skillMdPath });
      files[`/skills/${skill.name}/SKILL.md`] = {
        content: applySkillDiskHeader(
          skill.name,
          skill.path,
          applySkillRuntimeNotes(skill.name, content),
        ).split("\n"),
        created_at: now,
        modified_at: now,
      };
    } catch {
      // skip unreadable skills
    }
  }
  return files;
}
