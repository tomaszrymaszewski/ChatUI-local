// Model Council — a single-layer Mixture-of-Agents over the app's existing
// multi-provider completion layer: the configured council models answer the
// same prompt in parallel (live per-model cards), then the currently selected
// model chairs an aggregation pass that streams the verdict (consensus /
// disagreements / final answer). Only the verdict + member list is persisted
// (see ChatView's onVerdict wiring) — member responses are ephemeral.

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Provider } from "@/types";
import { streamChatCompletion, type ChatCompletionMessage } from "@/lib/llm";

const STORAGE_KEY = "chatui:council-models";

/** Cap on how many models sit on the council at once. */
export const MAX_COUNCIL_MODELS = 4;

export type CouncilPhase = "members" | "verdict";

export interface CouncilMember {
  model: string;
  providerName: string;
  status: "pending" | "streaming" | "done" | "error";
  content: string;
  error?: string;
}

export interface UseModelCouncilOptions {
  providers: Provider[];
  selectedModel: string;
  /** Persists the finished verdict (+ member list). Awaited before streaming state clears, so the chat never flashes empty between the streamed verdict and the persisted message (mirrors useDeepResearch's onReport ordering). */
  onVerdict?: (verdict: string, memberLabels: string[]) => Promise<void>;
}

export interface UseModelCouncilResult {
  /** Effective council roster (model names) — stored selection if valid, else the computed default. */
  councilModels: string[];
  toggleModel: (name: string) => void;
  isRunning: boolean;
  phase: CouncilPhase | null;
  members: CouncilMember[];
  /** Streaming verdict text (aggregator output). */
  verdict: string;
  start: (messages: ChatCompletionMessage[], instructions?: string, skillsContext?: string) => Promise<void>;
  cancel: () => void;
}

const AGGREGATOR_SYSTEM_PROMPT = `You are the impartial chair of a model council. Several models have independently answered the same question; your job is to synthesize their responses into the council's final verdict.

Weigh each response on accuracy, reasoning, and completeness — not on confidence or length. Output clean markdown with exactly these sections, in this order:

## Consensus
The points all (or most) members agree on.

## Disagreements
Where members diverge — for each, state the positions and the strongest argument on each side.

## Final Answer
Your synthesized, definitive answer to the question, drawing on the strongest points from all members.`;

