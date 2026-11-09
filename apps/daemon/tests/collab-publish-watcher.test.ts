import { describe, expect, it, vi } from 'vitest';
import { createCollabPublishWatcher } from '../src/collab/collab-publish-watcher.js';
import type { ResourceHubPrincipal } from '../src/collab/resource-principal.js';

describe('collab publish watcher', () => {
  it('backs off repeated failures and rechecks authority before publishing after recovery', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const denied = Object.assign(new Error('denied'), { status: 403 });
    const shouldPublish = vi.fn().mockRejectedValue(denied);
    const notifyChanged = vi.fn();
    const watcher = createCollabPublishWatcher({
      notifyChanged,
      listProjectIds: () => ['p1'],
      shouldPublish,
      subscribeFiles: () => ({ unsubscribe: () => {} }),
    });
    try {
      await watcher.reconcile();
      await watcher.reconcile();
      expect(shouldPublish).toHaveBeenCalledTimes(1);
      vi.setSystemTime(10_000);
      await watcher.reconcile();
      expect(shouldPublish).toHaveBeenCalledTimes(2);
      vi.setSystemTime(20_000);
      await watcher.reconcile();
      expect(shouldPublish).toHaveBeenCalledTimes(2);
      expect(notifyChanged).not.toHaveBeenCalled();
      shouldPublish.mockResolvedValue(true);
      vi.setSystemTime(30_000);
      await watcher.reconcile();
      expect(shouldPublish).toHaveBeenCalledTimes(3);
      expect(notifyChanged).toHaveBeenCalledTimes(1);
    } finally {
      watcher.dispose();
      vi.useRealTimers();
    }
  });

  it('does not carry a denial cooldown across exact identities', async () => {
    let identity = 'account-a/team-a/member-a';
    const shouldPublish = vi.fn().mockRejectedValueOnce(new Error('403')).mockResolvedValue(false);
    const watcher = createCollabPublishWatcher({
      notifyChanged: vi.fn(), listProjectIds: () => ['p1'], shouldPublish,
      identityKey: () => identity,
      subscribeFiles: () => ({ unsubscribe: vi.fn() }),
    });
    await watcher.reconcile();
    identity = 'account-b/team-a/member-b';
    await watcher.reconcile();
    expect(shouldPublish).toHaveBeenCalledTimes(2);
    watcher.dispose();
  });

  it('immediately rechecks after an authority event and ignores the old pending result', async () => {
    let finish!: (value: boolean) => void;
    const shouldPublish = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }))
      .mockResolvedValue(false);
    const subscribeFiles = vi.fn();
    const watcher = createCollabPublishWatcher({
      notifyChanged: vi.fn(), listProjectIds: () => ['p1'], shouldPublish,
      identityKey: () => 'account/team/member', subscribeFiles,
    });
    const pending = watcher.reconcile();
    await Promise.resolve();
    void watcher.invalidate();
    finish(true);
    await pending;
    expect(subscribeFiles).not.toHaveBeenCalled();
    expect(shouldPublish).toHaveBeenCalledTimes(2);
    watcher.dispose();
  });

  it('does not publish file callbacks under a replaced identity', async () => {
    let identity = 'account-a';
    let onChange = () => {};
    const notifyChanged = vi.fn();
    const unsubscribe = vi.fn();
    const watcher = createCollabPublishWatcher({
      notifyChanged, listProjectIds: () => ['p1'], shouldPublish: async () => true,
      identityKey: () => identity,
      subscribeFiles: (_id, handler) => { onChange = handler; return { unsubscribe }; },
    });
    await watcher.reconcile();
    notifyChanged.mockClear();
    identity = 'account-b';
    onChange();
    expect(notifyChanged).not.toHaveBeenCalled();
    await watcher.reconcile();
    expect(unsubscribe).toHaveBeenCalledOnce();
    watcher.dispose();
  });

  it('revalidates unchanged projects without rebuilding subscriptions or publishing again', async () => {
    const notifyChanged = vi.fn();
    const unsubscribe = vi.fn();
    const subscribeFiles = vi.fn(() => ({ unsubscribe }));
    const shouldPublish = vi.fn().mockResolvedValue(true);
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => ['one', 'two'], identityKey: () => 'account/team/member',
      shouldPublish, subscribeFiles, notifyChanged,
    });
    try {
      await watcher.reconcile();
      await watcher.invalidate();
      await watcher.reconcile();
      expect(shouldPublish).toHaveBeenCalledTimes(4);
      expect(notifyChanged).toHaveBeenCalledTimes(2);
      expect(subscribeFiles).toHaveBeenCalledTimes(2);
      expect(unsubscribe).not.toHaveBeenCalled();
    } finally { watcher.dispose(); }
  });

  it('retains edits during authority revalidation and publishes them once after approval', async () => {
    let finish!: (scope: boolean) => void;
    let changed = () => {};
    const notifyChanged = vi.fn();
    const unsubscribe = vi.fn();
    const shouldPublish = vi.fn().mockResolvedValueOnce(true)
      .mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => ['one'], identityKey: () => 'account/team/member', shouldPublish, notifyChanged,
      subscribeFiles: (_id, handler) => { changed = handler; return { unsubscribe }; },
    });
    try {
      await watcher.reconcile();
      const originalHandler = changed;
      const pending = watcher.invalidate();
      await Promise.resolve();
      originalHandler(); originalHandler();
      expect(notifyChanged).toHaveBeenCalledTimes(1);
      finish(true); await pending; await watcher.reconcile();
      expect(notifyChanged).toHaveBeenCalledTimes(2);
      expect(unsubscribe).not.toHaveBeenCalled();
      originalHandler();
      expect(notifyChanged).toHaveBeenCalledTimes(3);
    } finally { watcher.dispose(); }
  });

  it('revokes a subscription without publishing edits received during the denied recheck', async () => {
    let finish!: (scope: boolean) => void;
    let changed = () => {};
    const notifyChanged = vi.fn();
    const unsubscribe = vi.fn();
    const shouldPublish = vi.fn().mockResolvedValueOnce(true)
      .mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }))
      .mockResolvedValue(false);
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => ['one'], identityKey: () => 'account/team/member', shouldPublish, notifyChanged,
      subscribeFiles: (_id, handler) => { changed = handler; return { unsubscribe }; },
    });
    try {
      await watcher.reconcile();
      const pending = watcher.invalidate(); await Promise.resolve();
      changed(); finish(false); await pending; await watcher.reconcile(); changed();
      expect(notifyChanged).toHaveBeenCalledTimes(1);
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally { watcher.dispose(); }
  });

  it('coalesces an invalidation storm across 1000 unchanged subscriptions', async () => {
    const ids = Array.from({ length: 1000 }, (_, index) => `project-${index}`);
    const notifyChanged = vi.fn();
    const unsubscribe = vi.fn();
    const subscribeFiles = vi.fn(() => ({ unsubscribe }));
    const shouldPublish = vi.fn().mockResolvedValue(true);
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => ids, identityKey: () => 'account/team/member',
      shouldPublish, subscribeFiles, notifyChanged,
    });
    try {
      await watcher.reconcile();
      await Promise.all(Array.from({ length: 1000 }, () => watcher.invalidate()));
      await watcher.reconcile();
      expect(notifyChanged).toHaveBeenCalledTimes(1000);
      expect(subscribeFiles).toHaveBeenCalledTimes(1000);
      expect(unsubscribe).not.toHaveBeenCalled();
      expect(shouldPublish.mock.calls.length).toBeLessThanOrEqual(3000);
    } finally { watcher.dispose(); }
  });

  it.each([false, true])('preserves subscriptions through an authority outage with pending edits=%s', async (hasEdits) => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    let changed = () => {};
    const notifyChanged = vi.fn();
    const unsubscribe = vi.fn();
    const shouldPublish = vi.fn().mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('authority unavailable')).mockResolvedValue(true);
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => ['one'], identityKey: () => 'account/team/member', shouldPublish, notifyChanged,
      subscribeFiles: (_id, handler) => { changed = handler; return { unsubscribe }; },
    });
    try {
      await watcher.reconcile(); await watcher.invalidate();
      if (hasEdits) { changed(); changed(); }
      await watcher.reconcile();
      expect(shouldPublish).toHaveBeenCalledTimes(2);
      expect(notifyChanged).toHaveBeenCalledTimes(1);
      expect(unsubscribe).not.toHaveBeenCalled();
      vi.setSystemTime(10_000); await watcher.reconcile();
      expect(notifyChanged).toHaveBeenCalledTimes(hasEdits ? 2 : 1);
      expect(unsubscribe).not.toHaveBeenCalled();
    } finally { watcher.dispose(); vi.useRealTimers(); }
  });

  it('updates the verified role without reopening the same member subscription', async () => {
    const principal: ResourceHubPrincipal = { teamId: 'team', memberId: 'member', role: 'owner', lifecycleState: 'active' };
    let changed = () => {};
    const notifyChanged = vi.fn();
    const shouldPublish = vi.fn().mockResolvedValueOnce(principal).mockResolvedValue({ ...principal, role: 'admin' });
    const subscribeFiles = vi.fn((_id, handler: () => void) => { changed = handler; return { unsubscribe: vi.fn() }; });
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => ['one'], identityKey: () => 'account/team/member', shouldPublish, notifyChanged, subscribeFiles,
    });
    try {
      await watcher.reconcile(); await watcher.invalidate();
      expect(subscribeFiles).toHaveBeenCalledOnce();
      expect(notifyChanged).toHaveBeenCalledOnce();
      changed();
      expect(notifyChanged).toHaveBeenLastCalledWith('one', expect.objectContaining({ role: 'admin' }));
    } finally { watcher.dispose(); }
  });

  it('ignores late callbacks from a subscription removed by an identity switch', async () => {
    let identity = 'account-a';
    const handlers: Array<() => void> = [];
    const notifyChanged = vi.fn();
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => ['one'], identityKey: () => identity, shouldPublish: async () => true, notifyChanged,
      subscribeFiles: (_id, handler) => { handlers.push(handler); return { unsubscribe: () => Promise.resolve() }; },
    });
    try {
      await watcher.reconcile(); identity = 'account-b'; await watcher.reconcile();
      notifyChanged.mockClear(); handlers[0]!();
      expect(notifyChanged).not.toHaveBeenCalled();
      handlers[1]!(); expect(notifyChanged).toHaveBeenCalledOnce();
    } finally { watcher.dispose(); }
  });

  it('does not install a watch or publish when disposed during an authority check', async () => {
    let finish!: (scope: boolean) => void;
    const notifyChanged = vi.fn(), subscribeFiles = vi.fn();
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => ['one'], notifyChanged, subscribeFiles,
      shouldPublish: () => new Promise<boolean>(resolve => { finish = resolve; }),
    });
    const pending = watcher.reconcile(); await Promise.resolve();
    watcher.dispose(); finish(true); await pending;
    expect(subscribeFiles).not.toHaveBeenCalled();
    expect(notifyChanged).not.toHaveBeenCalled();
  });

  it('does not lose an invalidation arriving as a reconciliation promise settles', async () => {
    const shouldPublish = vi.fn().mockResolvedValue(true);
    const notifyChanged = vi.fn();
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => ['one'], shouldPublish, notifyChanged,
      subscribeFiles: () => ({ unsubscribe: vi.fn() }),
    });
    try {
      const pending = watcher.reconcile();
      let invalidated: Promise<void> | undefined;
      queueMicrotask(() => queueMicrotask(() => { invalidated = watcher.invalidate(); }));
      await pending; await invalidated;
      expect(shouldPublish).toHaveBeenCalledTimes(2);
      expect(notifyChanged).toHaveBeenCalledOnce();
    } finally { watcher.dispose(); }
  });

  it('reports one failed reconciliation once when an event storm joins it', async () => {
    const failure = new Error('project directory unavailable');
    const onError = vi.fn();
    const watcher = createCollabPublishWatcher({
      listProjectIds: () => { throw failure; }, onError,
      shouldPublish: async () => true, notifyChanged: vi.fn(),
      subscribeFiles: () => ({ unsubscribe: vi.fn() }),
    });
    try {
      await Promise.allSettled(Array.from({ length: 1000 }, () => watcher.invalidate()));
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    } finally { watcher.dispose(); }
  });

  it('publishes current content once when it first watches an owned+shared project', async () => {
    const notifyChanged = vi.fn();
    const onChangeHandlers = new Map<string, () => void>();
    const watcher = createCollabPublishWatcher({
      notifyChanged,
      listProjectIds: () => ['owned-shared', 'someone-elses'],
      shouldPublish: async (projectId) => projectId === 'owned-shared',
      subscribeFiles: (projectId, onChange) => {
        onChangeHandlers.set(projectId, onChange);
        return { unsubscribe: () => {} };
      },
    });

    await watcher.reconcile();

    // Owned+shared → subscribed AND an initial publish so existing files (which
    // the file watcher's ignoreInitial would skip) still reach members.
    expect(onChangeHandlers.has('owned-shared')).toBe(true);
    expect(notifyChanged).toHaveBeenCalledTimes(1);
    expect(notifyChanged).toHaveBeenCalledWith('owned-shared');
    // A project owned by someone else is never watched or published from here.
    expect(onChangeHandlers.has('someone-elses')).toBe(false);
  });

  it('does not re-publish an already-watched project on subsequent reconciles', async () => {
    const notifyChanged = vi.fn();
    const watcher = createCollabPublishWatcher({
      notifyChanged,
      listProjectIds: () => ['p1'],
      shouldPublish: async () => true,
      subscribeFiles: () => ({ unsubscribe: () => {} }),
    });

    await watcher.reconcile();
    await watcher.reconcile();
    await watcher.reconcile();

    // Initial publish fires once per watch session, not on every reconcile tick.
    expect(notifyChanged).toHaveBeenCalledTimes(1);
  });

  it('publishes on a later file change through the subscribed handler', async () => {
    const notifyChanged = vi.fn();
    const handler: { onChange: (() => void) | null } = { onChange: null };
    const watcher = createCollabPublishWatcher({
      notifyChanged,
      listProjectIds: () => ['p1'],
      shouldPublish: async () => true,
      subscribeFiles: (_projectId, onChange) => {
        handler.onChange = onChange;
        return { unsubscribe: () => {} };
      },
    });

    await watcher.reconcile();
    notifyChanged.mockClear();
    handler.onChange?.();

    expect(notifyChanged).toHaveBeenCalledTimes(1);
    expect(notifyChanged).toHaveBeenCalledWith('p1');
  });

  it('keeps the verified workspace principal captured by the watch', async () => {
    const principal: ResourceHubPrincipal = {
      teamId: 'workspace-a',
      memberId: 'member-a',
      role: 'owner',
      lifecycleState: 'active',
      workspaceType: 'team',
    };
    const notifyChanged = vi.fn();
    const handler: { onChange: (() => void) | null } = { onChange: null };
    const watcher = createCollabPublishWatcher({
      notifyChanged,
      listProjectIds: () => ['p1'],
      shouldPublish: async () => principal,
      subscribeFiles: (_projectId, onChange) => {
        handler.onChange = onChange;
        return { unsubscribe: () => {} };
      },
    });

    await watcher.reconcile();
    expect(notifyChanged).toHaveBeenLastCalledWith('p1', principal);

    notifyChanged.mockClear();
    handler.onChange?.();
    expect(notifyChanged).toHaveBeenCalledOnce();
    expect(notifyChanged).toHaveBeenCalledWith('p1', principal);
  });
});
