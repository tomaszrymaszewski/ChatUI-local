import { useState } from "react";
import { ArrowLeft, CloudUpload, Ghost } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import { AccountPanel } from "@/components/account-panel";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export function AccountStep({
  onNext,
  headerBox,
  footerBox,
}: {
  onNext: () => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const { user, configured } = useAuth();
  const [connecting, setConnecting] = useState(false);

  // Already signed in (e.g. replaying setup): the panel shows account state.
  if (user || connecting) {
    return (
      <div className="flex flex-col gap-8">
        <StepHeader
          target={headerBox}
          title={user ? "You're connected" : "Connect your account"}
          subtitle={''}
        />
        <AccountPanel onDone={onNext} />
        {!user && (
          <StepFooter target={footerBox}>
            <div className="flex w-full items-center justify-start">
              <Button variant="ghost" onClick={() => setConnecting(false)}>
                <ArrowLeft />
                Back to options
              </Button>
            </div>
          </StepFooter>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        target={headerBox}
        title="Welcome to AI Studio"
        subtitle="Connect an account to sync your chats across devices — or stay anonymous and keep everything on this machine."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setConnecting(true)}
          disabled={!configured}
          className={cn(
            "group flex flex-col gap-3 rounded-xl border p-5 text-left transition-all",
            configured ? "hover:border-primary/50 hover:shadow-sm" : "opacity-60",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-sky-600 text-white">
            <CloudUpload className="size-5" />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Connect account</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {configured
                ? "Sign in or create an account. Your chats sync to the cloud and merge across your devices."
                : "Accounts aren't configured in this build — anonymous mode it is."}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={onNext}
          className="group flex flex-col gap-3 rounded-xl border p-5 text-left transition-all hover:border-primary/50 hover:shadow-sm"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
            <Ghost className="size-5" />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Stay anonymous</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              No account, no cloud. Everything stays on this device — you can connect later
              from the sidebar.
            </span>
          </span>
        </button>
      </div>

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-center">
          <span className="text-xs text-muted-foreground">
            Offline-friendly either way — local models keep working without a connection.
          </span>
        </div>
      </StepFooter>
    </div>
  );
}
