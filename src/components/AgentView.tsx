import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function AgentView() {
  return (
    <div className="flex h-full flex-col p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Bot />
          </EmptyMedia>
          <EmptyTitle>Agent</EmptyTitle>
          <EmptyDescription>
            Autonomous agent capabilities are on the way. Switch back to the
            Chat tab to start a conversation in the meantime.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Badge variant="secondary">Coming soon</Badge>
        </EmptyContent>
      </Empty>
    </div>
  );
}
