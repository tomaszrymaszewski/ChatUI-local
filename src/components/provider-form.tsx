import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BUILTIN_PROVIDERS, getBuiltinProvider } from "@/lib/builtin-providers";
import type { Provider } from "@/types";

interface ProviderFormProps {
  provider?: Provider | null;
  onSave: (
    name: string,
    baseUrl: string,
    apiKey: string,
    builtinKey?: string,
  ) => Promise<void>;
  onCancel: () => void;
}

export function ProviderForm({ provider, onSave, onCancel }: ProviderFormProps) {
  const [selectedBuiltin, setSelectedBuiltin] = useState(
    provider?.builtinKey ?? "custom",
  );
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const isEditing = !!provider;
  const isBuiltin = selectedBuiltin !== "custom";
  const isOllama = selectedBuiltin === "ollama";
  const builtin = isBuiltin ? getBuiltinProvider(selectedBuiltin) : null;

  const effectiveName = isBuiltin ? (builtin?.name ?? "") : name;
  const effectiveBaseUrl = isBuiltin ? (builtin?.baseUrl ?? "") : baseUrl;
  const requiresApiKey = isBuiltin ? (builtin?.requiresApiKey ?? true) : true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!effectiveName.trim()) return;
    if (!effectiveBaseUrl.trim() && !isOllama) return;
    if (!isEditing && requiresApiKey && !apiKey.trim()) return;

    setSaving(true);
    try {
      await onSave(
        effectiveName.trim(),
        effectiveBaseUrl.trim(),
        apiKey,
        isBuiltin ? selectedBuiltin : undefined,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          {isEditing ? "Edit Provider" : "Add Provider"}
        </CardTitle>
        <CardDescription>
          {isEditing
            ? "Update your provider configuration. Leave API key blank to keep the existing key."
            : "Choose a built-in provider or add a custom OpenAI-compatible endpoint."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-type">Provider Type</Label>
            <Select
              value={selectedBuiltin}
              onValueChange={(v) => {
                setSelectedBuiltin(v);
                if (v !== "custom") {
                  const b = getBuiltinProvider(v);
                  if (b) {
                    setName(b.name);
                    setBaseUrl(b.baseUrl);
                  }
                }
              }}
              disabled={isEditing}
            >
              <SelectTrigger id="provider-type">
                <SelectValue placeholder="Select provider type" />
              </SelectTrigger>
              <SelectContent>
                {BUILTIN_PROVIDERS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isBuiltin && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="provider-name">Provider Name</Label>
                <Input
                  id="provider-name"
                  placeholder="e.g. Together AI, Groq"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="provider-base-url">Base URL</Label>
                <Input
                  id="provider-base-url"
                  placeholder="https://api.example.com/v1"
                  required
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The OpenAI-compatible API endpoint (without /chat/completions)
                </p>
              </div>
            </>
          )}

          {isBuiltin && (
            <div className="flex flex-col gap-2">
              <Label>Base URL</Label>
              <code className="rounded-md bg-muted px-3 py-2 text-sm">
                {effectiveBaseUrl || "(local)"}
              </code>
            </div>
          )}

          {requiresApiKey && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="provider-api-key">API Key</Label>
              <Input
                id="provider-api-key"
                type="password"
                placeholder={
                  isEditing ? "Enter new key to change (leave blank to keep)" : "sk-..."
                }
                required={!isEditing}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Stored locally on your device
              </p>
            </div>
          )}

          {isOllama && (
            <p className="text-xs text-muted-foreground">
              Ollama runs locally — no API key required. Make sure Ollama is
              running before fetching models.
            </p>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {isEditing ? "Save Changes" : "Add Provider"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
