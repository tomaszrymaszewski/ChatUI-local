import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BackgroundPattern } from "@/types";

export const BACKGROUND_PATTERN_OPTIONS: Array<{
  value: BackgroundPattern;
  label: string;
}> = [
  { value: "none", label: "Blank" },
  { value: "lines", label: "Lines" },
  { value: "plus", label: "Plus" },
  { value: "dots", label: "Dots" },
];

export function PatternBackground({
  pattern,
  className,
}: {
  pattern: BackgroundPattern;
  className?: string;
}) {
  if (pattern === "none") return null;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0",
        `bg-pattern-${pattern}`,
        className,
      )}
    />
  );
}

export function BackgroundPatternPicker({
  value,
  onChange,
}: {
  value: BackgroundPattern;
  onChange: (value: BackgroundPattern) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      {BACKGROUND_PATTERN_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-col gap-3 rounded-xl border p-3 text-left transition-all",
              selected
                ? "border-primary ring-2 ring-primary/30"
                : "hover:border-foreground/30",
            )}
          >
            <div
              className={cn(
                "h-16 w-full rounded-lg border bg-background",
                opt.value !== "none" && `bg-pattern-${opt.value}`,
              )}
            />
            <div className="flex w-full items-center justify-between px-1">
              <span className="text-sm font-medium">{opt.label}</span>
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
  );
}
