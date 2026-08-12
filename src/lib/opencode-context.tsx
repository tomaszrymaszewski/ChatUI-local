import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  type OpenCodeServerConfig,
  type Session,
  type MessageEntry,
  type MessageInfo,
  type Part,
  type Agent,
  type ConfigProviders,
  type Model,
  type Permission,
  type Todo,
  type OpenCodeStatus,
  type SessionMetadata,
  getDefaultConfig,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  updateSessionTitle as apiUpdateSessionTitle,
  getMessages,
  sendMessageAsync,
  abortSession,
  summarizeSession,
  replyPermission as apiReplyPermission,
  getTodos,
  listAgents,
  getConfigProviders,
  subscribeToGlobalEvents,
  parseModelRef,
  opencodeStatus,
  opencodeInstall,
  opencodeServeStart,
  listLocalSessions,
  saveLocalSession,
  deleteLocalSession,
  updateLocalSessionTitle,
} from "@/lib/opencode";
import { ensureLspEnabled } from "@/lib/opencode-config";

interface ProjectDirectory {
  name: string;
  path: string;
  display_path: string;
}

interface OpenCodeContextValue {
  installed: boolean;
  serving: boolean;
  installing: boolean;
  starting: boolean;
  startError: string | null;
  activeDirectory: string | null;
  install: () => Promise<void>;
  startServe: () => Promise<void>;
  sessions: SessionMetadata[];
  activeSessionId: string | null;
  selectSession: (id: string | null) => void;
  messages: MessageEntry[];
  isBusy: boolean;
  loadingMessages: boolean;
  agents: Agent[];
  selectedAgent: string;
  setSelectedAgent: (agent: string) => void;
  directories: ProjectDirectory[];
  activeDirPath: string | null;
  pendingDir: string | null;
  selectDirectory: (path: string) => void;
  clearPendingDir: () => void;
  createSession: () => Promise<string | null>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  sendMessage: (text: string, tools?: Record<string, boolean>) => Promise<void>;
  sendNewMessage: (text: string, dir: string | null, tools?: Record<string, boolean>) => Promise<void>;
  abort: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  setDirectories: (dirs: ProjectDirectory[]) => void;
  providers: ConfigProviders | null;
  selectedModel: string | null;
  setSelectedModel: (model: string | null) => void;
  selectedModelInfo: Model | null;
  sessionTokens: { input: number; output: number; reasoning: number };
  sessionCost: number;
  contextLimit: number;
  compactSession: () => Promise<void>;
  autoPermissions: boolean;
  setAutoPermissions: (enabled: boolean) => void;
  pendingPermissions: Permission[];
  replyToPermission: (permissionId: string, response: "once" | "always" | "reject") => Promise<void>;
  todos: Todo[];
}

const OpenCodeContext = createContext<OpenCodeContextValue | null>(null);

export function useOpencodeContext() {
  const ctx = useContext(OpenCodeContext);
  if (!ctx) throw new Error("useOpencodeContext must be used within OpenCodeProvider");
  return ctx;
}

