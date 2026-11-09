import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTeamResourcePollBackoff } from '../src/collab/team-resource-poll-backoff.js';

afterEach(() => vi.useRealTimers());
describe('team resource polling', () => {
  it('bounds failure retries and resets after success without blocking a new identity', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const poller = createTeamResourcePollBackoff();
    const refresh = vi.fn().mockResolvedValue(false);
    await poller.run('a/team/member', refresh);
    await poller.run('a/team/member', refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.setSystemTime(15_000); await poller.run('a/team/member', refresh);
    vi.setSystemTime(30_000); await poller.run('a/team/member', refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
    await poller.run('b/team/member', refresh);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.setSystemTime(45_000); refresh.mockResolvedValue(true);
    await poller.run('a/team/member', refresh);
    await poller.run('a/team/member', refresh);
    expect(refresh).toHaveBeenCalledTimes(5);
  });
  it('coalesces timer ticks and fences late failures after permission reset', async () => {
    const poller = createTeamResourcePollBackoff();
    let finish!: (value: boolean) => void;
    const pending = poller.run('a', () => new Promise(resolve => { finish = resolve; }));
    const refresh = vi.fn().mockResolvedValue(true);
    await poller.run('a', refresh);
    expect(refresh).not.toHaveBeenCalled();
    poller.reset(); finish(false); await pending;
    await poller.run('a', refresh);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
