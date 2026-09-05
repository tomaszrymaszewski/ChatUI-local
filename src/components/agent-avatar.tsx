import { agentAvatarParams, agentAvatarCurvePath } from "@/lib/agent-avatar";
import { cn } from "@/lib/utils";

/**
 * A saved agent's avatar: three S-curves in different tones of one hue,
 * derived deterministically from the agent id. Same agent → same graphic,
 * across restarts and machines.
 */
export function AgentAvatar({
  seed,
  className,
  title,
}: {
  seed: string;
  className?: string;
  /** Native hover tooltip (e.g. the agent's name). */
  title?: string;
}) {
  const { hue, curves } = agentAvatarParams(seed);
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0 rounded-full", className)}
      role="img"
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="15.25"
        fill={`hsla(${hue}, 70%, 50%, 0.16)`}
        stroke={`hsla(${hue}, 60%, 45%, 0.4)`}
        strokeWidth="1"
      />
      {curves.map((curve, i) => (
        <path
          key={i}
          d={agentAvatarCurvePath(curve)}
          fill="none"
          stroke={`hsl(${hue}, 62%, ${curve.tone}%)`}
          strokeWidth={curve.width}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
