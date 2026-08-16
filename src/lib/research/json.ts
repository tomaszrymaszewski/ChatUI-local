// Defensive JSON extraction for LLM responses that are supposed to be JSON-only
// but sometimes wrap it in a code fence or add stray text around it.

export class JsonExtractionError extends Error {
  constructor(rawText: string) {
    super(`Could not parse JSON from model response: ${rawText.slice(0, 200)}`);
    this.name = "JsonExtractionError";
  }
}

export function extractJson<T>(rawText: string): T {
  const trimmed = rawText.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      // fall through
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    } catch {
      // fall through
    }
  }

  throw new JsonExtractionError(trimmed);
}
