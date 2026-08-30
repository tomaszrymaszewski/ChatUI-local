import { useState } from "react";
import { ShieldCheck, Wallet, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";

export function WelcomeStep({
  initialName,
  onNext,
  headerBox,
  footerBox,
}: {
  initialName: string;
  onNext: (name: string) => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const [name, setName] = useState(initialName);

  return (
    <div className="flex flex-col gap-8">
      <StepHeader target={headerBox} title="Welcome to ChatUI" />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <ShieldCheck className="size-5" />
          <span className="text-sm font-medium">Private by design</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Your chats, keys, and settings stay on this device. Nothing is stored on some server.
          </span>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <Wallet className="size-5" />
          <span className="text-sm font-medium">You control the cost</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Use free local models, or bring your own key and pay only for what you use.
          </span>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <Sparkles className="size-5" />
          <span className="text-sm font-medium">Simple to use</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Every model in one place — no terminal, no config files, no jargon.
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="welcome-name">What should the AI call you?<span className="text-xs text-muted-foreground">Optional</span></Label>
        <Input
          id="welcome-name"
          placeholder="John"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onNext(name.trim());
          }}
        />
      </div>

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-end">
          <Button onClick={() => onNext(name.trim())}>
            Get started
            <ArrowRight />
          </Button>
        </div>
      </StepFooter>
    </div>
  );
}
