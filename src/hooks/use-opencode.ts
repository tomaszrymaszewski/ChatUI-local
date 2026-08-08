import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type OpenCodeServerConfig,
  type OCSession,
  type OCMessageEntry,
  type OCPart,
  type OCAgent,
  type OCEvent,
  getStoredConfig,
  saveConfig,
  clearConfig,
  checkHealth,
  listSessions,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  getMessages,
  sendMessageAsync,
  abortSession,
  listAgents,
  subscribeToEvents,
} from "@/lib/opencode";

export function useOpencode() {
  const [config, setConfig] = useState<OpenCodeServerConfig | null>(() =>
    getStoredConfig()
  );
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sessions, setSessions] = useState<OCSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OCMessageEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [agents, setAgents] = useState<OCAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const eventUnsubscribeRef = useRef<(() => void) | null>(null);
  const autoConnectAttempted = useRef(false);

  const connect = useCallback(async (url: string, password?: string) => {
    setConnecting(true);
    try {
      const newConfig: OpenCodeServerConfig = {
        url: url.replace(/\/+$/, ""),
        password: password || undefined,
      };
      const health = await checkHealth(newConfig);
      if (!health.healthy) {
        throw new Error("Server is not healthy");
      }
      saveConfig(newConfig);
      setConfig(newConfig);
      setConnected(true);

      const sess = await listSessions(newConfig);
      setSessions(sess);

      try {
        const ag = await listAgents(newConfig);
        setAgents(ag);
        const primary = ag.find((a) => a.mode === "primary" && a.builtIn);
        setSelectedAgent(primary?.name ?? "build");
      } catch {
      }
    } catch (err) {
      clearConfig();
      setConnected(false);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    if (config && !connected && !connecting && !autoConnectAttempted.current) {
      autoConnectAttempted.current = true;
      connect(config.url, config.password).catch(() => {});
    }
  }, [config, connected, connecting, connect]);

  const disconnect = useCallback(() => {
    eventUnsubscribeRef.current?.();
    eventUnsubscribeRef.current = null;
    clearConfig();
    setConfig(null);
    setConnected(false);
    setSessions([]);
    setActiveSessionId(null);
    setMessages([]);
    setIsBusy(false);
    setAgents([]);
    setSelectedAgent("");
  }, []);

  const selectSession = useCallback(
    async (id: string | null) => {
      if (!id) {
        setActiveSessionId(null);
        setMessages([]);
        return;
      }
      if (!config) return;
      setActiveSessionId(id);
      setLoadingMessages(true);
      try {
        const msgs = await getMessages(config, id);
        setMessages(msgs);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load messages"
        );
      } finally {
        setLoadingMessages(false);
      }
    },
    [config]
  );

  const handleNewSession = useCallback(async () => {
    if (!config) return;
    try {
      const sess = await apiCreateSession(config);
      setSessions((prev) => [sess, ...prev]);
      await selectSession(sess.id);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create session"
      );
    }
  }, [config, selectSession]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (!config) return;
      try {
        await apiDeleteSession(config, id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setMessages([]);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete session"
        );
      }
    },
    [config, activeSessionId]
  );

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!config || !activeSessionId || !text.trim()) return;
      const userEntry: OCMessageEntry = {
        info: {
          id: `local-${Date.now()}`,
          sessionID: activeSessionId,
          role: "user",
          time: { created: Date.now() },
        },
        parts: [
          {
            id: `local-part-${Date.now()}`,
            sessionID: activeSessionId,
            messageID: `local-${Date.now()}`,
            type: "text",
            text: text.trim(),
          },
        ],
      };
      setMessages((prev) => [...prev, userEntry]);
      setIsBusy(true);

      try {
        await sendMessageAsync(
          config,
          activeSessionId,
          text.trim(),
          selectedAgent || undefined
        );
      } catch (err) {
        setIsBusy(false);
        toast.error(
          err instanceof Error ? err.message : "Failed to send message"
        );
      }
    },
    [config, activeSessionId, selectedAgent]
  );

  const handleAbort = useCallback(async () => {
    if (!config || !activeSessionId) return;
    try {
      await abortSession(config, activeSessionId);
    } catch {
    }
  }, [config, activeSessionId]);

  useEffect(() => {
    if (!config || !connected) return;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const setupSSE = () => {
      eventUnsubscribeRef.current?.();

      eventUnsubscribeRef.current = subscribeToEvents(
        config,
        (event: OCEvent) => {
          const props = event.properties as Record<string, unknown>;

          switch (event.type) {
            case "session.created": {
              const info = props.info as OCSession;
              setSessions((prev) => {
                if (prev.some((s) => s.id === info.id)) return prev;
                return [info, ...prev];
              });
              break;
            }

            case "session.updated": {
              const info = props.info as OCSession;
              setSessions((prev) =>
                prev.map((s) => (s.id === info.id ? info : s))
              );
              break;
            }

            case "session.deleted": {
              const info = props.info as OCSession;
              setSessions((prev) => prev.filter((s) => s.id !== info.id));
              if (activeSessionId === info.id) {
                setActiveSessionId(null);
                setMessages([]);
              }
              break;
            }

            case "message.updated": {
              const info = props.info as OCMessageEntry["info"];
              if (info.sessionID !== activeSessionId) break;
              setMessages((prev) => {
                const idx = prev.findIndex((e) => e.info.id === info.id);
                if (idx === -1) {
                  return [...prev, { info, parts: [] }];
                }
                const updated = [...prev];
                updated[idx] = { ...updated[idx], info };
                return updated;
              });
              break;
            }

            case "message.part.updated": {
              const part = props.part as OCPart;
              if (part.sessionID !== activeSessionId) break;
              setMessages((prev) => {
                const msgIdx = prev.findIndex(
                  (e) => e.info.id === part.messageID
                );
                if (msgIdx === -1) {
                  return [
                    ...prev,
                    {
                      info: {
                        id: part.messageID,
                        sessionID: part.sessionID,
                        role: "assistant",
                        time: { created: Date.now() },
                      },
                      parts: [part],
                    },
                  ];
                }
                const updated = [...prev];
                const entry = { ...updated[msgIdx] };
                const partIdx = entry.parts.findIndex(
                  (p) => p.id === part.id
                );
                if (partIdx === -1) {
                  entry.parts = [...entry.parts, part];
                } else {
                  entry.parts = entry.parts.map((p) =>
                    p.id === part.id ? part : p
                  );
                }
                updated[msgIdx] = entry;
                return updated;
              });
              break;
            }

            case "session.status": {
              const status = props.status as { type: string };
              setIsBusy(status.type === "busy" || status.type === "retry");
              break;
            }

            case "session.idle": {
              const sid = props.sessionID as string;
              if (sid === activeSessionId) {
                setIsBusy(false);
              }
              break;
            }

            case "session.error": {
              const err = props.error as {
                name: string;
                data: { message: string };
              };
              if (err) {
                toast.error(err.data?.message ?? "Session error");
                setIsBusy(false);
              }
              break;
            }
          }
        },
        () => {
          if (connected) {
            reconnectTimer = setTimeout(setupSSE, 3000);
          }
        }
      );
    };

    setupSSE();

    return () => {
      eventUnsubscribeRef.current?.();
      eventUnsubscribeRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [config, connected, activeSessionId]);

  return {
    connected,
    connecting,
    connect,
    disconnect,
    sessions,
    activeSessionId,
    selectSession,
    messages,
    isBusy,
    agents,
    selectedAgent,
    setSelectedAgent,
    loadingMessages,
    createSession: handleNewSession,
    deleteSession: handleDeleteSession,
    sendMessage: handleSendMessage,
    abort: handleAbort,
  };
}
