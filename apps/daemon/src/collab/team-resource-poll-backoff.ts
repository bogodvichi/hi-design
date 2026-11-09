/** Poll failures cool down per exact authority; push and user reads stay eager. */
export function createTeamResourcePollBackoff() {
  const states = new Map<string, { attempts: number; retryAt: number; running: boolean }>();
  return {
    retain(keys: Set<string>) {
      for (const key of states.keys()) if (!keys.has(key)) states.delete(key);
    },
    reset() { states.clear(); },
    async run(key: string, refresh: () => Promise<boolean>): Promise<void> {
      let state = states.get(key);
      if (state?.running || (state && Date.now() < state.retryAt)) return;
      if (!state) {
        state = { attempts: 0, retryAt: 0, running: false };
        states.set(key, state);
      }
      const current = state;
      current.running = true;
      let succeeded = false;
      try {
        succeeded = await refresh();
      } finally {
        current.running = false;
        // Reset/identity change must fence a late failure from rearming cooldown.
        if (states.get(key) === current) {
          current.attempts = succeeded ? 0 : Math.min(current.attempts + 1, 4);
          current.retryAt = succeeded ? 0 : Date.now() + Math.min(120_000, 15_000 * 2 ** (current.attempts - 1));
        }
      }
    },
  };
}
