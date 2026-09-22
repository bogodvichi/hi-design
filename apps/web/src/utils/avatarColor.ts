/**
 * Deterministic avatar background color from a display name.
 *
 * Same name always maps to the same hue; white text stays readable at the
 * chosen saturation/lightness. Shared by the account avatar in the nav rail,
 * member avatars in the team space view, and project owner chips.
 */

const avatarColorCache = new Map<string, string>();

export function avatarColorFor(memberId: string): string {
  // const cached = avatarColorCache.get(name);
  // if (cached !== undefined) return cached;

  // let hash = 0;
  // for (let i = 0; i < name.length; i++) {
  //   hash = name.charCodeAt(i) + ((hash << 5) - hash);
  //   hash |= 0;
  // }
  // const hue = Math.abs(hash) % 360;
  // const color = `hsl(${hue}, 58%, 45%)`;
  // avatarColorCache.set(name, color);
  // return color;
  if (!memberId) return '#1a1917';
    const palette = [
      '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
      '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6',
      '#06b6d4', '#0ea5e9', '#3b82f6', '#a855f7', '#d946ef',
    ];
    let hash = 0;
    for (let i = 0; i < memberId.length; i++) {
      hash = ((hash << 5) - hash + memberId.charCodeAt(i)) | 0;
    }
    return palette[Math.abs(hash) % palette.length] ?? '#1a1917';
}
