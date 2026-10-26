export const MANUAL_EDIT_RUNTIME_TARGET_PREFIX = 'runtime:';

/** Runtime targets use a separate address space so they never patch a source DOM path. */
export function manualEditRuntimeSelector(id: string): string | null {
  if (!id.startsWith(MANUAL_EDIT_RUNTIME_TARGET_PREFIX)) return null;
  const selector = id.slice(MANUAL_EDIT_RUNTIME_TARGET_PREFIX.length);
  return /^body(?: > [a-z][a-z0-9-]*:nth-of-type\([1-9][0-9]*\))+$/.test(selector) ? selector : null;
}
