import { useEffect, useState, useCallback } from "react";
import type { AgentDefinition } from "@/types";
import {
  loadAgentDefinitions,
  deleteAgentDefinition,
  subscribeToAgents,
} from "@/lib/agents";

export function useAgents() {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);

  useEffect(() => {
    const sync = () => setAgents(loadAgentDefinitions());
    sync();
    return subscribeToAgents(sync);
  }, []);

  const deleteAgent = useCallback((id: string) => {
    deleteAgentDefinition(id);
  }, []);

  return { agents, deleteAgent };
}
