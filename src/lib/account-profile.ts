import type { User } from "@supabase/supabase-js";

/**
 * Account profile derived from the Supabase user + its metadata.
 * OAuth providers (Google/GitHub) populate `avatar_url`/`picture` and
 * `full_name`/`name` automatically; email/password users set them from the
 * account settings page.
 */
export interface AccountProfile {
  email: string;
  name: string;
  avatarUrl: string | null;
}

export function getAccountProfile(user: User | null): AccountProfile | null {
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;
  const name =
    str(meta.full_name) ?? str(meta.name) ?? user.email ?? "Account";
  const avatarUrl =
    str(meta.avatar_url) ?? str(meta.picture) ?? null;
  return { email: user.email ?? "", name, avatarUrl };
}

/**
 * Stable per-account fallback colour for the initials avatar. Hashed from the
 * key (email) so it varies between accounts but never changes between renders.
 */
const AVATAR_COLORS = [
  { backgroundColor: "#0f766e", color: "#ffffff" },
  { backgroundColor: "#1d4ed8", color: "#ffffff" },
  { backgroundColor: "#15803d", color: "#ffffff" },
  { backgroundColor: "#b45309", color: "#ffffff" },
  { backgroundColor: "#be123c", color: "#ffffff" },
  { backgroundColor: "#0e7490", color: "#ffffff" },
  { backgroundColor: "#c2410c", color: "#ffffff" },
  { backgroundColor: "#4d7c0f", color: "#ffffff" },
];

export function avatarColorStyle(key: string): { backgroundColor: string; color: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/**
 * What the sidebar footer shows for a signed-in account: the display name
 * when it looks like a real name (two or more words), otherwise the email.
 * A name that is just the email (no display name set) always falls back to
 * the email.
 */
export function sidebarAccountLabel(profile: AccountProfile): string {
  const name = profile.name.trim();
  if (!name.includes("@") && name.split(/\s+/).filter(Boolean).length >= 2) {
    return name;
  }
  return profile.email;
}

/** Initials for the avatar fallback (first letters of the first two words). */
export function profileInitials(name: string, email: string): string {
  const base = name.trim() || email.trim();
  if (!base) return "?";
  // An email address without a display name: use the part before the @.
  const words = (base.includes("@") ? base.split("@")[0] : base)
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return base.slice(0, 1).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
