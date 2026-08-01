import { useRef, useState } from "react";
import {
  ArrowUp,
  Brain,
  FileText,
  HatGlasses,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type {
  ChatSession,
  Message as ChatMessage,
  MessageAttachment,
} from "@/types";

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: generateId(),
  role: "assistant",
  content: "Hello! How can I help you today?",
  timestamp: new Date(),
};

const initialSessions: ChatSession[] = [
  {
    id: generateId(),
    title: "Project ideas",
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
  },
  {
    id: generateId(),
    title: "SwiftUI tips",
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
  },
];

const initialAgentSessions: ChatSession[] = [
  {
    id: generateId(),
    title: "Code Review Agent",
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3),
  },
  {
    id: generateId(),
    title: "Data Analysis Agent",
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 8),
  },
];

export function ChatView() {
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [agentSessions, setAgentSessions] = useState<ChatSession[]>(initialAgentSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState("");
  const [files, setFiles] = useState<MessageAttachment[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [model, setModel] = useState("GPT-4o");
  const [reasoning, setReasoning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );

  const comingSoon = (feature: string) => toast(`${feature} is coming soon`);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) {
      setFiles((prev) => [
        ...prev,
        ...selected.map((file) => ({
          id: generateId(),
          name: file.name,
          size: file.size,
          type: file.type,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined,
        })),
      ]);
    }
    e.target.value = "";
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((file) => file.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((file) => file.id !== id);
    });
  };

  const handleSend = () => {
    const text = inputText.trim();
    if ((!text && files.length === 0) || isThinking) return;

    const attachments = files.length > 0 ? files : undefined;
    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date(),
      attachments,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setFiles([]);
    setIsThinking(true);

    if (activeSessionId) {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === activeSessionId
            ? { ...session, updatedAt: new Date() }
            : session,
        ),
      );
    } else {
      // A new chat is only saved once the first message is actually sent
      const newSession: ChatSession = {
        id: generateId(),
        title: (text || "Attachments").slice(0, 30),
        updatedAt: new Date(),
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
    }

    window.setTimeout(() => {
      const attachmentNote = attachments?.length
        ? ` with ${attachments.length} attachment${attachments.length > 1 ? "s" : ""}`
        : "";
      const reply: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: text
          ? `You said: "${text}"${attachmentNote}. This is a simulated AI response.`
          : `Received ${attachments?.length ?? 0} attachment${(attachments?.length ?? 0) > 1 ? "s" : ""}. This is a simulated AI response.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, reply]);
      setIsThinking(false);
    }, 1200);
  };

  const handleNewChat = () => {
    // Start an unsaved draft — nothing is added to the sidebar until a
    // message is actually sent
    setActiveSessionId(null);
    setMessages([WELCOME_MESSAGE]);
  };

  const selectSession = (id: string) => {
    setActiveSessionId(id);
    setMessages([WELCOME_MESSAGE]);
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => prev.filter((session) => session.id !== id));
    setAgentSessions((prev) => prev.filter((session) => session.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([WELCOME_MESSAGE]);
    }
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <SidebarProvider
      className="relative h-full min-h-0 overflow-hidden"
      style={{ "--sidebar-width-icon": "3rem" } as React.CSSProperties}
    >
      <AppSidebar
        sessions={sessions}
        agentSessions={agentSessions}
        activeSessionId={activeSessionId}
        onSelectSession={selectSession}
        onNewChat={handleNewChat}
        onDeleteChat={deleteSession}
        onSettings={() => comingSoon("Settings")}
        onComingSoon={comingSoon}
      />

      <SidebarTrigger className="fixed left-20 top-1.5 z-50 peer-data-[state=expanded]:text-sidebar-foreground peer-data-[state=expanded]:hover:bg-sidebar-accent peer-data-[state=expanded]:hover:text-sidebar-accent-foreground" />

      <SidebarInset>
        <header className="relative flex h-10 shrink-0 items-center border-b pl-16 pr-4">
          <div data-tauri-drag-region className="absolute inset-0" />
          <h1 className="relative truncate text-sm font-medium">
            {activeSession?.title ?? "New chat"}
          </h1>
          <div className="relative ml-auto flex items-center gap-2">
            {!activeSession && (
              <HatGlasses
                className="size-4 text-muted-foreground"
                aria-label="New chat — not saved yet"
              />
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <MessageScrollerProvider
            autoScroll
            defaultScrollPosition="last-anchor"
            scrollPreviousItemPeek={64}
          >
            <MessageScroller className="flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
                  {messages.map((msg) => (
                    <MessageScrollerItem
                      key={msg.id}
                      messageId={msg.id}
                      scrollAnchor={msg.role === "user"}
                    >
                      {msg.role === "user" ? (
                        <Message align="end">
                          <MessageContent>
                            {msg.attachments?.map((attachment) => (
                              <Attachment key={attachment.id} size="sm">
                                <AttachmentMedia
                                  variant={
                                    attachment.previewUrl ? "image" : "icon"
                                  }
                                >
                                  {attachment.previewUrl ? (
                                    <img
                                      src={attachment.previewUrl}
                                      alt={attachment.name}
                                    />
                                  ) : (
                                    <FileText />
                                  )}
                                </AttachmentMedia>
                                <AttachmentContent>
                                  <AttachmentTitle>
                                    {attachment.name}
                                  </AttachmentTitle>
                                  <AttachmentDescription>
                                    {formatBytes(attachment.size)}
                                  </AttachmentDescription>
                                </AttachmentContent>
                              </Attachment>
                            ))}
                            {msg.content && (
                              <Bubble>
                                <BubbleContent>{msg.content}</BubbleContent>
                              </Bubble>
                            )}
                            <MessageFooter>
                              {formatTime(msg.timestamp)}
                            </MessageFooter>
                          </MessageContent>
                        </Message>
                      ) : (
                        <Message>
                          <MessageAvatar>
                            <Avatar>
                              <AvatarFallback>
                                <Sparkles />
                              </AvatarFallback>
                            </Avatar>
                          </MessageAvatar>
                          <MessageContent>
                            <Bubble variant="ghost">
                              <BubbleContent>{msg.content}</BubbleContent>
                            </Bubble>
                            <MessageFooter>
                              {formatTime(msg.timestamp)}
                            </MessageFooter>
                          </MessageContent>
                        </Message>
                      )}
                    </MessageScrollerItem>
                  ))}

                  {isThinking && (
                    <MessageScrollerItem messageId="thinking">
                      <Message>
                        <MessageAvatar>
                          <Avatar>
                            <AvatarFallback>
                              <Sparkles />
                            </AvatarFallback>
                          </Avatar>
                        </MessageAvatar>
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
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>

          <div className="shrink-0 px-4 pb-4">
            <div className="mx-auto w-full max-w-3xl">
              {files.length > 0 && (
                <AttachmentGroup className="mb-2">
                  {files.map((file) => (
                    <Attachment key={file.id}>
                      <AttachmentMedia
                        variant={file.previewUrl ? "image" : "icon"}
                      >
                        {file.previewUrl ? (
                          <img src={file.previewUrl} alt={file.name} />
                        ) : (
                          <FileText />
                        )}
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>{file.name}</AttachmentTitle>
                        <AttachmentDescription>
                          {formatBytes(file.size)}
                        </AttachmentDescription>
                      </AttachmentContent>
                      <AttachmentActions>
                        <AttachmentAction
                          aria-label={`Remove ${file.name}`}
                          onClick={() => removeFile(file.id)}
                        >
                          <X />
                        </AttachmentAction>
                      </AttachmentActions>
                    </Attachment>
                  ))}
                </AttachmentGroup>
              )}

              <InputGroup>
                <InputGroupTextarea
                  value={inputText}
                  onChange={(e) => setInputText(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask anything"
                  className="max-h-40 min-h-12"
                />
                <InputGroupAddon align="block-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Attach files"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip />
                  </InputGroupButton>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFiles}
                  />

                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger
                      size="sm"
                      className="border-0 bg-transparent shadow-none dark:bg-transparent"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GPT-4o">GPT-4o</SelectItem>
                      <SelectItem value="Claude 3.5">Claude 3.5</SelectItem>
                      <SelectItem value="Llama 3">Llama 3</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="ml-1 flex items-center gap-1.5">
                    <Switch
                      id="reasoning"
                      checked={reasoning}
                      onCheckedChange={setReasoning}
                    />
                    <label
                      htmlFor="reasoning"
                      className="flex items-center gap-1 text-sm text-muted-foreground"
                    >
                      <Brain className="size-3.5" />
                      Reasoning
                    </label>
                  </div>

                  <div className="flex-1" />

                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    className="rounded-full"
                    onClick={handleSend}
                    disabled={
                      (!inputText.trim() && files.length === 0) || isThinking
                    }
                    aria-label="Send message"
                  >
                    <ArrowUp />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>

              <p className="mt-2 text-center text-xs text-muted-foreground">
                ChatUI can make mistakes. Check important information.
              </p>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
