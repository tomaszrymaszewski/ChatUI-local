// Deep Research's Anthropic credential lookup — intentionally independent of
// the chat model selector (see DISCOVERY.md gate resolution #3): it scans the
// user's configured providers for a Claude/Anthropic one with a key set,
// regardless of which provider/model is currently selected in the chat UI.

import { fetchProviders, getProviderApiKey } from "@/lib/llm";
import { isAnthropicProvider } from "@/lib/providers/anthropic";

export class MissingResearchKeyError extends Error {
  constructor() {
    super(
      "Deep Research needs a Claude (Anthropic) API key. Add one under Settings → Providers, then try again.",
    );
    this.name = "MissingResearchKeyError";
  }
}

export interface ResearchCredentials {
  apiKey: string;
  baseUrl: string;
}

export async function getResearchCredentials(): Promise<ResearchCredentials> {
  const providers = await fetchProviders();
  const claudeProvider = providers.find((p) => isAnthropicProvider(p.baseUrl) && p.hasKey);
  if (!claudeProvider) throw new MissingResearchKeyError();

  const apiKey = await getProviderApiKey(claudeProvider.id);
  if (!apiKey) throw new MissingResearchKeyError();

  return { apiKey, baseUrl: claudeProvider.baseUrl.replace(/\/$/, "") };
}

// --- Tavily (universal search path — Phase 2-B) ---
//
// Tavily is a search API, not a chat completion provider, so it doesn't fit the
// Provider system (baseUrl + models) the rest of this file reads from. It gets
// its own small localStorage entry instead, same plaintext-in-localStorage
// pattern every other key in this app already uses.

const TAVILY_KEY_STORAGE_KEY = "chatui:tavily-key";

export class MissingTavilyKeyError extends Error {
  constructor() {
    super(
      "Deep Research needs a Tavily API key to search when a non-Claude model is selected. Add one under Settings, or switch to a Claude model to use Anthropic's built-in search instead.",
    );
    this.name = "MissingTavilyKeyError";
  }
}

export function getTavilyApiKey(): string {
  const key = localStorage.getItem(TAVILY_KEY_STORAGE_KEY)?.trim();
  if (!key) throw new MissingTavilyKeyError();
  return key;
}

/** Non-throwing variant for UI display (e.g. pre-filling a Settings field). */
export function getTavilyApiKeyOrEmpty(): string {
  return localStorage.getItem(TAVILY_KEY_STORAGE_KEY)?.trim() ?? "";
}

export function setTavilyApiKey(key: string): void {
  localStorage.setItem(TAVILY_KEY_STORAGE_KEY, key.trim());
}

export function hasTavilyApiKey(): boolean {
  return !!localStorage.getItem(TAVILY_KEY_STORAGE_KEY)?.trim();
}
