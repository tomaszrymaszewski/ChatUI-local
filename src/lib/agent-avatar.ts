/**
 * Deterministic per-agent avatar parameters: each agent's id maps to one hue
 * and a fixed set of S-curves in different tones (lightness steps) of that
 * hue. Same id always yields the same avatar.
 *
 * Uniqueness: ids are arbitrary, so raw hashing often hands two agents the
 * same *look* — only ~24 hue families are visually distinct, and at rail size
 * colour is the only visible signal. New avatars therefore probe past any
 * look already claimed by another agent, remembering the chosen salt in
 * localStorage. Result: no two agents share a hue family (and never the same
 * avatar at all), while each agent keeps its avatar across restarts.
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

/** Salted derivation: salt 0 keeps the original id-only avatar. */
function paramsFromId(id: string, salt: number): AgentAvatarParams {
  const hash = hashId(salt === 0 ? id : `${id}#${salt}`);
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

/**
 * Visual identity of an avatar: coarse 15° hue family (nearby raw hues read
 * as the same colour, especially at rail size) plus the exact curve layout.
 */
function hueBucket(params: AgentAvatarParams): number {
  return Math.floor(params.hue / 15);
}

function avatarSignature(params: AgentAvatarParams): string {
  const shape = params.curves
    .map((c) => `${c.amp}|${c.up ? 1 : 0}|${c.tone}`)
    .join(";");
  return `${hueBucket(params)}:${shape}`;
}

const SALT_KEY = "chatui:avatar-salts";

function loadSalts(): Record<string, number> {
  try {
    if (typeof localStorage === "undefined") return {};
    return JSON.parse(localStorage.getItem(SALT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSalts(salts: Record<string, number>) {
  try {
    localStorage.setItem(SALT_KEY, JSON.stringify(salts));
  } catch {
    // localStorage full or unavailable — avatars still derive from id alone.
  }
}

/**
 * Derive the avatar for an agent id: one hue plus three S-curves at
 * descending lightness (dark → light tones of the same colour). While hue
 * families remain, each new agent claims an unclaimed one — re-hashing its id
 * with increasing salts until it does — so no two agents share a family (the
 * only thing distinguishable at rail size). Once all families are taken, the
 * probe falls back to exact signatures (family + curve layout) so shapes
 * differentiate. The chosen salt is remembered, keeping avatars stable even
 * when other agents are deleted.
 */
export function agentAvatarParams(id: string): AgentAvatarParams {
  const salts = loadSalts();
  if (id in salts) return paramsFromId(id, salts[id]);

  const others = Object.entries(salts)
    .filter(([otherId]) => otherId !== id)
    .map(([otherId, salt]) => paramsFromId(otherId, salt));
  const takenBuckets = new Set(others.map(hueBucket));
  const takenExact = new Set(others.map(avatarSignature));

  let salt = 0;
  let params = paramsFromId(id, salt);
  // Pass 1: claim a free hue family (a few dozen probes are overwhelmingly
  // enough to find one while any remain).
  while (takenBuckets.has(hueBucket(params)) && salt < 96) {
    salt++;
    params = paramsFromId(id, salt);
  }
  // Pass 2 (all families taken): avoid the exact look another agent wears.
  while (takenExact.has(avatarSignature(params)) && salt < 4096) {
    salt++;
    params = paramsFromId(id, salt);
  }
  salts[id] = salt;
  saveSalts(salts);
  return params;
}

/** SVG path for one S-curve spanning the 32-unit viewBox. */
export function agentAvatarCurvePath(curve: AgentAvatarCurve): string {
  const d = curve.up ? -1 : 1;
  return `M 2 ${curve.y} C 10.5 ${(curve.y + curve.amp * d).toFixed(2)}, 21.5 ${(curve.y - curve.amp * d).toFixed(2)}, 30 ${curve.y}`;
}
