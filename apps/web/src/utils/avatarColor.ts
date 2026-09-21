/**
 * Deterministic avatar background color from a display name.
 *
 * Same name always maps to the same hue; white text stays readable at the
 * chosen saturation/lightness. Shared by the account avatar in the nav rail
 * and the member avatars in the team space view.
 */

const avatarColorCache = new Map<string, string>();

export function avatarColorFor(name: string): string {
  const cached = avatarColorCache.get(name);
  if (cached !== undefined) return cached;

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  const color = `hsl(${hue}, 58%, 45%)`;
  avatarColorCache.set(name, color);
  return color;
}
