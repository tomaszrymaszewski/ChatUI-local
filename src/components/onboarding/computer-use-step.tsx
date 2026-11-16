import { ArrowLeft, ArrowRight, Monitor, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import { ComputerUseSetup } from "@/components/computer-use-setup";
import { useUserSettings } from "@/hooks/use-user-settings";
import { cn } from "@/lib/utils";

/**
 * Onboarding opt-in for desktop Computer Use (open-computer-use). Off by
 * default — the user explicitly turns it on here. Writes straight to global
 * settings (UserSettings.desktopComputerUse), the same pattern as the theme
 * step, so the choice is saved alongside the rest of onboarding.
 */
export function ComputerUseStep({
  onNext,
  onBack,
  headerBox,
  footerBox,
}: {
  onNext: () => void;
  onBack: () => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const { settings, updateSettings } = useUserSettings();
  const enabled = settings.desktopComputerUse;

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        target={headerBox}
        title="Let AI Studio use your computer"
        subtitle="Optional. You can change this anytime in Settings."
      />

      <button
        type="button"
        onClick={() => void updateSettings({ desktopComputerUse: !enabled })}
        className={cn(
          "flex items-start gap-4 rounded-xl border p-5 text-left transition-all",
          enabled ? "border-primary ring-2 ring-primary/30" : "hover:border-foreground/30",
        )}
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Monitor className="size-5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">Desktop Computer Use</span>
          <span className="text-sm text-muted-foreground">
            Agents and chat can see and control your native macOS apps — click,
            type, scroll, and read on-screen content — to finish tasks for you.
            It works in the background through the accessibility layer, so it
            doesn&apos;t move your mouse or take over your keyboard.
          </span>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => void updateSettings({ desktopComputerUse: checked })}
          onClick={(e) => e.stopPropagation()}
          aria-label="Enable desktop Computer Use"
        />
      </button>

      {/* Install + permission guidance appears once the user opts in. */}
      {enabled && <ComputerUseSetup />}

      <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <span>
          Runs entirely on your Mac. The first time an agent uses it, macOS will
          ask you to grant Accessibility and Screen Recording permission, and it
          requires the open-computer-use helper (install with{" "}
          <code className="rounded bg-background px-1 py-0.5">npm i -g open-computer-use</code>).
          AI Studio asks before anything externally visible — sending, deleting,
          or purchasing.
        </span>
      </div>

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <Button onClick={onNext}>
            Continue
            <ArrowRight />
          </Button>
        </div>
      </StepFooter>
    </div>
  );
}
