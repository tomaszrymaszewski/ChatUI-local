import { useEffect, useRef, useState } from "react";
import { Check, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WelcomeStep } from "@/components/onboarding/welcome-step";
import { ThemeStep } from "@/components/onboarding/theme-step";
import { ProvidersStep } from "@/components/onboarding/providers-step";
import { ProviderKeyStep } from "@/components/onboarding/provider-key-step";
import { ProviderModelsStep } from "@/components/onboarding/provider-models-step";
import { SkillsStep } from "@/components/onboarding/skills-step";
import { ConnectorsStep } from "@/components/onboarding/connectors-step";
import { StepFooter } from "@/components/onboarding/step-chrome";
import { PatternBackground } from "@/components/background-pattern";
import { useProviders } from "@/hooks/use-providers";
import { useUserSettings } from "@/hooks/use-user-settings";
import { fetchProviders } from "@/lib/llm";
import { getBuiltinProvider } from "@/lib/builtin-providers";
import { getProviderMeta } from "@/lib/provider-meta";
import {
  markOnboardingDone,
  loadOnboardingStep,
  saveOnboardingStep,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types";

type Step =
  | "welcome"
  | "theme"
  | "providers"
  | "provider-key"
  | "provider-models"
  | "skills"
  | "connectors"
  | "done";

const ALL_STEPS: Step[] = [
  "welcome",
  "theme",
  "providers",
  "provider-key",
  "provider-models",
  "skills",
  "connectors",
  "done",
];

const TOP_STEPS: Array<{ label: string; steps: Step[] }> = [
  { label: "Welcome", steps: ["welcome"] },
  { label: "Theme", steps: ["theme"] },
  { label: "Providers", steps: ["providers", "provider-key", "provider-models"] },
  { label: "Skills", steps: ["skills"] },
  { label: "Connectors", steps: ["connectors"] },
  { label: "Done", steps: ["done"] },
];

export function OnboardingWizard({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState<Step>(() => {
    const saved = loadOnboardingStep();
    return saved && (ALL_STEPS as string[]).includes(saved)
      ? (saved as Step)
      : "welcome";
  });
  const [setupKey, setSetupKey] = useState<string | null>(null);
  const [setupProviderId, setSetupProviderId] = useState<string | null>(null);
  const [headerBox, setHeaderBox] = useState<HTMLDivElement | null>(null);
  const [footerBox, setFooterBox] = useState<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);

  const { providers, createProvider, addModel } = useProviders();
  const { settings, updateSettings } = useUserSettings();

  const topIndex = TOP_STEPS.findIndex((t) => t.steps.includes(step));

  const gotoStep = (next: Step) => {
    setStep(next);
    // Provider sub-steps are only reachable with local state, so persist
    // their parent step instead.
    saveOnboardingStep(
      next === "provider-key" || next === "provider-models" ? "providers" : next,
    );
  };

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const setupMeta = setupKey ? getProviderMeta(setupKey) : undefined;
  const setupBuiltin = setupKey ? getBuiltinProvider(setupKey) : undefined;
  const setupProvider: Provider | undefined = providers.find(
    (p) => p.id === setupProviderId,
  );

  const handleSelectProvider = (key: string) => {
    const existing = providers.find((p) =>
      key === "custom" ? !p.builtinKey : p.builtinKey === key,
    );
    if (existing) {
      setSetupKey(key);
      setSetupProviderId(existing.id);
      gotoStep("provider-models");
    } else {
      setSetupKey(key);
      setSetupProviderId(null);
      gotoStep("provider-key");
    }
  };

  const handleSaveProvider = async (name: string, baseUrl: string, apiKey: string) => {
    const builtinKey = setupKey && setupKey !== "custom" ? setupKey : undefined;
    await createProvider(name, baseUrl, apiKey, [], builtinKey);
    const all = await fetchProviders();
    const created = all.find((p) =>
      builtinKey ? p.builtinKey === builtinKey : !p.builtinKey && p.name === name,
    );
    if (!created) throw new Error("Provider was saved but could not be found");
    setSetupProviderId(created.id);
    gotoStep("provider-models");
  };

  const handleAddModels = async (names: string[]) => {
    if (!setupProviderId) return;
    for (const name of names) {
      await addModel(setupProviderId, { id: crypto.randomUUID(), name });
    }
    if (!settings.defaultModel && names.length > 0) {
      await updateSettings({ defaultModel: names[0] });
    }
  };

  const handleFinish = () => {
    markOnboardingDone();
    onFinish();
  };

  return (
    <div className="relative flex h-dvh flex-col bg-background text-foreground">
      <PatternBackground pattern={settings.backgroundPattern} />
      <div data-tauri-drag-region className="h-10 w-full shrink-0" />

      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="relative z-10 flex h-[80dvh] max-h-full w-[80%] flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
          <header className="shrink-0 px-6 pt-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-6">
              <div className="flex items-center justify-center gap-2">
                {TOP_STEPS.map((t, i) => {
                  const active = i === topIndex;
                  const done = i < topIndex;
                  return (
                    <div key={t.label} className="flex items-center gap-2">
                      {i > 0 && <div className="h-px w-6 bg-border" />}
                      <button
                        type="button"
                        onClick={() => gotoStep(t.steps[0])}
                        title={`Go to ${t.label}`}
                        className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-75"
                      >
                        <span
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full text-[11px] font-medium transition-colors",
                            done && "bg-primary text-primary-foreground",
                            active && "bg-primary/15 text-primary ring-1 ring-primary/40",
                            !done && !active && "bg-muted text-muted-foreground",
                          )}
                        >
                          {done ? <Check className="size-3" /> : i + 1}
                        </span>
                        <span
                          className={cn(
                            "hidden text-xs sm:block",
                            active ? "font-medium text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {t.label}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
              <div
                ref={setHeaderBox}
                className="flex min-h-20 flex-col items-center justify-center gap-2 text-center"
              />
            </div>
          </header>

          <main ref={mainRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-8">
            <div className="mx-auto my-auto w-full max-w-3xl">
              <div key={step} className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            {step === "welcome" && (
              <WelcomeStep
                initialName={settings.nickname}
                headerBox={headerBox}
                footerBox={footerBox}
                onNext={(name) => {
                  if (name) void updateSettings({ nickname: name });
                  gotoStep("theme");
                }}
              />
            )}

            {step === "theme" && (
              <ThemeStep
                headerBox={headerBox}
                footerBox={footerBox}
                onBack={() => gotoStep("welcome")}
                onNext={() => gotoStep("providers")}
              />
            )}

            {step === "providers" && (
              <ProvidersStep
                providers={providers}
                headerBox={headerBox}
                footerBox={footerBox}
                onSelect={handleSelectProvider}
                onContinue={() => gotoStep("skills")}
                onBack={() => gotoStep("theme")}
              />
            )}

            {step === "provider-key" && setupMeta && setupBuiltin && (
              <ProviderKeyStep
                meta={setupMeta}
                baseUrl={setupBuiltin.baseUrl}
                headerBox={headerBox}
                footerBox={footerBox}
                onSave={handleSaveProvider}
                onBack={() => gotoStep("providers")}
              />
            )}

            {step === "provider-models" && setupMeta && setupProvider && (
              <ProviderModelsStep
                provider={setupProvider}
                meta={setupMeta}
                headerBox={headerBox}
                footerBox={footerBox}
                onAddModels={handleAddModels}
                onDone={() => gotoStep("providers")}
                onBack={() => gotoStep("providers")}
              />
            )}

            {step === "skills" && (
              <SkillsStep
                headerBox={headerBox}
                footerBox={footerBox}
                onBack={() => gotoStep("providers")}
                onNext={() => gotoStep("connectors")}
              />
            )}

            {step === "connectors" && (
              <ConnectorsStep
                headerBox={headerBox}
                footerBox={footerBox}
                onBack={() => gotoStep("skills")}
                onNext={() => gotoStep("done")}
              />
            )}

            {step === "done" && (
              <div className="flex flex-col items-center gap-4 py-10 text-center">
                <PartyPopper className="size-12 text-primary" />
                <h1 className="text-3xl font-semibold tracking-tight">
                  You're all set!
                </h1>
                <p className="max-w-md text-sm text-muted-foreground">
                  {`${
                    settings.nickname ? `Nice to meet you, ${settings.nickname}. ` : ""
                  }Your providers, skills, and connectors are ready. You can fine-tune everything anytime in Settings.`}
                </p>
                <StepFooter target={footerBox}>
                  <div className="flex w-full items-center justify-end">
                    <Button size="lg" onClick={handleFinish}>
                      Start chatting
                    </Button>
                  </div>
                </StepFooter>
              </div>
            )}
              </div>
            </div>
          </main>

          <footer className="shrink-0 border-t bg-background px-6 py-4">
            <div ref={setFooterBox} className="w-full" />
          </footer>
        </div>
      </div>
    </div>
  );
}
