/**
 * Deterministic avatar background color from a display name.
 *
 * Same name always maps to the same hue; white text stays readable at the
 * chosen saturation/lightness. Shared by the account avatar in the nav rail
 * and the member avatars in the team space view.
 */
export function avatarColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 58%, 45%)`;
}
