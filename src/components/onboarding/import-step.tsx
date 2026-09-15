import { useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StepHeader, StepFooter } from "@/components/onboarding/step-chrome";
import { ImportPanel } from "@/components/import-panel";
import type { ImportResult } from "@/lib/data-transfer";

export function ImportStep({
  onBack,
  onNext,
  headerBox,
  footerBox,
}: {
  onBack: () => void;
  onNext: () => void;
  headerBox: HTMLElement | null;
  footerBox: HTMLElement | null;
}) {
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);

  const handleImported = (result: ImportResult) => {
    setLastImport(result);
    if (result.kind === "chatui") {
      toast.success("Backup imported — your data is back");
    } else {
      const label = result.kind === "openai" ? "ChatGPT" : "Claude";
      if (result.sessions === 0) {
        toast.info(`All conversations from this ${label} export were already imported`);
      } else {
        toast.success(
          `Imported ${result.sessions} conversation${result.sessions !== 1 ? "s" : ""} from ${label}`,
        );
      }
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        target={headerBox}
        title="Bring your old chats"
        subtitle="Moving from ChatGPT, Claude, or another device? Import your history now — or skip this and do it later in Settings."
      />

      <ImportPanel onImported={handleImported} />

      {lastImport && lastImport.kind !== "chatui" && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Check className="size-4 shrink-0 text-primary" />
          {lastImport.sessions === 0
            ? "Nothing new — that export was already imported. You can import another file or continue."
            : `${lastImport.sessions} conversation${lastImport.sessions !== 1 ? "s" : ""} ready in your sidebar. You can import another file or continue.`}
        </div>
      )}

      <StepFooter target={footerBox}>
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <Button onClick={onNext}>
            {lastImport ? "Continue" : "Skip for now"}
            <ArrowRight />
          </Button>
        </div>
      </StepFooter>
    </div>
  );
}
