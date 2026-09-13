// Query side of the knowledge index: pre-prompt retrieval (auto top-k into
// the run instructions) and result formatting for the agent-facing
// search_knowledge tool. Index writes live in knowledge-index.ts.

import {
  searchKnowledgeIndex,
  type KnowledgeHit,
} from "@/lib/knowledge-index";

export interface KnowledgeRetrieval {
  /** Formatted instruction block ("" when nothing found). */
  block: string;
  /** Hit ids that were injected — search_knowledge excludes them. */
  ids: string[];
}

function hitDate(hit: KnowledgeHit): string | null {
  const ts = hit.extra?.ts;
  if (typeof ts !== "string" && typeof ts !== "number") return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function hitLabel(hit: KnowledgeHit): string {
  const title = hit.sourceTitle ? ` — ${hit.sourceTitle}` : "";
  switch (hit.sourceType) {
    case "chat": {
      const date = hitDate(hit);
      return `[past chat${title}${date ? `, ${date}` : ""}]`;
    }
    case "file":
      return `[file${title}]`;
    case "image":
      return `[image${title}]`;
    case "skill":
    case "skill_doc":
      return `[skill${title}]`;
    case "connector":
      return `[connector${title}]`;
    case "memory":
      return "[memory]";
  }
}

/** Hint appended to catalog-only skill hits (not installed on disk yet). */
function skillHitHint(hit: KnowledgeHit): string {
  if (hit.sourceType !== "skill" && hit.sourceType !== "skill_doc") return "";
  const kind = hit.extra?.kind;
  if (kind === "installed" || kind === "bundled") {
    return ` Full instructions: read_file /skills/${hit.sourceRef}/SKILL.md.`;
  }
  return ` Not installed yet — call search_skills("${hit.sourceRef}") to install it on the spot and load its full instructions.`;
}

/** Format auto-injected retrieval — skills/connectors first, then user data. */
export function buildKnowledgeBlock(hits: KnowledgeHit[], maxChars = 3000): string {
  if (hits.length === 0) return "";
  const sections: string[] = [];
  let used = 0;

  // Skills and connectors get their own section with actionable guidance —
  // they are always-on discovery surfaces, distinct from the user's data.
  const capabilityHits = hits.filter(
    (h) => h.sourceType === "skill" || h.sourceType === "skill_doc" || h.sourceType === "connector",
  );
  if (capabilityHits.length > 0) {
    const lines: string[] = [];
    for (const hit of capabilityHits) {
      const snippet = hit.text.replace(/\s+/g, " ").trim();
      const clipped = snippet.length > 400 ? `${snippet.slice(0, 400)}…` : snippet;
      const line = `- ${hitLabel(hit)}: ${clipped}${skillHitHint(hit)}`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length;
    }
    if (lines.length > 0) {
      sections.push(`Relevant skills & connectors (most similar first):\n${lines.join("\n")}`);
    }
  }

  const dataHits = hits.filter((h) => !capabilityHits.includes(h));
  if (dataHits.length > 0) {
    const lines: string[] = [];
    for (const hit of dataHits) {
      const snippet = hit.text.replace(/\s+/g, " ").trim();
      const clipped = snippet.length > 600 ? `${snippet.slice(0, 600)}…` : snippet;
      const line = `- ${hitLabel(hit)}: ${clipped}`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length;
    }
    if (lines.length > 0) {
      sections.push(`Relevant knowledge from the user's library (most similar first):\n${lines.join("\n")}`);
    }
  }

  return sections.join("\n\n");
}

/** Numbered results for the agent tool — keeps hit ids so the agent can
 * exclude them in follow-up searches. */
export function formatKnowledgeHitsForTool(hits: KnowledgeHit[]): string {
  const lines = hits.map((hit, i) => {
    const snippet = hit.text.replace(/\s+/g, " ").trim();
    const clipped = snippet.length > 600 ? `${snippet.slice(0, 600)}…` : snippet;
    return (
      `[${i + 1}] id: ${hit.id} · ${hitLabel(hit)} · chunk ${hit.chunkIndex}\n` +
      `    ${clipped}`
    );
  });
  return `Found ${hits.length} result(s), most similar first. Pass ids via exclude_ids to see beyond these:\n\n${lines.join("\n\n")}`;
}

/**
 * Auto-retrieval for a run: the top-k index hits for the user's message,
 * formatted as an instruction block. Skills and connectors are always
 * retrieved (the user-data types follow the Knowledge Index settings).
 * Returns empty ids/block when the index is empty or unavailable — callers
 * never treat it as an error.
 */
export async function retrieveKnowledgeContext(
  query: string,
  opts: { limit?: number; excludeIds?: string[]; maxChars?: number } = {},
): Promise<KnowledgeRetrieval> {
  if (!query.trim()) {
    return { block: "", ids: [] };
  }
  const hits = await searchKnowledgeIndex(query, {
    limit: opts.limit ?? 5,
    excludeIds: opts.excludeIds,
  });
  const block = buildKnowledgeBlock(hits, opts.maxChars ?? 3000);
  if (!block) return { block: "", ids: [] };
  return { block, ids: hits.map((h) => h.id) };
}
