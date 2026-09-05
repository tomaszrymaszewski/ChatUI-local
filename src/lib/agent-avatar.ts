/**
 * Deterministic per-agent avatar parameters: each agent's id maps to one hue
 * and a fixed set of S-curves in different tones (lightness steps) of that
 * hue. Pure — same id always yields the same avatar.
 */

export interface AgentAvatarCurve {
  /** Vertical center of the curve in the 32×32 viewBox. */
  y: number;
  /** Control-point amplitude — how tall the S-bend is. */
  amp: number;
  /** Curve direction (mirrored S). */
  up: boolean;
  /** HSL lightness of this curve's tone. */
  tone: number;
  /** Stroke width. */
  width: number;
}

export interface AgentAvatarParams {
  hue: number;
  curves: AgentAvatarCurve[];
}

/** FNV-1a 32-bit hash — stable across sessions and platforms. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const CURVE_COUNT = 3;

/**
 * Derive the avatar for an agent id: one hue plus three S-curves at
 * descending lightness (dark → light tones of the same colour).
 */
export function agentAvatarParams(id: string): AgentAvatarParams {
  const hash = hashId(id);
  const hue = hash % 360;
  const ampBase = 4 + (Math.floor(hash / 360) % 5); // 4..8
  const flip = Math.floor(hash / 1800) % 2 === 0;
  const toneBase = 38 + (Math.floor(hash / 3600) % 8); // 38..45

  const curves: AgentAvatarCurve[] = [];
  for (let i = 0; i < CURVE_COUNT; i++) {
    const slot = Math.floor(hash / 360 ** (i + 1));
    const amp = Math.max(2.5, ampBase - i + (slot % 3)); // gentle per-curve variance
    curves.push({
      y: 10.5 + i * 5.5,
      amp,
      up: (i % 2 === 0) === flip,
      tone: Math.min(82, toneBase + i * 16),
      width: 2.4 - i * 0.3,
    });
  }
  return { hue, curves };
}

/** SVG path for one S-curve spanning the 32-unit viewBox. */
export function agentAvatarCurvePath(curve: AgentAvatarCurve): string {
  const d = curve.up ? -1 : 1;
  return `M 2 ${curve.y} C 10.5 ${(curve.y + curve.amp * d).toFixed(2)}, 21.5 ${(curve.y - curve.amp * d).toFixed(2)}, 30 ${curve.y}`;
}
