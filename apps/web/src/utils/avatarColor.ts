/**
 * Deterministic avatar background color from a stable string seed.
 *
 * Accepts a display name, member id, or author seed — the same input always
 * maps to the same color so a person is visually consistent across every
 * surface (nav rail account avatar, team space members, project owner chips,
 * comment author avatars). Self-owned project cards ("我") are the only
 * exception: they use a fixed black background, not this function.
 *
 * Color generation inspired by Pixso's avatar scheme: soft, balanced tones.
 * Instead of a fixed 6-color palette, the seed hash maps to a point in HSL
 * space — hue, saturation, and lightness each derive from different hash
 * bits — yielding ~100k distinct colors so collisions are practically
 * impossible for realistic team sizes.
 */

// Saturation 65–89%: vivid and rich, never muddy.
const SAT_BASE = 65;
const SAT_RANGE = 25;

// Lightness 45–59%: deep enough for strong white text contrast.
const LIGHT_BASE = 45;
const LIGHT_RANGE = 15;

const AVATAR_FALLBACK = 'hsl(210, 65%, 65%)';

const avatarColorCache = new Map<string, string>();

export function avatarColorFor(seed: string): string {
  if (!seed) return AVATAR_FALLBACK;

  const cached = avatarColorCache.get(seed);
  if (cached !== undefined) return cached;

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash);
  const hue = h % 360;
  const sat = SAT_BASE + ((h >> 8) % SAT_RANGE);
  const light = LIGHT_BASE + ((h >> 16) % LIGHT_RANGE);
  const color = `hsl(${hue}, ${sat}%, ${light}%)`;
  avatarColorCache.set(seed, color);
  return color;
}
