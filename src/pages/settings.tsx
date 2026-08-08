import { useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Server,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ProviderForm } from "@/components/provider-form";
import { useProviders } from "@/hooks/use-providers";
import { useUserSettings } from "@/hooks/use-user-settings";
import type { Provider, ProviderModel } from "@/types";

type SettingsTab = "general" | "privacy" | "providers";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  const { providers, loading, createProvider, updateProvider, deleteProvider } =
    useProviders();
  const { settings, updateSettings } = useUserSettings();

  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);

  const allModels = providers.flatMap((p) =>
    p.models.map((m) => ({ ...m, providerName: p.name }))
  );

  const handleSaveProvider = async (
    name: string,
    baseUrl: string,
    apiKey: string,
    models: ProviderModel[]
  ) => {
    try {
      if (editingProvider) {
        await updateProvider(editingProvider.id, name, baseUrl, apiKey, models);
        toast.success("Provider updated");
      } else {
        await createProvider(name, baseUrl, apiKey, models);
        toast.success("Provider added");
      }
      setShowForm(false);
      setEditingProvider(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save provider"
      );
    }
  };

  const handleDeleteProvider = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProvider(deleteTarget.id);
      toast.success("Provider deleted");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete provider"
      );
    }
  };

  const tabs: [SettingsTab, string][] = [
    ["providers", "Providers"],
    ["general", "General"],
    ["privacy", "Privacy"],
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader className="shrink-0">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage your providers, preferences, and privacy options.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-1 overflow-hidden gap-4">
            <div className="flex w-40 flex-col gap-1">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    activeTab === key
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-2xl">
                {activeTab === "providers" && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-semibold">AI Providers</h2>
                        <p className="text-sm text-muted-foreground">
                          Manage your AI model providers and API keys
                        </p>
                      </div>
                      {!showForm && (
                        <Button
                          onClick={() => {
                            setEditingProvider(null);
                            setShowForm(true);
                          }}
                        >
                          <Plus className="size-4" />
                          Add Provider
                        </Button>
                      )}
                    </div>

                    {showForm && (
                      <ProviderForm
                        provider={editingProvider}
                        onSave={handleSaveProvider}
                        onCancel={() => {
                          setShowForm(false);
                          setEditingProvider(null);
                        }}
                      />
                    )}

                    {loading ? (
                      <p className="text-sm text-muted-foreground">Loading providers...</p>
                    ) : providers.length === 0 && !showForm ? (
                      <Card className="border-dashed">
                        <CardContent className="flex flex-col items-center gap-2 py-10">
                          <Server className="size-8 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            No providers configured yet
                          </p>
                          <Button
                            variant="outline"
                            onClick={() => setShowForm(true)}
                          >
                            <Plus className="size-4" />
                            Add your first provider
                          </Button>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {providers.map((provider) => (
                          <Card key={provider.id}>
                            <CardHeader>
                              <div className="flex items-start justify-between">
                                <div className="flex flex-col gap-1">
                                  <CardTitle className="flex items-center gap-2">
                                    <Cpu className="size-4" />
                                    {provider.name}
                                  </CardTitle>
                                  <CardDescription className="flex items-center gap-2">
                                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                      {provider.baseUrl}
                                    </code>
                                  </CardDescription>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      setEditingProvider(provider);
                                      setShowForm(true);
                                    }}
                                  >
                                    <Pencil className="size-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setDeleteTarget(provider)}
                                  >
                                    <Trash2 className="size-4 text-destructive" />
                                  </Button>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent>
                              <div className="flex flex-wrap gap-2">
                                {provider.models.map((model) => (
                                  <span
                                    key={model.id}
                                    className="rounded-md bg-muted px-2 py-1 text-xs font-medium"
                                  >
                                    {model.displayName || model.name}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                                <KeyRound className="size-3" />
                                {provider.hasKey ? "API key set" : "No API key"}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "general" && (
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-4">
                      <h2 className="text-xl font-semibold">General</h2>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm">Default model</span>
                          <span className="text-xs text-muted-foreground">
                            Model used for new conversations
                          </span>
                        </div>
                        <Select
                          value={settings.defaultModel ?? ""}
                          onValueChange={(v) =>
                            updateSettings({ defaultModel: v || null })
                          }
                        >
                          <SelectTrigger size="sm" className="w-48">
                            <SelectValue placeholder="Select model" />
                          </SelectTrigger>
                          <SelectContent>
                            {allModels.length === 0 ? (
                              <SelectItem value="__none__" disabled>
                                No models available
                              </SelectItem>
                            ) : (
                              allModels.map((m) => (
                                <SelectItem key={m.id} value={m.name}>
                                  {m.displayName || m.name} ({m.providerName})
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Send on Enter</span>
                        <Switch
                          checked={settings.sendOnEnter}
                          onCheckedChange={(v) =>
                            updateSettings({ sendOnEnter: v })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Show timestamps</span>
                        <Switch
                          checked={settings.showTimestamps}
                          onCheckedChange={(v) =>
                            updateSettings({ showTimestamps: v })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Sound effects</span>
                        <Switch
                          checked={settings.soundEffects}
                          onCheckedChange={(v) =>
                            updateSettings({ soundEffects: v })
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "privacy" && (
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-4">
                      <h2 className="text-xl font-semibold">Privacy</h2>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm">Temporary chat by default</span>
                          <span className="text-xs text-muted-foreground">
                            New chats won&apos;t be saved
                          </span>
                        </div>
                        <Switch
                          checked={settings.temporaryByDefault}
                          onCheckedChange={(v) =>
                            updateSettings({ temporaryByDefault: v })
                          }
                        />
                      </div>
                      <Button
                        variant="outline"
                        className="justify-start text-destructive hover:text-destructive w-fit"
                        onClick={() => toast.info("Use the sidebar delete buttons to clear individual chats")}
                      >
                        <Trash2 />
                        Clear all chat history
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Provider</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This will
              remove the provider and its API key from Vault. This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteProvider}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
