import { useState } from "react";
import { Plus, Trash2, KeyRound, Loader2 } from "lucide-react";
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
import type { Provider, ProviderModel } from "@/types";

interface ProviderFormProps {
  provider?: Provider | null;
  onSave: (
    name: string,
    baseUrl: string,
    apiKey: string,
    models: ProviderModel[]
  ) => Promise<void>;
  onCancel: () => void;
}

export function ProviderForm({ provider, onSave, onCancel }: ProviderFormProps) {
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(
    provider?.baseUrl ?? "https://api.openai.com/v1"
  );
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ProviderModel[]>(
    provider?.models ?? [{ id: crypto.randomUUID(), name: "" }]
  );
  const [saving, setSaving] = useState(false);

  const isEditing = !!provider;

  const addModel = () => {
    setModels([...models, { id: crypto.randomUUID(), name: "" }]);
  };

  const removeModel = (id: string) => {
    setModels(models.filter((m) => m.id !== id));
  };

  const updateModelName = (id: string, modelName: string) => {
    setModels(models.map((m) => (m.id === id ? { ...m, name: modelName } : m)));
  };

  const updateModelDisplayName = (id: string, displayName: string) => {
    setModels(models.map((m) => (m.id === id ? { ...m, displayName } : m)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) return;
    if (!baseUrl.trim()) return;
    if (!isEditing && !apiKey.trim()) return;

    const validModels = models.filter((m) => m.name.trim());
    if (validModels.length === 0) return;

    setSaving(true);
    try {
      await onSave(
        name.trim(),
        baseUrl.trim(),
        apiKey,
        validModels.map((m) => ({
          id: m.id,
          name: m.name.trim(),
          displayName: m.displayName?.trim() || undefined,
        }))
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
            : "Configure a new AI provider with an OpenAI-compatible API."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-name">Provider Name</Label>
            <Input
              id="provider-name"
              placeholder="e.g. OpenAI, Together AI, Groq"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-base-url">Base URL</Label>
            <Input
              id="provider-base-url"
              placeholder="https://api.openai.com/v1"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The OpenAI-compatible API endpoint (without /chat/completions)
            </p>
          </div>

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
              Stored securely in Supabase Vault, encrypted at rest
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Models</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addModel}
              >
                <Plus className="size-3" />
                Add Model
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {models.map((model) => (
                <div key={model.id} className="flex items-center gap-2">
                  <Input
                    placeholder="Model ID — e.g. gpt-4o"
                    value={model.name}
                    onChange={(e) => updateModelName(model.id, e.target.value)}
                  />
                  <Input
                    placeholder="Display name (optional)"
                    value={model.displayName ?? ""}
                    onChange={(e) => updateModelDisplayName(model.id, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeModel(model.id)}
                    className="shrink-0"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Add the model names available from this provider
            </p>
          </div>
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
