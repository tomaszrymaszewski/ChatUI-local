import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/provider-logos";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import { PROVIDER_META } from "@/lib/provider-meta";
import type { Provider } from "@/types";
import { cn } from "@/lib/utils";

export function ProvidersStep({
  providers,
  onSelect,
  onContinue,
  onBack,
  headerBox,
  footerBox,
}: {
  providers: Provider[];
  onSelect: (key: string) => void;
  onContinue: () => void;
  onBack: () => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const isConfigured = (key: string) =>
    key === "custom"
      ? providers.some((p) => !p.builtinKey)
      : providers.some((p) => p.builtinKey === key);

  const hasModels = providers.some((p) => p.models.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        target={headerBox}
        title="Connect a provider"
        subtitle="Providers give the app its brains. Pick one or more — you can add others anytime."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDER_META.map((meta) => {
          const configured = isConfigured(meta.key);
          return (
            <button
              key={meta.key}
              onClick={() => onSelect(meta.key)}
              className={cn(
                "flex flex-col gap-2.5 rounded-xl border p-4 text-left transition-all cursor-pointer",
                configured
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "hover:border-foreground/30 hover:bg-muted/50",
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <ProviderLogo logoKey={meta.logoKey} className="size-5" />
                </div>
                {configured && (
                  <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="size-3" />
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{meta.name}</span>
                <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {meta.tagline}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={onContinue} disabled={!hasModels}>
              Continue
              <ArrowRight />
            </Button>
            {!hasModels && (
              <span className="text-xs text-muted-foreground">
                Add at least one provider with a model to continue
              </span>
            )}
          </div>
        </div>
      </StepFooter>
    </div>
  );
}
