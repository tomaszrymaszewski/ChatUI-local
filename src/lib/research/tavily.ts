// Tavily search client — the universal (any-model) search backend for Deep
// Research. Plain fetch(), matching every other HTTP call in this codebase;
// no SDK. Request/response shape verified against Tavily's API reference
// (docs.tavily.com) — not guessed.

import { TAVILY_MAX_CONTENT_CHARS, TAVILY_MAX_RESULTS_PER_QUERY, TAVILY_SEARCH_DEPTH, TAVILY_SEARCH_URL } from "./config";

export interface TavilyCredentials {
  apiKey: string;
}

export interface TavilySearchResult {
  url: string;
  title: string;
  content: string;
}

export class TavilySearchError extends Error {
  constructor(status: number, body: string) {
    super(`Tavily API error (${status}): ${body || "request failed"}`);
    this.name = "TavilySearchError";
  }
}

interface TavilySearchResponse {
  results?: Array<{ url: string; title: string; content: string }>;
}

export async function searchTavily(
  query: string,
  credentials: TavilyCredentials,
  signal: AbortSignal,
): Promise<TavilySearchResult[]> {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: TAVILY_SEARCH_DEPTH,
      max_results: TAVILY_MAX_RESULTS_PER_QUERY,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new TavilySearchError(response.status, errorText || response.statusText);
  }

  const data = (await response.json()) as TavilySearchResponse;
  return (data.results ?? []).map((result) => ({
    url: result.url,
    title: result.title,
    content: result.content.slice(0, TAVILY_MAX_CONTENT_CHARS),
  }));
}
