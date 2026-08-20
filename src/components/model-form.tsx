import { useState, useEffect, useCallback } from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
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
import type { Provider, ProviderModel } from "@/types";
import { fetchModelsFromApi, fetchOllamaModels } from "@/lib/llm";

interface ModelFormProps {
  providers: Provider[];
  onSave: (providerId: string, model: ProviderModel) => Promise<void>;
  onCancel: () => void;
}

export function ModelForm({ providers, onSave, onCancel }: ModelFormProps) {
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedProvider = providers.find((p) => p.id === providerId);
  const isCustom = selectedProvider
    ? !selectedProvider.builtinKey || selectedProvider.builtinKey === "custom"
    : false;
  const isOllama = selectedProvider?.builtinKey === "ollama";

  const fetchModels = useCallback(async () => {
    if (!selectedProvider) return;
    setLoadingModels(true);
    setFetchError(null);
    setAvailableModels([]);
    try {
      const models = isOllama
        ? await fetchOllamaModels()
        : await fetchModelsFromApi(selectedProvider);
      setAvailableModels(models);
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Failed to fetch models",
      );
    } finally {
      setLoadingModels(false);
    }
  }, [selectedProvider, isOllama]);

  useEffect(() => {
    if (providerId) {
      setModelId("");
      setDisplayName("");
      setAvailableModels([]);
      setFetchError(null);
      fetchModels();
    }
  }, [providerId, fetchModels]);

  const handleModelSelect = (value: string) => {
    setModelId(value);
    if (!isCustom) {
      setDisplayName(value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerId || !modelId.trim()) return;
    if (isCustom && !displayName.trim()) return;

    setSaving(true);
    try {
      const model: ProviderModel = {
        id: crypto.randomUUID(),
        name: modelId.trim(),
        displayName: displayName.trim() || undefined,
      };
      await onSave(providerId, model);
    } finally {
      setSaving(false);
    }
  };

  if (providers.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Add Model</CardTitle>
          <CardDescription>
            Add a provider first, then you can add models to it.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" onClick={onCancel}>
            Close
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-4" />
          Add Model
        </CardTitle>
        <CardDescription>
          Select a provider, then choose a model from its API.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="model-provider">Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger id="model-provider">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {providerId && (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="model-id">Model</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={fetchModels}
                    disabled={loadingModels}
                  >
                    <RefreshCw className={`size-3 ${loadingModels ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
                {loadingModels ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="size-4 animate-spin" />
                    Fetching models...
                  </div>
                ) : fetchError ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-destructive">{fetchError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={fetchModels}>
                      Try again
                    </Button>
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-muted-foreground">Or enter the model id manually:</p>
                      <Input
                        id="model-id"
                        placeholder="e.g. claude-sonnet-5"
                        value={modelId}
                        onChange={(e) => handleModelSelect(e.target.value)}
                      />
                    </div>
                  </div>
                ) : availableModels.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No models found. Check your API key and try refreshing.
                  </p>
                ) : (
                  <Select value={modelId} onValueChange={handleModelSelect}>
                    <SelectTrigger id="model-id">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {modelId && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="model-display-name">
                    Display Name
                    {isCustom && <span className="text-destructive"> *</span>}
                  </Label>
                  <Input
                    id="model-display-name"
                    placeholder={
                      isCustom
                        ? "Required — e.g. My Custom Model"
                        : "Optional — defaults to model ID"
                    }
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required={isCustom}
                  />
                  <p className="text-xs text-muted-foreground">
                    {isCustom
                      ? "Required for custom providers"
                      : "Auto-filled from model ID, but you can customize it"}
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !modelId.trim() || (isCustom && !displayName.trim())}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Add Model
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
