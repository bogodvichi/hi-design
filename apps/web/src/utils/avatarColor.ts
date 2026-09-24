/**
 * Deterministic avatar background color from a user's display name.
 *
 * Every non-self avatar surface must pass the displayed name, never a
 * workspace-scoped member id. Self-owned project cards ("我") remain the only
 * exception: they use a fixed black background outside this helper.
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

function normalizeDisplayName(displayName: string): string {
  return displayName
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function avatarColorForDisplayName(displayName: string): string {
  const normalizedName = normalizeDisplayName(displayName);
  if (!normalizedName) return AVATAR_FALLBACK;

  const cached = avatarColorCache.get(normalizedName);
  if (cached !== undefined) return cached;

  let hash = 0;
  for (let i = 0; i < normalizedName.length; i++) {
    hash = ((hash << 5) - hash + normalizedName.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash);
  const hue = h % 360;
  const sat = SAT_BASE + ((h >> 8) % SAT_RANGE);
  const light = LIGHT_BASE + ((h >> 16) % LIGHT_RANGE);
  const color = `hsl(${hue}, ${sat}%, ${light}%)`;
  avatarColorCache.set(normalizedName, color);
  return color;
}
