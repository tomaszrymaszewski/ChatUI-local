const PREFIX = "chatui:mcp-disabled:";

export function getDisabledMcps(sessionId: string | null): string[] {
  if (!sessionId) return [];
  try {
    return JSON.parse(localStorage.getItem(PREFIX + sessionId) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function setDisabledMcps(sessionId: string | null, names: string[]) {
  if (!sessionId) return;
  localStorage.setItem(PREFIX + sessionId, JSON.stringify(names));
}

/** Build the opencode `tools` map that disables the given MCP servers. */
export function buildToolsMap(disabled: string[]): Record<string, boolean> | undefined {
  if (disabled.length === 0) return undefined;
  const tools: Record<string, boolean> = {};
  for (const name of disabled) {
    tools[`${name}_*`] = false;
  }
  return tools;
}