function loadSelection(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveSelection(models: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
}

function messageText(content: ChatCompletionMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

export function useModelCouncil({ providers, selectedModel, onVerdict }: UseModelCouncilOptions): UseModelCouncilResult {
  const [storedSelection, setStoredSelection] = useState<string[]>(loadSelection);
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<CouncilPhase | null>(null);
  const [members, setMembers] = useState<CouncilMember[]>([]);
  const [verdict, setVerdict] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const allModels = useMemo(
    () =>
      providers.flatMap((p) =>
        p.models.map((m) => ({ name: m.name, providerId: p.id, providerName: p.name })),
      ),
    [providers],
  );

  // Default roster: the currently selected model, plus one model from each
  // other provider, capped at MAX_COUNCIL_MODELS.
  const defaultSelection = useCallback((): string[] => {
    const result: string[] = [];
    const seenProviders = new Set<string>();
    const selected = allModels.find((m) => m.name === selectedModel);
    if (selected) {
      result.push(selected.name);
      seenProviders.add(selected.providerId);
    }
    for (const m of allModels) {
      if (result.length >= MAX_COUNCIL_MODELS) break;
      if (seenProviders.has(m.providerId)) continue;
      seenProviders.add(m.providerId);
      result.push(m.name);
    }
    return result;
  }, [allModels, selectedModel]);

  const validStored = storedSelection.filter((name) => allModels.some((m) => m.name === name));
  const councilModels = validStored.length > 0 ? validStored : defaultSelection();

  const toggleModel = useCallback(
    (name: string) => {
      const current = storedSelection.filter((n) => allModels.some((m) => m.name === n));
      const base = current.length > 0 ? current : defaultSelection();
      const next = base.includes(name) ? base.filter((n) => n !== name) : [...base, name];
      saveSelection(next);
      setStoredSelection(next);
    },
    [storedSelection, allModels, defaultSelection],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const start = useCallback(
    async (messages: ChatCompletionMessage[], instructions?: string, skillsContext?: string): Promise<void> => {
      if (isRunning) return;

      const participants = councilModels
        .map((name) => {
          const meta = allModels.find((m) => m.name === name);
          const provider = meta ? providers.find((p) => p.id === meta.providerId) : undefined;
          return meta && provider ? { model: name, providerName: provider.name, provider } : null;
        })
        .filter((p): p is { model: string; providerName: string; provider: Provider } => p !== null);

      if (participants.length < 2) {
        toast.error("Council needs at least 2 models — pick more in the Council picker.");
        return;
      }

      setIsRunning(true);
      setPhase("members");
      setVerdict("");

      const controller = new AbortController();
      controllerRef.current = controller;

      // Members deliberate on text only — tool loops and image parts stay out of the fan-out.
      const memberMessages: ChatCompletionMessage[] = messages.map((m) => ({
        role: m.role,
        content: messageText(m.content),
      }));

      const acc: CouncilMember[] = participants.map((p) => ({
        model: p.model,
        providerName: p.providerName,
        status: "pending",
        content: "",
      }));
      const publish = () => setMembers(acc.map((m) => ({ ...m })));
      publish();

      try {
        await Promise.all(
          participants.map((p, i) =>
            (async () => {
              acc[i] = { ...acc[i], status: "streaming" };
              publish();
              try {
                for await (const chunk of streamChatCompletion(
                  p.provider,
                  p.model,
                  memberMessages,
                  controller.signal,
                  undefined,
                  instructions,
                  skillsContext,
                )) {
                  if (chunk.content) {
                    acc[i] = { ...acc[i], content: acc[i].content + chunk.content };
                    publish();
                  }
                }
                acc[i] = { ...acc[i], status: "done" };
                publish();
              } catch (error) {
                acc[i] = {
                  ...acc[i],
                  status: "error",
                  error: controller.signal.aborted ? "Cancelled" : error instanceof Error ? error.message : "Failed",
                };
                publish();
              }
            })(),
          ),
        );

        if (controller.signal.aborted) return;

        const succeeded = acc.filter((m) => m.status === "done" && m.content.trim().length > 0);
        if (succeeded.length === 0) {
          toast.error("All council models failed — check provider settings.");
          return;
        }

        // Aggregation: the currently selected model chairs and streams the verdict.
        const aggregatorMeta = allModels.find((m) => m.name === selectedModel);
        const aggregatorProvider = aggregatorMeta
          ? providers.find((p) => p.id === aggregatorMeta.providerId)
          : undefined;
        if (!aggregatorProvider) {
          toast.error("No provider for the selected model — can't synthesize the council verdict.");
          return;
        }

        setPhase("verdict");

        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const question = lastUser ? messageText(lastUser.content) : "";
        const responsesBlock = succeeded
          .map((m, i) => `### Response ${i + 1} — ${m.model} (${m.providerName})\n${m.content.trim()}`)
          .join("\n\n---\n\n");
        const aggregatorMessage = `Question:\n${question}\n\nCouncil responses:\n${responsesBlock}\n\nWrite the council's final verdict now.`;

        let fullVerdict = "";
        try {
          for await (const chunk of streamChatCompletion(
            aggregatorProvider,
            selectedModel,
            [{ role: "user", content: aggregatorMessage }],
            controller.signal,
            undefined,
            AGGREGATOR_SYSTEM_PROMPT,
            undefined,
          )) {
            if (chunk.content) {
              fullVerdict += chunk.content;
              setVerdict(fullVerdict);
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        }

        if (fullVerdict && onVerdict) {
          const memberLabels = succeeded.map((m) => `${m.model} (${m.providerName})`);
          await onVerdict(fullVerdict, memberLabels);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : "Council failed");
        }
      } finally {
        setIsRunning(false);
        setPhase(null);
        setMembers([]);
        setVerdict("");
        controllerRef.current = null;
      }
    },
    [isRunning, councilModels, allModels, providers, selectedModel, onVerdict],
  );

  return { councilModels, toggleModel, isRunning, phase, members, verdict, start, cancel };
}
