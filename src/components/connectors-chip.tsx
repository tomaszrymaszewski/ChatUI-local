import { mcpIcon } from "@/components/connectors-panel";
import { cn } from "@/lib/utils";

/** Recognizable apps shown on the composer chip. */
const CHIP_CONNECTORS = ["notion", "github", "linear", "figma"];

/**
 * Wide tab that sits on top of the new-chat composer: connector app icons on
 * the left, "Connect apps" label. Square bottom corners and a negative bottom
 * margin tuck it under the composer; on hover it slides up a little, as if
 * pulling out from behind the textbox. Clicking opens the connectors page.
 */
export function ConnectorsChip({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onClick}
        className="group -mb-2.5 flex w-[95%] items-center gap-2 rounded-t-xl border border-b-0 border-input bg-card/40 px-4 pt-1.5 pb-3.5 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur-sm transition-all duration-200 hover:-translate-y-1.5 hover:bg-card/70 hover:cursor-pointer hover:text-foreground"
      >
        <span className="flex items-center -space-x-1.5">
          {CHIP_CONNECTORS.map((id) => {
            const { Icon, tile } = mcpIcon(id);
            return (
              <span
                key={id}
                className={cn(
                  "flex size-5 items-center justify-center rounded-full ring-2 ring-card",
                  tile,
                )}
              >
                <Icon className="size-2.5" />
              </span>
            );
          })}
        </span>
        <span>Connect apps</span>
      </button>
    </div>
  );
}
