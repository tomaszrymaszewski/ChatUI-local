// Council roster selection — which models the council-mode prompt asks the
// agent to simulate as subagent perspectives. Persisted in localStorage.

const STORAGE_KEY = "chatui:council-models";

/** Cap on how many models sit on the council at once. */
export const MAX_COUNCIL_MODELS = 4;

export function loadCouncilRoster(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data)
      ? data.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveCouncilRoster(models: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
}

export interface RosterModelMeta {
  name: string;
  providerId: string;
}

/**
 * Default roster: the currently selected model plus one model from each
 * other provider, capped at MAX_COUNCIL_MODELS.
 */
export function defaultCouncilRoster(
  allModels: RosterModelMeta[],
  selectedModel: string,
): string[] {
  const result: string[] = [];
  const seenProviders = new Set<string>();
  const selected = allModels.find((m) => m.name === selectedModel);
  if (selected) {
    result.push(selected.name);
    seenProviders.add(selected.providerId);
  }
  for (const m of allModels) {
    if (result.length >= MAX_COUNCIL_MODELS) break;
    if (seenProviders.has(m.providerId)) continue;
    seenProviders.add(m.providerId);
    result.push(m.name);
  }
  return result;
}
