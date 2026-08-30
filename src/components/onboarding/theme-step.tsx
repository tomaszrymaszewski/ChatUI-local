import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { BackgroundPatternPicker } from "@/components/background-pattern";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import { useUserSettings } from "@/hooks/use-user-settings";
import { cn } from "@/lib/utils";

export function ThemePreview({ variant }: { variant: "light" | "dark" | "system" }) {
  const bg = variant === "dark" ? "#18181b" : "#ffffff";
  const panel = variant === "dark" ? "#27272a" : "#f4f4f5";
  const bubbleAi = variant === "dark" ? "#3f3f46" : "#e4e4e7";
  const bubbleUser = variant === "dark" ? "#2563eb" : "#3b82f6";
  const text = variant === "dark" ? "#a1a1aa" : "#a1a1aa";

  return (
    <svg viewBox="0 0 200 130" className="w-full rounded-lg border" role="img">
      <rect width="200" height="130" rx="8" fill={bg} />
      <rect x="0" y="0" width="52" height="130" rx="8" fill={panel} />
      <rect x="8" y="10" width="36" height="6" rx="3" fill={text} opacity="0.7" />
      <rect x="8" y="24" width="36" height="6" rx="3" fill={text} opacity="0.4" />
      <rect x="8" y="38" width="36" height="6" rx="3" fill={text} opacity="0.4" />
      <rect x="64" y="16" width="86" height="14" rx="7" fill={bubbleAi} />
      <rect x="90" y="38" width="98" height="14" rx="7" fill={bubbleUser} />
      <rect x="64" y="60" width="110" height="14" rx="7" fill={bubbleAi} />
      <rect x="104" y="82" width="84" height="14" rx="7" fill={bubbleUser} />
      <rect x="64" y="106" width="124" height="12" rx="6" fill={panel} stroke={text} strokeOpacity="0.3" />
    </svg>
  );
}

export function SystemPreview() {
  return (
    <svg viewBox="0 0 200 130" className="w-full rounded-lg border" role="img">
      <defs>
        <clipPath id="onb-sys-left">
          <rect x="0" y="0" width="100" height="130" />
        </clipPath>
        <clipPath id="onb-sys-right">
          <rect x="100" y="0" width="100" height="130" />
        </clipPath>
      </defs>
      <g clipPath="url(#onb-sys-left)">
        <rect width="200" height="130" rx="8" fill="#ffffff" />
        <rect x="0" y="0" width="52" height="130" rx="8" fill="#f4f4f5" />
        <rect x="8" y="10" width="36" height="6" rx="3" fill="#a1a1aa" opacity="0.7" />
        <rect x="8" y="24" width="36" height="6" rx="3" fill="#a1a1aa" opacity="0.4" />
        <rect x="64" y="16" width="86" height="14" rx="7" fill="#e4e4e7" />
        <rect x="90" y="38" width="98" height="14" rx="7" fill="#3b82f6" />
        <rect x="64" y="60" width="110" height="14" rx="7" fill="#e4e4e7" />
        <rect x="104" y="82" width="84" height="14" rx="7" fill="#3b82f6" />
        <rect x="64" y="106" width="124" height="12" rx="6" fill="#f4f4f5" stroke="#a1a1aa" strokeOpacity="0.3" />
      </g>
      <g clipPath="url(#onb-sys-right)">
        <rect width="200" height="130" rx="8" fill="#18181b" />
        <rect x="0" y="0" width="52" height="130" rx="8" fill="#27272a" />
        <rect x="8" y="10" width="36" height="6" rx="3" fill="#a1a1aa" opacity="0.7" />
        <rect x="8" y="24" width="36" height="6" rx="3" fill="#a1a1aa" opacity="0.4" />
        <rect x="64" y="16" width="86" height="14" rx="7" fill="#3f3f46" />
        <rect x="90" y="38" width="98" height="14" rx="7" fill="#2563eb" />
        <rect x="64" y="60" width="110" height="14" rx="7" fill="#3f3f46" />
        <rect x="104" y="82" width="84" height="14" rx="7" fill="#2563eb" />
        <rect x="64" y="106" width="124" height="12" rx="6" fill="#27272a" stroke="#a1a1aa" strokeOpacity="0.3" />
      </g>
      <line x1="100" y1="0" x2="100" y2="130" stroke="#a1a1aa" strokeOpacity="0.4" />
    </svg>
  );
}

const OPTIONS: Array<{ value: "light" | "dark" | "system"; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeStep({
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
  const { theme, setTheme } = useTheme();
  const { settings, updateSettings } = useUserSettings();

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        target={headerBox}
        title="Pick your look"
        subtitle="You can always change it later in Settings."
      />

      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">Theme</span>
        <div className="grid gap-4 sm:grid-cols-3">
          {OPTIONS.map((opt) => {
            const selected = theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border p-3 text-left transition-all",
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "hover:border-foreground/30",
                )}
              >
                {opt.value === "system" ? (
                  <SystemPreview />
                ) : (
                  <ThemePreview variant={opt.value} />
                )}
                <div className="flex items-center justify-between w-full px-1">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{opt.label}</span>
                  </div>
                  {selected && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">Background</span>
        <BackgroundPatternPicker
          value={settings.backgroundPattern}
          onChange={(value) => void updateSettings({ backgroundPattern: value })}
        />
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
