import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AccountPanel } from "@/components/account-panel";

export function AccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect your account</DialogTitle>
          <DialogDescription>
            Sync your chats, providers, and settings across devices. The app keeps
            working offline either way.
          </DialogDescription>
        </DialogHeader>
        <AccountPanel onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