export function OpenCodeProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [serving, setServing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [activeDirPath, setActiveDirPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<ProjectDirectory[]>([]);
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [providers, setProviders] = useState<ConfigProviders | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [autoPermissions, setAutoPermissions] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<Permission[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);

  const config: OpenCodeServerConfig = useMemo(() => getDefaultConfig(), []);
  const eventUnsubscribeRef = useRef<(() => void) | null>(null);
  const initAttemptedRef = useRef(false);

  // Refs for stable SSE subscription (avoid reconnecting on every session switch)
  const activeSessionIdRef = useRef<string | null>(null);
  const activeDirRef = useRef<string | null>(null);
  const autoPermissionsRef = useRef(false);
  const servingRef = useRef(false);

  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { autoPermissionsRef.current = autoPermissions; }, [autoPermissions]);
  useEffect(() => { servingRef.current = serving; }, [serving]);

  const activeDirectory = useMemo(() => {
    const meta = sessions.find((s) => s.id === activeSessionId);
    return meta?.directory ?? pendingDir ?? activeDirPath ?? null;
  }, [sessions, activeSessionId, pendingDir, activeDirPath]);

  const refreshSessions = useCallback(async () => {
    try {
      const local = await listLocalSessions();
      setSessions(local);
    } catch {
      // ignore
    }
  }, []);

  const refreshProviders = useCallback(async () => {
    try {
      const info = await getConfigProviders(config);
      setProviders(info);
    } catch {
      // ignore
    }
  }, [config]);

  const loadAgents = useCallback(async () => {
    try {
      const ag = await listAgents(config);
      setAgents(ag);
      const primary = ag.find((a) => a.mode === "primary" && a.builtIn);
      setSelectedAgent(primary?.name ?? "build");
    } catch {
      // ignore
    }
  }, [config]);

  const startServe = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      await opencodeServeStart();
      setServing(true);
      // Auto-enable OpenCode's built-in LSP servers (off by default) so language
      // diagnostics work without any user setup.
      await ensureLspEnabled(null).catch(() => {});
      await loadAgents();
      await refreshProviders();
      await refreshSessions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start OpenCode server";
      setStartError(msg);
      toast.error(msg);
      throw err;
    } finally {
      setStarting(false);
    }
  }, [loadAgents, refreshSessions, refreshProviders]);

  const install = useCallback(async () => {
    setInstalling(true);
    setStartError(null);
    try {
      await opencodeInstall();
      setInstalled(true);
      toast.success("OpenCode installed successfully");
      // Start the server immediately — otherwise the first-run path dead-ends
      // on the StartingScreen forever (the init effect already ran).
      await startServe();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to install OpenCode");
      throw err;
    } finally {
      setInstalling(false);
    }
  }, [startServe]);

  // One-time init
  useEffect(() => {
    if (initAttemptedRef.current) return;
    initAttemptedRef.current = true;
    (async () => {
      try {
        const status: OpenCodeStatus = await opencodeStatus();
        setInstalled(status.installed);
        setServing(status.serving);
        if (status.serving) {
          await ensureLspEnabled(null).catch(() => {});
          await loadAgents();
          await refreshProviders();
          await refreshSessions();
        } else if (status.installed) {
          await startServe().catch(() => {});
        }
      } catch {
        // ignore
      }
    })();
  }, [startServe, loadAgents, refreshProviders, refreshSessions]);

  const selectSession = useCallback(
    async (id: string | null) => {
      if (!id) {
        setActiveSessionId(null);
        activeSessionIdRef.current = null;
        activeDirRef.current = null;
        setMessages([]);
        setTodos([]);
        setPendingPermissions([]);
        return;
      }
      const meta = sessions.find((s) => s.id === id);
      const dir = meta?.directory ?? null;
      activeSessionIdRef.current = id;
      activeDirRef.current = dir;
      setActiveSessionId(id);
      setActiveDirPath(dir);
      setPendingDir(null);
      setPendingPermissions([]);
      setLoadingMessages(true);
      try {
        const msgs = await getMessages(config, id, dir ?? undefined);
        setMessages(msgs);
        getTodos(config, id, dir ?? undefined)
          .then(setTodos)
          .catch(() => {});
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load messages");
      } finally {
        setLoadingMessages(false);
      }
    },
    [config, sessions],
  );

  const selectDirectory = useCallback((path: string) => {
    setActiveDirPath(path);
    setPendingDir(path);
    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    setMessages([]);
    setTodos([]);
  }, []);

  const clearPendingDir = useCallback(() => {
    setPendingDir(null);
    setActiveDirPath(null);
  }, []);

  const createSession = useCallback(async () => {
    try {
      const dir = activeDirPath;
      const sess = await apiCreateSession(config, undefined, dir ?? undefined);
      await saveLocalSession(sess.id, sess.title || "New Session", dir);
      await refreshSessions();
      await selectSession(sess.id);
      return sess.id;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create session");
      return null;
    }
  }, [config, activeDirPath, refreshSessions, selectSession]);

  const deleteSession = useCallback(
    async (id: string) => {
      const meta = sessions.find((s) => s.id === id);
      try {
        await apiDeleteSession(config, id, meta?.directory ?? undefined);
      } catch {
        // ignore
      }
      try {
        await deleteLocalSession(id);
      } catch {
        // ignore
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
        activeSessionIdRef.current = null;
        setMessages([]);
        setTodos([]);
      }
    },
    [config, sessions, activeSessionId],
  );

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const meta = sessions.find((s) => s.id === id);
      try {
        await apiUpdateSessionTitle(config, id, title, meta?.directory ?? undefined);
      } catch {
        // ignore
      }
      try {
        await updateLocalSessionTitle(id, title);
      } catch {
        // ignore
      }
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    },
    [config, sessions],
  );

  const buildOptimisticUser = useCallback((text: string, sessionId: string): MessageEntry => ({
    info: {
      id: `local-${Date.now()}`,
      sessionID: sessionId,
      role: "user" as const,
      time: { created: Date.now() },
      agent: selectedAgent || "build",
      model: parseModelRef(selectedModel) ?? { providerID: "", modelID: "" },
    },
    parts: [{ id: `local-part-${Date.now()}`, sessionID: sessionId, messageID: `local-${Date.now()}`, type: "text", text: text.trim() }],
  }), [selectedAgent, selectedModel]);

  const sendMessage = useCallback(
    async (text: string, tools?: Record<string, boolean>) => {
      if (!activeSessionId || !text.trim()) return;
      const dir = activeDirRef.current;
      setMessages((prev) => [...prev, buildOptimisticUser(text, activeSessionId)]);
      setIsBusy(true);
      try {
        await sendMessageAsync(
          config,
          activeSessionId,
          {
            parts: [{ type: "text", text: text.trim() }],
            agent: selectedAgent || undefined,
            model: parseModelRef(selectedModel) ?? undefined,
            tools: tools && Object.keys(tools).length > 0 ? tools : undefined,
          },
          dir ?? undefined,
        );
      } catch (err) {
        setIsBusy(false);
        toast.error(err instanceof Error ? err.message : "Failed to send message");
      }
    },
    [config, activeSessionId, selectedAgent, selectedModel, buildOptimisticUser],
  );

  const sendNewMessage = useCallback(
    async (text: string, dir: string | null, tools?: Record<string, boolean>) => {
      if (!text.trim()) return;
      try {
        const sess = await apiCreateSession(config, undefined, dir ?? undefined);
        await saveLocalSession(sess.id, text.trim().slice(0, 40), dir);
        await refreshSessions();
        activeSessionIdRef.current = sess.id;
        activeDirRef.current = dir;
        setActiveSessionId(sess.id);
        setActiveDirPath(dir);
        setPendingDir(null);
        setMessages([buildOptimisticUser(text, sess.id)]);
        setPendingPermissions([]);
        setTodos([]);
        setIsBusy(true);
        try {
          await sendMessageAsync(
            config,
            sess.id,
            {
              parts: [{ type: "text", text: text.trim() }],
              agent: selectedAgent || undefined,
              model: parseModelRef(selectedModel) ?? undefined,
              tools: tools && Object.keys(tools).length > 0 ? tools : undefined,
            },
            dir ?? undefined,
          );
        } catch (err) {
          setIsBusy(false);
          toast.error(err instanceof Error ? err.message : "Failed to send message");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create session");
      }
    },
    [config, selectedAgent, selectedModel, refreshSessions, buildOptimisticUser],
  );

  const abort = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await abortSession(config, activeSessionId, activeDirRef.current ?? undefined);
    } catch {
      // ignore
    }
  }, [config, activeSessionId]);

  const compactSession = useCallback(async () => {
    if (!activeSessionId) return;
    const model = parseModelRef(selectedModel);
    if (!model) {
      toast.error("Select a model first");
      return;
    }
    try {
      await summarizeSession(config, activeSessionId, model, activeDirRef.current ?? undefined);
      toast.success("Session summarized");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to summarize session");
    }
  }, [config, activeSessionId, selectedModel]);

  const replyToPermission = useCallback(
    async (permissionId: string, response: "once" | "always" | "reject") => {
      if (!activeSessionId) return;
      const dir = activeDirRef.current;
      try {
        await apiReplyPermission(config, activeSessionId, permissionId, response, dir ?? undefined);
      } catch {
        // ignore
      }
      setPendingPermissions((prev) => prev.filter((p) => p.id !== permissionId));
    },
    [config, activeSessionId],
  );

  // Permission auto-reply handler
  const handlePermission = useCallback((perm: Permission) => {
    if (perm.sessionID !== activeSessionIdRef.current) return;
    if (autoPermissionsRef.current) {
      void apiReplyPermission(
        config,
        perm.sessionID,
        perm.id,
        "always",
        activeDirRef.current ?? undefined,
      ).catch(() => {});
      return;
    }
    setPendingPermissions((prev) => {
      if (prev.some((p) => p.id === perm.id)) return prev;
      return [...prev, perm];
    });
  }, [config]);

  const sessionTokens = useMemo(() => {
    let input = 0, output = 0, reasoning = 0;
    for (const entry of messages) {
      const info = entry.info as MessageInfo;
      if (info.role === "assistant") {
        input += info.tokens?.input ?? 0;
        output += info.tokens?.output ?? 0;
        reasoning += info.tokens?.reasoning ?? 0;
      }
    }
    return { input, output, reasoning };
  }, [messages]);

  const sessionCost = useMemo(() => {
    let cost = 0;
    for (const entry of messages) {
      const info = entry.info as MessageInfo;
      if (info.role === "assistant") cost += info.cost ?? 0;
    }
    return cost;
  }, [messages]);

  const selectedModelInfo = useMemo<Model | null>(() => {
    if (!providers || !selectedModel) return null;
    const ref = parseModelRef(selectedModel);
    if (!ref) return null;
    const prov = providers.providers.find((p) => p.id === ref.providerID);
    return prov?.models[ref.modelID] ?? null;
  }, [providers, selectedModel]);

  const contextLimit = selectedModelInfo?.limit?.context ?? 200_000;

  // ─── SSE: single /global/event subscription for all directories ──────────
  useEffect(() => {
    if (!serving) return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const setupSSE = () => {
      eventUnsubscribeRef.current?.();
      eventUnsubscribeRef.current = subscribeToGlobalEvents(
        config,
        (gEvent) => {
          const event = gEvent.payload;
          const props = event.properties as Record<string, unknown>;
          const sid = activeSessionIdRef.current;

          switch (event.type) {
            case "session.created": {
              const info = props.info as Session;
              if (info?.id) {
                saveLocalSession(info.id, info.title || "New Session", gEvent.directory || null).catch(() => {});
                refreshSessions();
              }
              break;
            }
            case "session.updated": {
              const info = props.info as Session;
              if (info?.id) {
                setSessions((prev) =>
                  prev.map((s) =>
                    s.id === info.id
                      ? { ...s, title: info.title, updated_at: info.time.updated }
                      : s,
                  ),
                );
                updateLocalSessionTitle(info.id, info.title).catch(() => {});
              }
              break;
            }
            case "session.deleted": {
              const info = props.info as Session;
              if (info?.id) {
                setSessions((prev) => prev.filter((s) => s.id !== info.id));
                deleteLocalSession(info.id).catch(() => {});
                if (sid === info.id) {
                  setActiveSessionId(null);
                  activeSessionIdRef.current = null;
                  setMessages([]);
                  setTodos([]);
                }
              }
              break;
            }
            case "message.updated": {
              const info = props.info as MessageInfo;
              if (info.sessionID !== sid) break;
              setMessages((prev) => {
                const idx = prev.findIndex((e) => e.info.id === info.id);
                if (idx === -1) return [...prev, { info, parts: [] }];
                const updated = [...prev];
                updated[idx] = { ...updated[idx], info };
                return updated;
              });
              break;
            }
            case "message.part.updated": {
              const part = props.part as Part;
              if (part.sessionID !== sid) break;
              setMessages((prev) => {
                const msgIdx = prev.findIndex((e) => e.info.id === part.messageID);
                if (msgIdx === -1) {
                  return [
                    ...prev,
                    {
                      info: {
                        id: part.messageID,
                        sessionID: part.sessionID,
                        role: "assistant",
                        time: { created: Date.now() },
                      } as MessageInfo,
                      parts: [part],
                    },
                  ];
                }
                const updated = [...prev];
                const entry = { ...updated[msgIdx] };
                const partIdx = entry.parts.findIndex((p) => p.id === part.id);
                if (partIdx === -1) {
                  entry.parts = [...entry.parts, part];
                } else {
                  entry.parts = entry.parts.map((p) => (p.id === part.id ? part : p));
                }
                updated[msgIdx] = entry;
                return updated;
              });
              break;
            }
            case "session.status": {
              const status = props.status as { type: string };
              if (props.sessionID === sid || !props.sessionID) {
                setIsBusy(status.type === "busy" || status.type === "retry");
              }
              break;
            }
            case "session.idle": {
              if (props.sessionID === sid) setIsBusy(false);
              break;
            }
            case "session.error": {
              const err = props.error as { data?: { message: string } };
              if (err) {
                toast.error(err.data?.message ?? "Session error");
                setIsBusy(false);
              }
              break;
            }
            case "session.compacted": {
              if (props.sessionID === sid) toast.success("Session compacted");
              break;
            }
            case "permission.updated": {
              const perm = props as unknown as Permission;
              if (perm?.id) handlePermission(perm);
              break;
            }
            case "permission.replied": {
              const permissionID = props.permissionID as string;
              setPendingPermissions((prev) => prev.filter((p) => p.id !== permissionID));
              break;
            }
            case "todo.updated": {
              if (props.sessionID === sid) {
                setTodos(props.todos as Todo[]);
              }
              break;
            }
          }
        },
        () => {
          if (servingRef.current) reconnectTimer = setTimeout(setupSSE, 3000);
        },
      );
    };

    setupSSE();
    return () => {
      eventUnsubscribeRef.current?.();
      eventUnsubscribeRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [config, serving, refreshSessions, handlePermission]);

  return (
    <OpenCodeContext.Provider
      value={{
        installed,
        serving,
        installing,
        starting,
        startError,
        activeDirectory,
        install,
        startServe,
        sessions,
        activeSessionId,
        selectSession,
        messages,
        isBusy,
        loadingMessages,
        agents,
        selectedAgent,
        setSelectedAgent,
        directories,
        activeDirPath,
        pendingDir,
        selectDirectory,
        clearPendingDir,
        createSession,
        deleteSession,
        renameSession,
        sendMessage,
        sendNewMessage,
        abort,
        refreshSessions,
        setDirectories,
        providers,
        selectedModel,
        setSelectedModel,
        selectedModelInfo,
        sessionTokens,
        sessionCost,
        contextLimit,
        compactSession,
        autoPermissions,
        setAutoPermissions,
        pendingPermissions,
        replyToPermission,
        todos,
      }}
    >
      {children}
    </OpenCodeContext.Provider>
  );
}
