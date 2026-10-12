import { useState } from "react";
import { AGENT_FACE_COLORS, ensureAgentColor } from "@/lib/agents";
import { cn } from "@/lib/utils";

/** Random hover animation per avatar (keyframes in index.css). */
const FACE_ANIMS = ["look-y", "look-x", "spin-cw", "spin-ccw"] as const;
type FaceAnim = (typeof FACE_ANIMS)[number];

const HOVER_ANIM: Record<FaceAnim, { target: "face" | "eyes"; className: string }> = {
  "look-y": { target: "eyes", className: "group-hover/face:animate-[agent-face-look-y_0.9s_ease-in-out]" },
  "look-x": { target: "eyes", className: "group-hover/face:animate-[agent-face-look-x_0.9s_ease-in-out]" },
  "spin-cw": { target: "face", className: "group-hover/face:animate-[agent-face-spin-cw_0.9s_ease-in-out]" },
  "spin-ccw": { target: "face", className: "group-hover/face:animate-[agent-face-spin-ccw_0.9s_ease-in-out]" },
};

/**
 * A saved agent's avatar: a circle in the agent's own color (picked at
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
}: {
  seed?: string;
  className?: string;
  /** Native hover tooltip (e.g. the agent's name). */
  title?: string;
  /** Eyes glance down — the agent is looking at the textbox. */
  lookingDown?: boolean;
}) {
  // The agent's stored color, claimed on first sight for agents created
  // before colors existed. A plain random pick only for non-agent uses.
  const [color] = useState(() => {
    if (!seed) {
      return AGENT_FACE_COLORS[Math.floor(Math.random() * AGENT_FACE_COLORS.length)];
    }
    return ensureAgentColor(seed);
  });
  const [anim] = useState<FaceAnim>(() => FACE_ANIMS[Math.floor(Math.random() * FACE_ANIMS.length)]);
  const hover = HOVER_ANIM[anim];
  return (
    <span
      className={cn("group/face relative inline-flex shrink-0", className)}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      <span
        className={cn("absolute inset-0 rounded-full", hover.target === "face" && hover.className)}
        style={{ backgroundColor: color }}
      >
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center gap-[20%] transition-transform duration-300",
            lookingDown && "translate-y-[9%]",
            hover.target === "eyes" && hover.className,
          )}
        >
          <span className="h-[26%] w-[11%] rounded-full bg-black" />
          <span className="h-[26%] w-[11%] rounded-full bg-black" />
        </span>
      </span>
    </span>
  );
}
