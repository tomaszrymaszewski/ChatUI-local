import { useEffect, useState } from "react";
import { AGENT_AVATAR_SHAPES, AGENT_FACE_COLORS, ensureAgentColor, ensureAgentShape } from "@/lib/agents";
import type { AgentAvatarShape } from "@/types";
import { cn } from "@/lib/utils";

/** Random hover animation per avatar (keyframes in index.css). */
const FACE_ANIMS = ["look-y", "look-x", "spin-cw", "spin-ccw"] as const;
type FaceAnim = (typeof FACE_ANIMS)[number];

const HOVER_ANIM: Record<FaceAnim, { target: "face" | "eyes"; hoverClass: string; animationClass: string }> = {
  "look-y": { target: "eyes", hoverClass: "group-hover/face:animate-[agent-face-look-y_0.9s_ease-in-out]", animationClass: "animate-[agent-face-look-y_0.9s_ease-in-out]" },
  "look-x": { target: "eyes", hoverClass: "group-hover/face:animate-[agent-face-look-x_0.9s_ease-in-out]", animationClass: "animate-[agent-face-look-x_0.9s_ease-in-out]" },
  "spin-cw": { target: "face", hoverClass: "group-hover/face:animate-[agent-face-spin-cw_0.9s_ease-in-out]", animationClass: "animate-[agent-face-spin-cw_0.9s_ease-in-out]" },
  "spin-ccw": { target: "face", hoverClass: "group-hover/face:animate-[agent-face-spin-ccw_0.9s_ease-in-out]", animationClass: "animate-[agent-face-spin-ccw_0.9s_ease-in-out]" },
};

function AvatarSilhouette({ shape, color }: { shape: AgentAvatarShape; color: string }) {
  switch (shape) {
    case "rounded-square":
      return <rect x="7" y="7" width="86" height="86" rx="23" fill={color} />;
    case "inverted-rounded-triangle":
      return <path transform="rotate(180 50 50)" d="M44.2 11.8c2.8-5.1 8.8-5.1 11.6 0l34 62.3c3.2 5.9-.5 12.9-6.6 12.9H16.8c-6.1 0-9.8-7-6.6-12.9l34-62.3Z" fill={color} />;
    case "rounded-star": {
      // Ten short, rounded arms keep the face safely inside the silhouette.
      const points = Array.from({ length: 20 }, (_, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI) / 10;
        const radius = i % 2 === 0 ? 47 : 41;
        return `${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`;
      }).join(" ");
      return <polygon points={points} fill={color} stroke={color} strokeWidth="5" strokeLinejoin="round" />;
    }
    case "rounded-hexagon":
      return <path d="M31 8h38c5 0 8 2 10.5 6.3l19 32.5c2 3.4 2 6.9 0 10.3l-19 32.5C77 94 74 96 69 96H31c-5 0-8-2-10.5-6.3l-19-32.5c-2-3.4-2-6.9 0-10.3l19-32.5C23 10 26 8 31 8Z" transform="translate(5 0) scale(.9 1)" fill={color} />;
    case "circle":
    default:
      return <circle cx="50" cy="50" r="50" fill={color} />;
  }
}

/**
 * A saved agent's avatar: a shape in the agent's own color (picked at
 * creation, unique per agent, persisted with the definition — so stable
 * across restarts and devices) with two black oval eyes — a little face.
 * The hover animation is picked randomly per mount: the face glances
 * up/down or left/right, or does a small spin, then settles back to center.
 * `lookingDown` glances the eyes toward the composer (the new-session hero
 * while the user types).
 */
export function AgentAvatar({
  seed,
  className,
  title,
  lookingDown = false,
  autoAnimate = false,
}: {
  seed?: string;
  className?: string;
  /** Native hover tooltip (e.g. the agent's name). */
  title?: string;
  /** Eyes glance down — the agent is looking at the textbox. */
  lookingDown?: boolean;
  /** Play occasional, unsynchronized idle animations. */
  autoAnimate?: boolean;
}) {
  // The agent's stored color, claimed on first sight for agents created
  // before colors existed. A plain random pick only for non-agent uses.
  const [color] = useState(() => {
    if (!seed) {
      return AGENT_FACE_COLORS[Math.floor(Math.random() * AGENT_FACE_COLORS.length)];
    }
    return ensureAgentColor(seed);
  });
  const [shape, setShape] = useState<AgentAvatarShape>(() => {
    if (!seed) return AGENT_AVATAR_SHAPES[Math.floor(Math.random() * AGENT_AVATAR_SHAPES.length)];
    return ensureAgentShape(seed);
  });
  const [anim, setAnim] = useState<FaceAnim>(() => FACE_ANIMS[Math.floor(Math.random() * FACE_ANIMS.length)]);
  const [autoAnimating, setAutoAnimating] = useState(false);

  useEffect(() => {
    if (!seed) return;
    const refreshShape = () => setShape(ensureAgentShape(seed));
    window.addEventListener("chatui:agents-changed", refreshShape);
    return () => window.removeEventListener("chatui:agents-changed", refreshShape);
  }, [seed]);

  useEffect(() => {
    if (!autoAnimate) return;
    let startTimer = 0;
    let finishTimer = 0;
    let cancelled = false;

    const schedule = () => {
      startTimer = window.setTimeout(() => {
        if (cancelled) return;
        setAnim(FACE_ANIMS[Math.floor(Math.random() * FACE_ANIMS.length)]);
        setAutoAnimating(true);
        finishTimer = window.setTimeout(() => {
          setAutoAnimating(false);
          schedule();
        }, 900);
      }, 1200 + Math.random() * 4200);
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(finishTimer);
    };
  }, [autoAnimate]);

  const hover = HOVER_ANIM[anim];
  return (
    <span
      className={cn("group/face relative inline-flex shrink-0", className)}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      <span
        className={cn(
          "absolute inset-0",
          hover.target === "face" && hover.hoverClass,
          autoAnimating && hover.target === "face" && hover.animationClass,
        )}
      >
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" aria-hidden="true">
          <AvatarSilhouette shape={shape} color={color} />
        </svg>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center gap-[20%] transition-transform duration-300",
            lookingDown && "translate-y-[9%]",
            hover.target === "eyes" && hover.hoverClass,
            autoAnimating && hover.target === "eyes" && hover.animationClass,
          )}
        >
          <span className="h-[26%] w-[11%] rounded-full bg-black" />
          <span className="h-[26%] w-[11%] rounded-full bg-black" />
        </span>
      </span>
    </span>
  );
}
