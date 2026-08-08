import { useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleFadingPlus,
  Plug,
  Server,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Spinner } from "@/components/ui/spinner";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Message,
  MessageContent,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useOpencode } from "@/hooks/use-opencode";
import type { OCMessageEntry, OCPart } from "@/lib/opencode";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderPart(part: OCPart, key: string) {
  switch (part.type) {
    case "text":
      return (
        <Bubble key={key} variant="ghost">
          <BubbleContent className="whitespace-pre-wrap">{part.text}</BubbleContent>
        </Bubble>
      );

    case "reasoning":
      return (
        <details key={key} className="mb-1" open>
          <summary className="cursor-pointer select-none text-xs text-muted-foreground">
            Reasoning
          </summary>
          <div className="mt-1 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground italic whitespace-pre-wrap">
            {part.text}
          </div>
        </details>
      );

    case "tool": {
      const status = part.state?.status ?? "pending";
      const title = part.state?.title ?? part.tool;
      return (
        <div
          key={key}
          className="my-1 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
        >
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">{part.tool}</span>
          <span className="text-muted-foreground">— {title}</span>
          {status === "running" && <Spinner className="size-3" />}
          {status === "completed" && (
            <Check className="size-3.5 text-green-500" />
          )}
          {status === "error" && <X className="size-3.5 text-destructive" />}
        </div>
      );
    }

    case "step-start":
      return null;

    case "step-finish":
      return null;

    default:
      return null;
  }
}

