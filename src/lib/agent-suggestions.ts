/**
 * Prompt suggestions for the agent tab.
 *
 * - `NEW_AGENT_SESSION_SUGGESTIONS`: generic starters for a first message to
 *   an agent (dashboard "New Agent Session" mode, filler behind the
 *   personalized items from `sessionSuggestionsFor`).
 * - `NEW_AGENT_SUGGESTIONS`: starters describing an agent to create
 *   (dashboard "New Agent" mode — sent to the agent builder).
 * - `followUpSuggestion`: a single follow-up for an existing session,
 *   personalized to the chat: content-type rules first (code, table, long
 *   answer), then a keyword drawn from the user's own last message, then a
 *   rotation that varies per conversation (pure, no network).
 * - `sessionSuggestionsFor`: starter prompts for one picked agent,
 *   personalized with its name and its recent session titles.
 */

export const NEW_AGENT_SESSION_SUGGESTIONS: string[] = [
  "Research a topic for me and report back with cited sources",
  "Plan my week: ask me what's on, then build a prioritized schedule",
  "Help me think through a difficult decision, with trade-offs",
  "Teach me something new step by step and check my understanding",
  "Turn my rough notes into a clear, structured document",
  "Prepare me for an upcoming meeting with key points and questions",
  "Summarize a complex topic and give me the key takeaways",
  "Break a goal of mine into concrete next actions",
];

export const NEW_AGENT_SUGGESTIONS: string[] = [
  "A morning briefing agent that summarizes my day ahead",
  "A writing coach that tightens my drafts and explains every edit",
  "A code review agent that checks my work for bugs and clarity",
  "A research assistant that gathers cited facts on any topic",
  "A taskmaster that breaks my goals into daily action items",
  "A meeting prep agent that briefs me before every call",
];

const GENERIC_FOLLOW_UPS: string[] = [
  "Give me a concrete example",
  "Go deeper on this",
  "What should I do next?",
  "What am I missing?",
  "Explain it like I'm new to this",
  "What are the trade-offs?",
];

/** Small stopword set so keyword extraction keeps topical words. */
const STOPWORDS = new Set(
  "i,me,my,we,our,you,your,he,him,his,she,her,it,its,they,them,their,this,that,these,those,a,an,the,and,or,but,for,to,of,in,on,at,with,from,by,about,as,into,is,are,was,were,be,been,being,do,does,did,done,can,could,should,would,will,just,what,when,where,which,who,whom,how,why,please,thanks,thank,hi,hello,hey,ok,okay,yes,no,get,got,make,made,help,helps,need,needs,want,wants,like,very,really,more,most,some,any,all,also,than,then,there,here,now,today,tonight,thing,things,something,anything,way,ways,able,kind,sort,maybe,well,still,already,even,ever,never,always,often,mine,yours,ours".split(
    ",",
  ),
);

/**
 * The most distinctive word of a user message: the last token (topics tend
 * to come last) of length 2+ that is not a stopword. Preserves the user's
 * own casing. Undefined when the message carries no topical word
 * ("thanks!", "ok", …).
 */
export function lastKeyword(content: string): string | undefined {
  const tokens = content.match(/[A-Za-z0-9][A-Za-z0-9+.#-]*/g) ?? [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.length >= 2 && !STOPWORDS.has(token.toLowerCase())) {
      return token;
    }
  }
  return undefined;
}

/** Stable per-conversation rotation: same message → same suggestion. */
function rotatedFollowUp(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return GENERIC_FOLLOW_UPS[Math.abs(hash) % GENERIC_FOLLOW_UPS.length];
}

export interface SuggestionMessage {
  role: string;
  content: string;
}

/**
 * One follow-up suggestion for an existing session, or null when no ghost
 * should show (no assistant reply yet, or the agent just asked the user a
 * question — they should answer, not follow up).
 */
export function followUpSuggestion(messages: SuggestionMessage[]): string | null {
  const assistant = messages.filter((m) => m.role === "assistant" && m.content.trim());
  if (assistant.length === 0) return null;
  const last = assistant[assistant.length - 1].content.trim();
  // The agent asked something — let the user answer instead of suggesting.
  if (last.endsWith("?")) return null;
  if (/```/.test(last)) return "Walk me through this code step by step";
  if (/^\s*\|.*\|\s*$/m.test(last)) return "What are the key takeaways from this table?";
  if (last.length > 1200) return "Summarize the key points";
  // Personalize with the user's own topic word when there is one.
  const user = [...messages].reverse().find((m) => m.role === "user" && m.content.trim());
  const keyword = user ? lastKeyword(user.content) : undefined;
  if (keyword) return `What else should I know about ${keyword}?`;
  return rotatedFollowUp(last);
}

export interface SuggestionAgent {
  id: string;
  name: string;
  purpose?: string;
}

export interface SuggestionSession {
  agentId?: string;
  title: string;
}

/** Max prompt suggestions shown for one picked agent. */
export const MAX_SESSION_SUGGESTIONS = 6;

/**
 * Starter prompts for one picked agent: recent session titles with that
 * agent first (continuations of this chat history), then an intro prompt
 * addressed to the agent by name, then generic starters to fill up.
 * Empty when no agent is picked — the caller shows the agent picker instead.
 */
export function sessionSuggestionsFor(
  agent: SuggestionAgent | null,
  sessions: SuggestionSession[],
): string[] {
  if (!agent) return [];
  const out: string[] = [];
  for (const session of sessions) {
    if (out.length >= 3) break;
    if (session.agentId === agent.id && session.title.trim()) {
      const item = `Follow up on "${session.title.trim()}"`;
      if (!out.includes(item)) out.push(item);
    }
  }
  out.push(`Ask ${agent.name} what it can help with`);
  for (const generic of NEW_AGENT_SESSION_SUGGESTIONS) {
    if (out.length >= MAX_SESSION_SUGGESTIONS) break;
    if (!out.includes(generic)) out.push(generic);
  }
  return out;
}
