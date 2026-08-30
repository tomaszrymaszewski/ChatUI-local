import { invoke } from "@tauri-apps/api/core";
import { listInstalledSkills } from "@/lib/skills-library";

export interface SkillFile {
  content: string[];
  created_at: string;
  modified_at: string;
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

  for (const { scope, dir } of scopes) {
    try {
      const installed = await listInstalledSkills(scope, dir);
      for (const skill of installed) {
        try {
          const skillMdPath = `${skill.path}/SKILL.md`;
          const exists = await invoke<boolean>("path_exists", { path: skillMdPath });
          if (!exists) continue;
          const content = await invoke<string>("read_text_file", { path: skillMdPath });
          files[`/skills/${skill.name}/SKILL.md`] = {
            content: content.split("\n"),
            created_at: now,
            modified_at: now,
          };
        } catch {
          // skip unreadable skills
        }
      }
    } catch {
      // scope unavailable (e.g. plain browser dev) — continue without it
    }
  }
  return files;
}
