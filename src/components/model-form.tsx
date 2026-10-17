import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { RemoveScroll } from "react-remove-scroll";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { formatModelName } from "@/lib/model-display";
import { cn } from "@/lib/utils";

interface ModelFormProps {
  providers: Provider[];
  onSave: (providerId: string, model: ProviderModel) => Promise<void>;
  onCancel: () => void;
}

export function ModelForm({ providers, onSave, onCancel }: ModelFormProps) {
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  // Searchable model picker: the field itself holds what the user types and
  // the list below filters to names containing it. The list is portaled to
  // the body (fixed positioning) so it can overflow the Add Model dialog
  // instead of being clipped by its scroll container. Wrapped in RemoveScroll
  // (like Radix Select's own portaled content): the modal dialog's scroll
  // lock cancels wheel events outside its content, which would otherwise
  // make this body-portaled list unscrollable.
  const [modelQuery, setModelQuery] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const modelBoxRef = useRef<HTMLDivElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);
  const [modelListStyle, setModelListStyle] = useState<React.CSSProperties | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedProvider = providers.find((p) => p.id === providerId);
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
      setModelQuery("");
      setModelOpen(false);
      setDisplayName("");
      setAvailableModels([]);
      setFetchError(null);
      fetchModels();
    }
  }, [providerId, fetchModels]);

  // Filter while typing — case-insensitive substring match.
  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return availableModels;
    return availableModels.filter((m) => m.toLowerCase().includes(q));
  }, [availableModels, modelQuery]);
  // Long catalogs (OpenRouter has hundreds) render a bounded window; the
  // query narrows it quickly.
  const visibleModels = filteredModels.slice(0, 100);

  const handleQueryChange = (value: string) => {
    setModelQuery(value);
    setModelOpen(true);
    // Typing an exact name selects it; anything else clears the selection so
    // Add Model can't save a model the field no longer shows.
    const exact = availableModels.find(
      (m) => m.toLowerCase() === value.trim().toLowerCase(),
    );
    setModelId(exact ?? "");
  };

  const selectModel = (value: string) => {
    setModelId(value);
    setModelQuery(value);
    setModelOpen(false);
  };

  // Anchor the portaled list under the field, flipping above it when there
  // is more room up top; the height shrinks to the available space so the
  // list never runs off the window even though it overflows the dialog.
  const updateModelListPosition = useCallback(() => {
    const input = modelBoxRef.current?.querySelector("input");
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    setModelListStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(96, Math.min(256, openUp ? spaceAbove : spaceBelow)),
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap }),
    });
  }, []);

  useEffect(() => {
    if (!modelOpen) return;
    updateModelListPosition();
    const onMove = () => updateModelListPosition();
    window.addEventListener("resize", onMove);
    // Capture so scrolling any ancestor (the dialog's scroll container
    // included) keeps the fixed list glued to the field.
    document.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      document.removeEventListener("scroll", onMove, true);
    };
  }, [modelOpen, updateModelListPosition]);

  // Close the list when clicking anywhere outside the picker or its portaled
  // list.
  useEffect(() => {
    if (!modelOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (modelBoxRef.current?.contains(target)) return;
      if (modelListRef.current?.contains(target)) return;
      setModelOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [modelOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerId || !modelId.trim()) return;

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
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Add a provider first, then you can add models to it.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-destructive">{fetchError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={fetchModels}>
                      Try again
                    </Button>
                  </div>
                ) : availableModels.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No models found. Check your API key and try refreshing.
                  </p>
                ) : (
                  <div ref={modelBoxRef} className="relative">
                    <Input
                      id="model-id"
                      role="combobox"
                      aria-expanded={modelOpen}
                      aria-controls="model-listbox"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Search models…"
                      value={modelQuery}
                      onChange={(e) => handleQueryChange(e.target.value)}
                      onFocus={() => setModelOpen(true)}
                      // Focus stays in the input after a pick, so a plain
                      // click must reopen the list too (focus won't refire).
                      onClick={() => setModelOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setModelOpen(false);
                          return;
                        }
                        // Enter with no selection yet picks the top match;
                        // with one, the form submits as usual.
                        if (
                          e.key === "Enter" &&
                          modelOpen &&
                          !modelId &&
                          visibleModels.length > 0
                        ) {
                          e.preventDefault();
                          selectModel(visibleModels[0]);
                        }
                      }}
                    />
                    {modelOpen &&
                      modelListStyle &&
                      createPortal(
                        <RemoveScroll allowPinchZoom>
                          <div
                            ref={modelListRef}
                            data-model-listbox=""
                            id="model-listbox"
                            role="listbox"
                            style={modelListStyle}
                            // pointer-events-auto: the modal dialog sets
                            // pointer-events: none on the body, which this
                            // body-portaled list would otherwise inherit —
                            // clicks and hover would never reach the options.
                            className="pointer-events-auto z-[80] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                          >
                            {visibleModels.length === 0 ? (
                              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                                No models match “{modelQuery.trim()}”
                              </p>
                            ) : (
                              visibleModels.map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  role="option"
                                  aria-selected={m === modelId}
                                  // Keep focus in the input so the list stays open
                                  // until the click lands.
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => selectModel(m)}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                                    m === modelId && "bg-accent/50",
                                  )}
                                >
                                  <span className="min-w-0 flex-1 truncate">{m}</span>
                                  {m === modelId && (
                                    <Check className="size-3.5 shrink-0" />
                                  )}
                                </button>
                              ))
                            )}
                            {filteredModels.length > visibleModels.length && (
                              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                {filteredModels.length - visibleModels.length} more — keep
                                typing to narrow
                              </p>
                            )}
                          </div>
                        </RemoveScroll>,
                        document.body,
                      )}
                  </div>
                )}
              </div>

              {modelId && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="model-display-name">Display Name</Label>
                  <Input
                    id="model-display-name"
                    placeholder="Visible in all dropdowns in this app"
                    value={displayName.trim() || formatModelName(modelId)}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !modelId.trim()}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Add Model
        </Button>
      </div>
    </form>
  );
}
