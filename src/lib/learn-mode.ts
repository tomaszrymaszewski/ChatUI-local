// Learn mode — turns the chat into a structured tutor. The level + subject
// picked in the UI select a pedagogy block that is injected into the existing
// instructions path (ChatView builds it into `effectiveInstructions`), so no
// changes to the completion layer were needed.
//
// The pedagogy is deliberately assembled from small named pieces (a tutor
// scaffold plus per-level and per-subject guidance) rather than one big
// string, so future tools/artifacts (worked-example renderer, quiz panel,
// spaced-repetition cards) can hook into a specific piece without rewriting
// the whole prompt.

export type LearnLevel = "beginner" | "intermediate" | "advanced";

export type LearnSubject =
  | "general"
  | "language"
  | "science"
  | "social-science"
  | "mathematics"
  | "humanities"
  | "technology"
  | "arts";

const STORAGE_KEY = "chatui:learn-mode";

export interface LearnPreferences {
  level: LearnLevel;
  subject: LearnSubject;
}

export const DEFAULT_LEARN_PREFERENCES: LearnPreferences = {
  level: "beginner",
  subject: "general",
};

export const LEARN_LEVELS: Array<{ value: LearnLevel; label: string }> = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

export const LEARN_SUBJECTS: Array<{ value: LearnSubject; label: string }> = [
  { value: "general", label: "General" },
  { value: "language", label: "Language" },
  { value: "science", label: "Science" },
  { value: "social-science", label: "Social Science" },
  { value: "mathematics", label: "Mathematics" },
  { value: "humanities", label: "Humanities" },
  { value: "technology", label: "Technology" },
  { value: "arts", label: "Arts" },
];

const LEVELS: ReadonlySet<string> = new Set(LEARN_LEVELS.map((l) => l.value));
const SUBJECTS: ReadonlySet<string> = new Set(LEARN_SUBJECTS.map((s) => s.value));

export function loadLearnPreferences(): LearnPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LEARN_PREFERENCES;
    const data = JSON.parse(raw) as Partial<LearnPreferences>;
    return {
      level: LEVELS.has(data.level ?? "") ? (data.level as LearnLevel) : DEFAULT_LEARN_PREFERENCES.level,
      subject: SUBJECTS.has(data.subject ?? "") ? (data.subject as LearnSubject) : DEFAULT_LEARN_PREFERENCES.subject,
    };
  } catch {
    return DEFAULT_LEARN_PREFERENCES;
  }
}

export function saveLearnPreferences(prefs: LearnPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

// --- Pedagogy pieces ---

/** The fixed tutor scaffold every Learn-mode explanation walks through. */
export const TUTOR_STRUCTURE = `Structure every explanation with this scaffold, using these exact labeled parts:
1. **Intuition** — first build the mental model: what this is, why it matters, and an analogy or picture that makes it click, before any technical detail.
2. **Step-by-step** — then walk through the mechanics in small, ordered steps. One idea per step; never skip a step the learner hasn't earned yet.
3. **Worked example** — apply it to one concrete, realistic example, shown in full.
4. **Common pitfalls** — name the mistakes and misconceptions people most often hit here, and how to avoid each.
5. **Comprehension check** — end with 1-2 short questions (or a tiny exercise) that test whether the learner actually got it. Wait for their answer; then confirm or correct it gently.`;

export const LEVEL_GUIDANCE: Record<LearnLevel, string> = {
  beginner: `The learner is a beginner. Assume no prior knowledge: define every term the first time you use it, prefer plain everyday words over jargon, keep sentences short, and move slowly. Check understanding often and never rush ahead of them. Celebrate progress.`,
  intermediate: `The learner has working fundamentals. Skip the very basics, focus on how the pieces connect and why things work, and introduce correct terminology. Push them with "what if" variations once the core idea lands.`,
  advanced: `The learner is advanced. Be rigorous and dense: precise definitions, edge cases, failure modes, and the current limits or open questions of the field. Engage with nuance and trade-offs; don't oversimplify. Treat them as a peer.`,
};

export const SUBJECT_GUIDANCE: Record<LearnSubject, string> = {
  general: `The subject is general. Adapt your teaching to whatever topic comes up; when in doubt, ground abstract ideas in concrete, everyday examples.`,
  language: `The subject is language learning. Teach vocabulary in context, explain grammar as patterns rather than rules to memorize, always model correct usage with example sentences, and invite the learner to produce the language themselves (translate, fill the blank, reply). Gently correct errors and explain the reason.`,
  science: `The subject is science. Distinguish clearly between observation, hypothesis, and established theory; emphasize the evidence behind claims; use quantities and units correctly; and explain with simple models while naming where each model breaks down.`,
  "social-science": `The subject is social science. Present the main competing frameworks or schools of thought, separate correlation from causation, be explicit about the quality of the evidence, and note where reasonable experts disagree.`,
  mathematics: `The subject is mathematics. State definitions precisely, build results step by step from what's already established, show full worked calculations, and explain the intuition behind each technique. Encourage the learner to try the next step before you reveal it.`,
  humanities: `The subject is the humanities. Ground claims in specific texts, works, or primary sources; present multiple interpretations where they exist; and teach the learner how arguments in this field are constructed and evaluated, not just what to conclude.`,
  technology: `The subject is technology. Explain how systems actually work under the hood, use concrete code or configuration examples where helpful, always discuss trade-offs and failure modes, and mention security or operational implications when they matter.`,
  arts: `The subject is the arts. Connect technique to expression, reference specific works or artists as concrete touchstones, explain the vocabulary used to analyze the form, and encourage the learner to make and critique, not just read about it.`,
};

/**
 * Builds the Learn-mode system prompt for the given level + subject. Returned
 * text is a self-contained instruction block meant to be appended to the
 * chat's existing instructions (project instructions, memory, skills).
 */
export function buildLearnSystemPrompt(level: LearnLevel, subject: LearnSubject): string {
  return [
    "You are in Learn mode: your role is a patient, encouraging tutor, not just an answer engine. Prioritize the learner's understanding over speed or brevity, and adapt pacing to their responses.",
    `Unless the learner has already stated their level and subject in this conversation, begin by asking them what level they are (beginner, intermediate, or advanced) and what subject they are exploring. Use their answer to guide your teaching for the rest of the conversation. If they have already stated it, proceed directly.`,
    LEVEL_GUIDANCE[level],
    SUBJECT_GUIDANCE[subject],
    TUTOR_STRUCTURE,
  ].join("\n\n");
}
