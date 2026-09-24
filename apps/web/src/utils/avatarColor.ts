/**
 * Deterministic avatar background color from a stable string seed.
 *
 * Accepts a display name, member id, or author seed — the same input always
 * maps to the same palette color so a person is visually consistent across
 * every surface (nav rail account avatar, team space members, project owner
 * chips, comment author avatars). Self-owned project cards ("我") are the
 * only exception: they use a fixed black background, not this function.
 */

const AVATAR_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#a855f7', '#d946ef',
] as const;

const AVATAR_FALLBACK = '#1a1917';

const avatarColorCache = new Map<string, string>();

export function avatarColorFor(seed: string): string {
  if (!seed) return AVATAR_FALLBACK;

  const cached = avatarColorCache.get(seed);
  if (cached !== undefined) return cached;

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const color = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length] ?? AVATAR_FALLBACK;
  avatarColorCache.set(seed, color);
  return color;
}
