export interface ProviderMeta {
  /** Matches BuiltinProvider.key */
  key: string;
  name: string;
  /** One-line, non-technical description. */
  tagline: string;
  /** Key into the provider logo map. */
  logoKey: string;
  /** Runs locally — no API key needed. */
  local?: boolean;
  /** Where the user gets their API key. */
  keyHelpUrl?: string;
  /** Plain-English steps for obtaining an API key. */
  tutorial?: string[];
  /** Fallback models suggestions when the live fetch fails. */
  defaultModels: string[];
}

/** Display order for onboarding and settings. */
export const PROVIDER_META: ProviderMeta[] = [
  {
    key: "ollama",
    name: "Ollama",
    tagline: "Run open models on your own computer — free, private, works offline.",
    logoKey: "ollama",
    local: true,
    tutorial: [
      "Install Ollama from ollama.com/download",
      "Open a terminal and pull a model, e.g. \"ollama pull llama3.2\"",
      "Keep Ollama running, then continue here — we'll find your models automatically",
    ],
    defaultModels: ["llama3.2", "llama3.1:8b", "qwen2.5", "mistral"],
  },
  {
    key: "ollama-cloud",
    name: "Ollama Cloud",
    tagline: "Hosted models from the Ollama team — same simple experience, no local install.",
    logoKey: "ollama",
    keyHelpUrl: "https://ollama.com/settings/keys",
    tutorial: [
      "Sign in (or create a free account) at ollama.com",
      "Open Settings → Keys",
      "Click \"Create key\", copy it, and paste it here",
    ],
    defaultModels: ["deepseek-v4-flash", "gpt-oss:20b"],
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    tagline: "One key for hundreds of models — great free options included.",
    logoKey: "openrouter",
    keyHelpUrl: "https://openrouter.ai/settings/keys",
    tutorial: [
      "Create a free account at openrouter.ai",
      "Open Settings → Keys",
      "Click \"Create key\", copy it, and paste it here",
      "Connect card and add funds to start using"
    ],
    defaultModels: ["deepseek/deepseek-v4-flash"],
  },
  {
    key: "fireworks",
    name: "Fireworks",
    tagline: "Fast, affordable inference for top open models. Zero data retention (private).",
    logoKey: "fireworks",
    keyHelpUrl: "https://fireworks.ai/account/api-keys",
    tutorial: [
      "Create an account at fireworks.ai",
      "Open your profile → API Keys",
      "Click \"Create API key\", copy it, and paste it here",
      "Connect card and add funds to start using"
    ],
    defaultModels: ["accounts/fireworks/models/deepseek-v4-flash-0731"],
  },
  {
    key: "deepinfra",
    name: "DeepInfra",
    tagline: "Low-cost API access to popular open models. Zero data retention (private).",
    logoKey: "deepinfra",
    keyHelpUrl: "https://deepinfra.com/dash/api_keys",
    tutorial: [
      "Create an account at deepinfra.com",
      "Open the dashboard → API Keys",
      "Create a new key, copy it, and paste it here",
      "Connect card and add funds to start using"
    ],
    defaultModels: ["deepseek-ai/DeepSeek-V4-Flash"],
  },
  {
    key: "chatgpt",
    name: "OpenAI",
    tagline: "Most widely used platform with some of the best models.",
    logoKey: "openai",
    keyHelpUrl: "https://platform.openai.com/api-keys",
    tutorial: [
      "Sign in at platform.openai.com",
      "Open your profile → API keys (you may need to add credits first)",
      "Click \"Create new secret key\", copy it, and paste it here",
      "Connect card and add funds to start using"
    ],
    defaultModels: ["gpt-5-mini"],
  },
  {
    key: "claude",
    name: "Claude",
    tagline: "Most intelligent models but very expensive.",
    logoKey: "anthropic",
    keyHelpUrl: "https://console.anthropic.com/settings/keys",
    tutorial: [
      "Create an account at console.anthropic.com",
      "Open Settings → API Keys (you may need to add credits first)",
      "Click \"Create key\", copy it, and paste it here",
      "Connect card and add funds to start using"
    ],
    defaultModels: ["claude-haiku-4-5"],
  },
  {
    key: "gemini",
    name: "Gemini",
    tagline: "Google's Gemini models — generous free tier via AI Studio.",
    logoKey: "gemini",
    keyHelpUrl: "https://aistudio.google.com/apikey",
    tutorial: [
      "Sign in with your Google account at aistudio.google.com",
      "Click \"Create API key\" and pick a project",
      "Copy the key and paste it here",
    ],
    defaultModels: ["gemini-flash-lite-latest"],
  },
  {
    key: "custom",
    name: "Custom",
    tagline: "Any OpenAI-compatible endpoint — Together, Groq, LM Studio, vLLM…",
    logoKey: "custom",
    defaultModels: [],
  },
];

export function getProviderMeta(key: string): ProviderMeta | undefined {
  return PROVIDER_META.find((p) => p.key === key);
}
