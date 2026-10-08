/** Presentation order shared by every resource in a composer draft. */
export function createComposerResourceOrder(initial: Record<string, number> = {}) {
  let entries = { ...initial };
  let next = Math.max(0, ...Object.values(entries).map((order) => order + 1));
  function reserve(count = 1, minimum = 0) {
    const start = Math.max(next, minimum);
    next = start + count;
    return start;
  }
  function set(key: string, order: number) {
    entries[key] = order;
    next = Math.max(next, order + 1);
  }
  return {
    reserve,
    set,
    get(key: string, fallback?: number) {
      if (entries[key] === undefined) set(key, fallback ?? reserve());
      return entries[key]!;
    },
    remove(key: string) { delete entries[key]; },
    reset() { entries = {}; next = 0; },
    snapshot() { return { ...entries }; },
  };
}