function renderMessage(entry: OCMessageEntry) {
  const { info, parts } = entry;
  const visibleParts = parts.filter(
    (p) => p.type !== "step-start" && p.type !== "step-finish"
  );

  return (
    <MessageScrollerItem key={info.id} messageId={info.id}>
      <Message>
        <MessageContent>
          {visibleParts.length === 0 && info.role === "assistant" ? (
            <Marker role="status">
              <MarkerIcon>
                <Spinner />
              </MarkerIcon>
              <MarkerContent className="shimmer">Thinking…</MarkerContent>
            </Marker>
          ) : (
            visibleParts.map((part) => renderPart(part, part.id))
          )}
          {info.time.completed && (
            <span className="mt-1 block text-[10px] text-muted-foreground">
              {formatTime(info.time.completed)}
            </span>
          )}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

function ConnectionForm({
  onConnect,
  connecting,
}: {
  onConnect: (url: string, password?: string) => void;
  connecting: boolean;
}) {
  const [url, setUrl] = useState("http://localhost:4096");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onConnect(url.trim(), password.trim() || undefined);
  };

  return (
    <div className="flex h-[calc(100dvh-2.5rem)] items-center justify-center p-6 overflow-y-auto">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-5" />
            Connect to OpenCode
          </CardTitle>
          <CardDescription>
            Connect to a running <code className="text-xs">opencode serve</code> instance.
            Make sure to start it with{" "}
            <code className="text-xs">--cors &quot;*&quot;</code> to allow connections
            from this app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="oc-url">Server URL</Label>
              <Input
                id="oc-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:4096"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="oc-password">
                Password <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="oc-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Only if OPENCODE_SERVER_PASSWORD is set"
              />
            </div>
            <Button type="submit" disabled={connecting}>
              {connecting ? (
                <>
                  <Spinner className="size-4" />
                  Connecting…
                </>
              ) : (
                <>
                  <Plug className="size-4" />
                  Connect
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
}: {
  sessions: Array<{ id: string; title: string; time: { created: number; updated: number } }>;
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-sm font-medium">Agent Sessions</span>
        <Button size="sm" onClick={onCreate}>
          <CircleFadingPlus className="size-4" />
          New Session
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="px-4 pb-4 flex flex-col gap-2">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Bot className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No agent sessions yet. Create one to get started.
              </p>
              <Button variant="outline" onClick={onCreate}>
                <CircleFadingPlus className="size-4" />
                New Session
              </Button>
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={`group flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent ${
                  activeSessionId === s.id ? "bg-accent" : ""
                }`}
                onClick={() => onSelect(s.id)}
              >
                <ChevronRight className="size-4 text-muted-foreground" />
                <div className="flex flex-1 flex-col min-w-0">
                  <span className="truncate text-sm font-medium">{s.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(s.time.updated).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    {formatTime(s.time.updated)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function AgentInputBar({
  inputText,
  setInputText,
  onSend,
  isBusy,
  onAbort,
  agents,
  selectedAgent,
  setSelectedAgent,
  disabled,
}: {
  inputText: string;
  setInputText: (v: string) => void;
  onSend: () => void;
  isBusy: boolean;
  onAbort: () => void;
  agents: Array<{ name: string; description?: string }>;
  selectedAgent: string;
  setSelectedAgent: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="mx-auto w-full max-w-3xl">
        <InputGroup>
          <InputGroupTextarea
            value={inputText}
            onChange={(e) => setInputText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={disabled ? "Connect to OpenCode to start…" : "Ask opencode…"}
            className="max-h-40 min-h-12"
            disabled={disabled}
          />
          <InputGroupAddon align="block-end">
            {agents.length > 0 && (
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.name} value={a.name}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex-1" />
            {isBusy ? (
              <InputGroupButton
                variant="outline"
                size="icon-xs"
                className="rounded-lg"
                onClick={onAbort}
                aria-label="Stop generation"
              >
                <span className="size-3 rounded-sm bg-current" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                variant="default"
                size="icon-xs"
                className="rounded-lg"
                onClick={onSend}
                disabled={disabled || !inputText.trim()}
                aria-label="Send message"
              >
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          OpenCode agents can make mistakes. Check important information.
        </p>
      </div>
    </div>
  );
}

export function AgentView() {
  const oc = useOpencode();
  const [inputText, setInputText] = useState("");

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || oc.isBusy || !oc.connected) return;
    setInputText("");
    oc.sendMessage(text);
  };

  if (!oc.connected) {
    return (
      <ConnectionForm
        onConnect={async (url, password) => {
          try {
            await oc.connect(url, password);
            toast.success("Connected to OpenCode");
          } catch (err) {
            toast.error(
              err instanceof Error
                ? `Connection failed: ${err.message}`
                : "Connection failed"
            );
          }
        }}
        connecting={oc.connecting}
      />
    );
  }

  return (
    <div className="flex h-[calc(100dvh-2.5rem)] flex-col overflow-hidden">
      {oc.activeSessionId ? (
        <>
          <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => oc.selectSession(null)}
            >
              <ChevronRight className="size-4 rotate-180" />
              Sessions
            </Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Server className="size-3.5" />
              <span className="max-w-xs truncate">Connected</span>
            </div>
          </div>

          <MessageScrollerProvider
            autoScroll
            defaultScrollPosition="last-anchor"
            scrollPreviousItemPeek={64}
          >
            <MessageScroller className="flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
                  {oc.loadingMessages ? (
                    <div className="flex items-center justify-center py-12">
                      <Spinner className="size-6" />
                    </div>
                  ) : (
                    oc.messages.map((entry) => renderMessage(entry))
                  )}
                  {oc.isBusy &&
                    !oc.messages.some(
                      (e) =>
                        e.info.role === "assistant" &&
                        !e.info.time.completed &&
                        e.parts.length > 0
                    ) && (
                      <MessageScrollerItem messageId="thinking">
                        <Message>
                          <MessageContent>
                            <Marker role="status">
                              <MarkerIcon>
                                <Spinner />
                              </MarkerIcon>
                              <MarkerContent className="shimmer">
                                Thinking…
                              </MarkerContent>
                            </Marker>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>

          <AgentInputBar
            inputText={inputText}
            setInputText={setInputText}
            onSend={handleSend}
            isBusy={oc.isBusy}
            onAbort={oc.abort}
            agents={oc.agents}
            selectedAgent={oc.selectedAgent}
            setSelectedAgent={oc.setSelectedAgent}
            disabled={!oc.connected}
          />
        </>
      ) : (
        <>
          <SessionList
            sessions={oc.sessions}
            activeSessionId={oc.activeSessionId}
            onSelect={(id) => oc.selectSession(id)}
            onCreate={oc.createSession}
            onDelete={oc.deleteSession}
          />
          <AgentInputBar
            inputText={inputText}
            setInputText={setInputText}
            onSend={async () => {
              const text = inputText.trim();
              if (!text) return;
              setInputText("");
              await oc.createSession();
              if (oc.activeSessionId) {
                oc.sendMessage(text);
              } else {
                setTimeout(() => oc.sendMessage(text), 500);
              }
            }}
            isBusy={oc.isBusy}
            onAbort={oc.abort}
            agents={oc.agents}
            selectedAgent={oc.selectedAgent}
            setSelectedAgent={oc.setSelectedAgent}
            disabled={!oc.connected}
          />
        </>
      )}
    </div>
  );
}
