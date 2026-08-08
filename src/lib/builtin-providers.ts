export interface BuiltinProvider {
  key: string;
  name: string;
  baseUrl: string;
  requiresApiKey: boolean;
}

export const BUILTIN_PROVIDERS: BuiltinProvider[] = [
  {
    key: "fireworks",
    name: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    requiresApiKey: true,
  },
  {
    key: "deepinfra",
    name: "DeepInfra",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    requiresApiKey: true,
  },
  {
    key: "claude",
    name: "Claude (Anthropic)",
    baseUrl: "https://api.anthropic.com/v1",
    requiresApiKey: true,
  },
  {
    key: "chatgpt",
    name: "ChatGPT (OpenAI)",
    baseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
  },
  {
    key: "gemini",
    name: "Gemini (Google)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    requiresApiKey: true,
  },
  {
    key: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
  },
  {
    key: "custom",
    name: "Custom",
    baseUrl: "",
    requiresApiKey: true,
  },
];

export function getBuiltinProvider(key: string): BuiltinProvider | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.key === key);
}
