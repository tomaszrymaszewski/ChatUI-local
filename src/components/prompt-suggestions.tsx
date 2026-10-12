import type { ReactNode } from "react";

/**
 * Starter-prompt chips for the empty chat screen: each card is a detailed
 * vector illustration of the action plus its prompt description. Clicking a
 * card drops its prompt into the composer (some start with a mode trigger —
 * "teach me…", "research…", "discuss…" — so the matching chat mode lights up
 * as the text lands). A random handful is shown at a time; they disappear as
 * soon as the composer has any content.
 */
export interface PromptSuggestion {
  id: string;
  /** Text placed into the composer when the card is clicked. */
  prompt: string;
  /** One-line description under the graphic. */
  title: string;
  graphic: ReactNode;
}

function OrganiseDownloadsGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      {/* files sliding into the folder */}
      <g>
        <rect x="112" y="8" width="30" height="38" rx="4" className="fill-foreground/10 stroke-muted-foreground/40" strokeWidth="1.5" />
        <path d="M121 19h12M121 26h12M121 33h7" className="stroke-muted-foreground/50" strokeWidth="2" strokeLinecap="round" />
      </g>
      <rect x="98" y="22" width="30" height="38" rx="4" className="fill-card stroke-muted-foreground/40" strokeWidth="1.5" />
      <path d="M107 33h12M107 40h12M107 47h7" className="stroke-muted-foreground/50" strokeWidth="2" strokeLinecap="round" />
      <path d="M96 64c-13 10-32 12-46 5" className="stroke-blue-500" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 6" fill="none" />
      <path d="M58 73l-11-4 7-8z" className="fill-blue-500" />
      {/* folder */}
      <path d="M18 34h24l7 7h44a5 5 0 015 5v24a5 5 0 01-5 5H18a5 5 0 01-5-5V39a5 5 0 015-5z" className="fill-amber-500/80" />
      <path d="M13 46h94a5 5 0 015 5v19a5 5 0 01-5 5H18a5 5 0 01-5-5z" className="fill-amber-400" />
      <rect x="36" y="58" width="32" height="5" rx="2.5" className="fill-amber-900/30" />
      <rect x="36" y="68" width="20" height="5" rx="2.5" className="fill-amber-900/20" />
    </svg>
  );
}

function PortfolioGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      {/* browser chrome */}
      <rect x="14" y="10" width="132" height="80" rx="8" className="fill-card stroke-muted-foreground/40" strokeWidth="1.5" />
      <path d="M14 25h132" className="stroke-muted-foreground/30" strokeWidth="1.5" />
      <circle cx="24" cy="17.5" r="2.5" className="fill-rose-400" />
      <circle cx="33" cy="17.5" r="2.5" className="fill-amber-400" />
      <circle cx="42" cy="17.5" r="2.5" className="fill-emerald-400" />
      {/* profile card */}
      <circle cx="40" cy="48" r="13" className="fill-violet-500/80" />
      <circle cx="40" cy="44" r="4.5" className="fill-violet-200" />
      <path d="M31.5 57a9 9 0 0117 0" className="fill-violet-200" />
      <rect x="60" y="38" width="44" height="6" rx="3" className="fill-foreground/25" />
      <rect x="60" y="49" width="32" height="5" rx="2.5" className="fill-muted-foreground/40" />
      <rect x="60" y="59" width="24" height="10" rx="5" className="fill-blue-500" />
      {/* project grid */}
      <rect x="24" y="72" width="34" height="12" rx="4" className="fill-foreground/10 stroke-muted-foreground/30" strokeWidth="1" />
      <rect x="63" y="72" width="34" height="12" rx="4" className="fill-foreground/10 stroke-muted-foreground/30" strokeWidth="1" />
      <rect x="102" y="72" width="34" height="12" rx="4" className="fill-foreground/10 stroke-muted-foreground/30" strokeWidth="1" />
    </svg>
  );
}

function LearnGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      {/* graduation cap */}
      <path d="M80 12l38 16-38 16-38-16z" className="fill-violet-500" />
      <path d="M52 34v11c0 6 12 10 28 10s28-4 28-10V34l-28 12z" className="fill-violet-400/80" />
      <path d="M118 28v20" className="stroke-amber-400" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="118" cy="50" r="3.5" className="fill-amber-400" />
      {/* open book */}
      <path d="M80 62c-16-8-34-9-50-4v26c16-5 34-4 50 4z" className="fill-sky-400/70" />
      <path d="M80 62c16-8 34-9 50-4v26c-16-5-34-4-50 4z" className="fill-sky-400/50" />
      <path d="M80 62v26" className="stroke-muted-foreground/40" strokeWidth="1.5" />
      <path d="M38 67h30M38 73h30M38 79h22" className="stroke-foreground/20" strokeWidth="2" strokeLinecap="round" />
      <path d="M92 67h30M92 73h30M92 79h22" className="stroke-foreground/20" strokeWidth="2" strokeLinecap="round" />
      <path d="M132 12l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" className="fill-amber-400" />
    </svg>
  );
}

function ResearchGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      {/* document with a chart */}
      <rect x="26" y="12" width="74" height="76" rx="6" className="fill-card stroke-muted-foreground/40" strokeWidth="1.5" />
      <path d="M38 26h50M38 36h50M38 46h32" className="stroke-muted-foreground/40" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="38" y="60" width="10" height="16" rx="2" className="fill-blue-500/60" />
      <rect x="53" y="52" width="10" height="24" rx="2" className="fill-blue-500" />
      <rect x="68" y="66" width="10" height="10" rx="2" className="fill-blue-500/40" />
      {/* magnifier */}
      <circle cx="106" cy="58" r="22" className="fill-sky-400/15 stroke-sky-500" strokeWidth="3.5" />
      <path d="M122 74l14 14" className="stroke-sky-500" strokeWidth="5" strokeLinecap="round" />
      <path d="M97 52c4-5 12-6 17-1" className="stroke-foreground/30" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M128 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" className="fill-amber-400" />
    </svg>
  );
}

function TripGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      {/* folded map */}
      <path d="M18 20l40-10v70l-40 10z" className="fill-emerald-500/40" />
      <path d="M58 10l44 12v70l-44-12z" className="fill-emerald-500/20" />
      <path d="M102 22l40-12v70l-40 12z" className="fill-emerald-500/35" />
      <path d="M18 20l40-10 44 12 40-12" className="stroke-emerald-700/40" strokeWidth="1.5" fill="none" />
      <path d="M58 10v70M102 22v70" className="stroke-emerald-700/30" strokeWidth="1.5" />
      {/* river */}
      <path d="M62 50c12-6 26-4 42 4" className="stroke-sky-400/70" strokeWidth="6" strokeLinecap="round" fill="none" />
      {/* route */}
      <path d="M30 66c14-10 34-6 44-16s26-6 38-14" className="stroke-blue-500" strokeWidth="2.5" strokeDasharray="5 5" strokeLinecap="round" fill="none" />
      {/* pin */}
      <path d="M112 28a9 9 0 019 9c0 7-9 17-9 17s-9-10-9-17a9 9 0 019-9z" className="fill-rose-500" />
      <circle cx="112" cy="37" r="3.5" className="fill-white" />
      <circle cx="34" cy="34" r="7" className="fill-amber-400" />
    </svg>
  );
}

function ScriptGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      <rect x="18" y="12" width="124" height="76" rx="8" className="fill-zinc-900" />
      <path d="M18 27h124" className="stroke-white/10" strokeWidth="1.5" />
      <circle cx="29" cy="19.5" r="2.5" className="fill-rose-400" />
      <circle cx="38" cy="19.5" r="2.5" className="fill-amber-400" />
      <circle cx="47" cy="19.5" r="2.5" className="fill-emerald-400" />
      <path d="M30 40l6 5-6 5" className="stroke-emerald-400" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="43" y="42" width="36" height="5" rx="2.5" className="fill-sky-400" />
      <path d="M30 59l6 5-6 5" className="stroke-emerald-400" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="43" y="61" width="24" height="5" rx="2.5" className="fill-violet-400" />
      <rect x="30" y="77" width="10" height="6" rx="1.5" className="fill-amber-300" />
      <path d="M86 44h42M86 62h30" className="stroke-white/20" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function EmailGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      {/* letter */}
      <rect x="34" y="16" width="76" height="54" rx="6" className="fill-card stroke-muted-foreground/40" strokeWidth="1.5" />
      <path d="M46 31h52M46 41h52M46 51h30" className="stroke-muted-foreground/40" strokeWidth="2.5" strokeLinecap="round" />
      {/* envelope */}
      <rect x="24" y="42" width="88" height="46" rx="7" className="fill-blue-500" />
      <path d="M24 49l44 26 44-26" className="stroke-blue-200" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* sent badge */}
      <circle cx="122" cy="72" r="14" className="fill-emerald-500" />
      <path d="M115 72l5 5 9-10" className="stroke-white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SummariseGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      {/* long document */}
      <rect x="16" y="14" width="58" height="72" rx="6" className="fill-card stroke-muted-foreground/40" strokeWidth="1.5" />
      <path d="M26 27h38M26 37h38M26 47h38M26 57h38M26 67h24" className="stroke-muted-foreground/40" strokeWidth="2.5" strokeLinecap="round" />
      {/* condense arrow */}
      <path d="M82 50h18" className="stroke-blue-500" strokeWidth="3" strokeLinecap="round" />
      <path d="M97 43l10 7-10 7z" className="fill-blue-500" />
      {/* short summary */}
      <rect x="114" y="28" width="32" height="44" rx="6" className="fill-card stroke-blue-500/60" strokeWidth="1.5" />
      <path d="M122 40h16M122 50h16M122 60h10" className="stroke-blue-500/70" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M130 12l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" className="fill-amber-400" />
    </svg>
  );
}

function DiscussGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      {/* first voice */}
      <path d="M22 18h56a8 8 0 018 8v22a8 8 0 01-8 8H46l-11 11V56H22a8 8 0 01-8-8V26a8 8 0 018-8z" className="fill-blue-500" />
      <path d="M32 31h36M32 41h24" className="stroke-blue-100" strokeWidth="2.5" strokeLinecap="round" />
      {/* reply */}
      <path d="M84 36h50a8 8 0 018 8v16a8 8 0 01-8 8h-8v10l-10-10H84a8 8 0 01-8-8V44a8 8 0 018-8z" className="fill-violet-500" />
      <path d="M92 48h34M92 58h22" className="stroke-violet-100" strokeWidth="2.5" strokeLinecap="round" />
      {/* panel */}
      <circle cx="52" cy="84" r="6.5" className="fill-foreground/25" />
      <circle cx="78" cy="84" r="6.5" className="fill-foreground/25" />
      <circle cx="104" cy="84" r="6.5" className="fill-foreground/25" />
      <path d="M42 98a10 10 0 0120 0M68 98a10 10 0 0120 0M94 98a10 10 0 0120 0" className="fill-foreground/15" />
    </svg>
  );
}

function BrainstormGraphic() {
  return (
    <svg viewBox="0 0 160 100" className="h-20 w-full" aria-hidden>
      <circle cx="76" cy="44" r="27" className="fill-amber-400/20" />
      {/* bulb */}
      <path d="M76 20a22 22 0 0113 40c-2 2-3 4-3 7H66c0-3-1-5-3-7a22 22 0 0113-40z" className="fill-amber-400" />
      <path d="M70 62h12" className="stroke-amber-700/50" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M68 72h16M69 78h14" className="stroke-amber-600" strokeWidth="3" strokeLinecap="round" />
      {/* rays */}
      <path d="M76 6v6M50 14l4 5M102 14l-4 5M38 40h7M107 40h7" className="stroke-amber-400" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M126 58l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" className="fill-sky-400" />
      <path d="M30 66l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" className="fill-violet-400" />
    </svg>
  );
}

export const PROMPT_SUGGESTIONS: PromptSuggestion[] = [
  {
    id: "organise-downloads",
    prompt: "Organise my Downloads folder",
    title: "Organise my Downloads folder",
    graphic: <OrganiseDownloadsGraphic />,
  },
  {
    id: "portfolio-site",
    prompt: "Design a portfolio website based on what you know about me",
    title: "Design a portfolio website",
    graphic: <PortfolioGraphic />,
  },
  {
    id: "learn",
    prompt: "Teach me ",
    title: "Learn something new",
    graphic: <LearnGraphic />,
  },
  {
    id: "research",
    prompt: "Research the latest in AI for me",
    title: "Research the latest in AI",
    graphic: <ResearchGraphic />,
  },
  {
    id: "trip",
    prompt: "Plan a weekend trip for me",
    title: "Plan a weekend trip",
    graphic: <TripGraphic />,
  },
  {
    id: "script",
    prompt: "Write a Python script to clean up my files",
    title: "Clean up files with Python",
    graphic: <ScriptGraphic />,
  },
  {
    id: "email",
    prompt: "Draft a polite email declining a meeting",
    title: "Draft a polite email",
    graphic: <EmailGraphic />,
  },
  {
    id: "summarise",
    prompt: "Summarise a long document for me",
    title: "Summarise a long document",
    graphic: <SummariseGraphic />,
  },
  {
    id: "discuss",
    prompt: "Discuss a tough decision with me",
    title: "Discuss a tough decision",
    graphic: <DiscussGraphic />,
  },
  {
    id: "brainstorm",
    prompt: "Brainstorm ideas for my next project",
    title: "Brainstorm ideas with me",
    graphic: <BrainstormGraphic />,
  },
];

/** Random `count` suggestions (Fisher-Yates), stable within one pick. */
export function pickPromptSuggestions(count: number): PromptSuggestion[] {
  const pool = [...PROMPT_SUGGESTIONS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** The row of starter-prompt cards shown under the empty-screen composer. */
export function PromptSuggestionChips({
  suggestions,
  onPick,
}: {
  suggestions: PromptSuggestion[];
  onPick: (prompt: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {suggestions.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s.prompt)}
          title={s.prompt.trim()}
          // Staggered entrance: each card fades in one after another.
          // fill-mode-both keeps cards invisible until their delay elapses.
          style={{ animationDelay: `${i * 110}ms` }}
          className="group flex flex-col gap-2.5 rounded-xl border bg-card/50 p-3 text-left transition-all hover:border-foreground/30 hover:bg-card active:scale-[0.98] animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-300"
        >
          <div className="overflow-hidden rounded-lg border bg-background/60">
            {s.graphic}
          </div>
          <span className="text-xs leading-snug text-muted-foreground transition-colors group-hover:text-foreground">
            {s.title}
          </span>
        </button>
      ))}
    </div>
  );
}
