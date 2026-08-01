import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ChatView } from "@/components/ChatView";
import { AgentView } from "@/components/AgentView";
import { cn } from "@/lib/utils";

type Tab = "chat" | "agent";

function App() {
  const [activeTab] = useState<Tab>("chat");

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">

      <main className="min-h-0 flex-1">
        <div className={cn("h-full", activeTab !== "chat" && "hidden")}>
          <ChatView />
        </div>
        <div className={cn("h-full", activeTab !== "agent" && "hidden")}>
          <AgentView />
        </div>
      </main>

      <Toaster />
    </div>
  );
}

export default App;
