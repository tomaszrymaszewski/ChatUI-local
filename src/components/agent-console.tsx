import { useState } from "react";
import { ArrowUp } from "lucide-react";
import type { AgentDefinition, BackgroundPattern, ChatSession, Project } from "@/types";
import type { AgentUpdatePatch } from "@/lib/agents";
import { modelLabel } from "@/lib/model-display";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentSettingsForm } from "@/components/agent-settings-form";
import { PatternBackground } from "@/components/background-pattern";
import { Card, CardHeader } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The agent console (sidebar agent click): sessions and the composer take the
 * middle of the screen, the agent's instructions / preferences / access live
 * on the right panel — the same split as the project console. Sending from
 * here starts a new session with this agent.
 */
export function AgentConsole({
  agent,
  sessions,
  projects,
  models,
  sendOnEnter,
  runningIds,
  backgroundPattern,
  modelSelect,
  onUpdateAgent,
  onSelectSession,
  onSend,
}: {
  agent: AgentDefinition;
  /** This agent's sessions, newest first. */
  sessions: ChatSession[];
  projects: Project[];
  models: Array<{
    id: string;
    name: string;
    displayName?: string;
    providerId: string;
    providerName: string;
  }>;
  sendOnEnter: boolean;
  runningIds?: Set<string>;
  /** Chat-area background pattern (Settings → General); not shown behind the options panel. */
  backgroundPattern: BackgroundPattern;
  /** Composer model picker (rendered when the agent has no pinned model). */
  modelSelect: React.ReactNode;
  onUpdateAgent: (id: string, patch: AgentUpdatePatch) => void;
  onSelectSession: (id: string) => void;
  onSend: (text: string) => void;
}) {
  const [inputText, setInputText] = useState("");

  const send = () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    onSend(text);
  };

  const pinnedModel = agent.model
    ? models.find((m) => m.name === agent.model)
    : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Sessions + composer — ~60% of the width (options panel is clamped,
            so this column adapts to the window size). */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-r">
          <PatternBackground pattern={backgroundPattern} />
          <div className="relative shrink-0 p-4">
            <InputGroup>
              <InputGroupTextarea
                value={inputText}
                onChange={(e) => setInputText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (sendOnEnter && e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={`Message ${agent.name}…`}
                className="max-h-40 min-h-12"
              />
              <InputGroupAddon align="block-end">
                {agent.model ? (
                  <span
                    className="px-1.5 py-1 text-xs text-muted-foreground"
                    title={`This agent always runs on ${modelLabel(pinnedModel ?? { name: agent.model })}`}
                  >
                    {pinnedModel ? modelLabel(pinnedModel) : agent.model}
                  </span>
                ) : (
                  modelSelect
                )}
                <div className="flex-1" />
                <InputGroupButton
                  variant="default"
                  size="icon-xs"
                  className="rounded-lg"
                  onClick={send}
                  disabled={!inputText.trim()}
                  aria-label="Send message"
                >
                  <ArrowUp />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-4 pb-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm font-medium">Sessions</span>
              </div>
              <div className="flex flex-col gap-2">
                {sessions.map((session) => (
                  <Card
                    key={session.id}
                    className="gap-0 py-0 cursor-pointer transition-colors hover:bg-accent"
                    onClick={() => onSelectSession(session.id)}
                  >
                    <CardHeader className="flex items-center justify-between py-3.5">
                      <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium">
                        {session.title}
                        {runningIds?.has(session.id) && (
                          <Spinner className="size-3 shrink-0" />
                        )}
                      </span>
                      <span className="ml-4 shrink-0 text-xs text-muted-foreground">
                        {session.updatedAt.toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        {formatTime(session.updatedAt)}
                      </span>
                    </CardHeader>
                  </Card>
                ))}
                {sessions.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No sessions with {agent.name} yet. Start one above.
                  </p>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Instructions / preferences / access — ~40% of the width, clamped so
            it stays usable on narrow windows and never grows absurdly wide. */}
        <div className="flex w-2/5 min-w-[240px] max-w-[560px] shrink-0 min-h-0 flex-col">
          {/* Plain overflow panel, not ScrollArea: the radix content wrapper is
              display:table and shrink-to-fits to the widest content (rendered
              LaTeX in the system prompt), which the viewport then clips at the
              right edge with no scrollbar. A plain block resolves widths
              definitely, so wide content stays inside its own box instead. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="p-4">
              <div className="mb-4 flex items-center gap-2">
                <AgentAvatar seed={agent.id} className="size-6" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{agent.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {agent.purpose || "No purpose set"}
                  </span>
                </div>
              </div>
              <AgentSettingsForm
                agent={agent}
                onUpdate={onUpdateAgent}
                projects={projects}
                models={models}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
