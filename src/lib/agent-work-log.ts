import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export interface AgentWorkLog {
  sessionId: string;
  agentId?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

/** Best-effort duration logging for signed-in users. */
export async function recordAgentWorkLog(log: AgentWorkLog): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;

    const { error } = await supabase.from("agent_work_logs").insert({
      user_id: userId,
      session_id: log.sessionId,
      agent_id: log.agentId ?? null,
      started_at: new Date(log.startedAt).toISOString(),
      ended_at: new Date(log.endedAt).toISOString(),
      duration_ms: Math.max(0, Math.round(log.durationMs)),
    });
    if (error) console.warn("[chatui] could not save agent work duration", error.message);
  } catch (error) {
    // Logging should never affect whether an agent run can finish.
    console.warn("[chatui] could not save agent work duration", error);
  }
}
