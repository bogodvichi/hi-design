export type FloatingMenuHorizontalAlign = 'start' | 'end';

export function resolveFloatingMenuHorizontalAlign({
  triggerLeft,
  triggerRight,
  menuWidth,
  viewportWidth,
  inset = 8,
  preferred = 'start',
}: {
  triggerLeft: number;
  triggerRight: number;
  menuWidth: number;
  viewportWidth: number;
  inset?: number;
  preferred?: FloatingMenuHorizontalAlign;
}): FloatingMenuHorizontalAlign {
  const viewportLeft = inset;
  const viewportRight = Math.max(inset, viewportWidth - inset);

  const startLeft = triggerLeft;
  const startRight = triggerLeft + menuWidth;
  const endLeft = triggerRight - menuWidth;
  const endRight = triggerRight;

  const overflowFor = (left: number, right: number) =>
    Math.max(0, viewportLeft - left) + Math.max(0, right - viewportRight);

  const startOverflow = overflowFor(startLeft, startRight);
  const endOverflow = overflowFor(endLeft, endRight);

  if (startOverflow === endOverflow) return preferred;
  return startOverflow < endOverflow ? 'start' : 'end';
}
