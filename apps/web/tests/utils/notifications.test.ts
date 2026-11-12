import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockOpenDesignHost } from '@open-design/host/testing';
import { showCompletionNotification } from '../../src/utils/notifications';

type NotificationOptionsWithRenotify = NotificationOptions & { renotify?: boolean };

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static instances: MockNotification[] = [];

  onclose: (() => void) | null = null;
  onclick: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    public title: string,
    public options?: NotificationOptionsWithRenotify,
  ) {
    MockNotification.instances.push(this);
  }

  close(): void {
    // Fire synchronously so tests can observe cleanup without browser events.
    this.onclose?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockNotification.permission = 'granted';
  MockNotification.instances = [];
});

describe('showCompletionNotification', () => {
  it('creates a renotifying desktop notification when permission is granted', async () => {
    vi.stubGlobal('Notification', MockNotification as unknown as typeof Notification);

    const result = await showCompletionNotification({
      status: 'succeeded',
      title: 'Task completed',
      body: 'Done',
    });

    expect(result).toBe('shown');
    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0]!.title).toBe('Task completed');
    expect(MockNotification.instances[0]!.options).toMatchObject({
      body: 'Done',
      tag: 'od-task-succeeded',
      renotify: true,
    });
  });

  it('uses the service worker notification API when available', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const registration = { showNotification };
    const register = vi.fn().mockResolvedValue(registration);
    vi.stubGlobal('Notification', MockNotification as unknown as typeof Notification);
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register,
        ready: Promise.resolve(registration),
      },
    });

    const result = await showCompletionNotification({
      status: 'succeeded',
      title: 'Task completed',
      body: 'Done',
    });

    expect(result).toBe('shown');
    expect(register).toHaveBeenCalledWith('/od-notifications-sw.js');
    expect(showNotification).toHaveBeenCalledWith(
      'Task completed',
      expect.objectContaining({
        body: 'Done',
        tag: 'od-task-succeeded',
        renotify: true,
      }),
    );
    expect(MockNotification.instances).toHaveLength(0);
  });

  it('uses direct notifications in the desktop host even when the worker reports success', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const registration = { showNotification };
    const register = vi.fn().mockResolvedValue(registration);
    vi.stubGlobal('__od__', createMockOpenDesignHost({ client: { platform: 'darwin' } }));
    vi.stubGlobal('Notification', MockNotification as unknown as typeof Notification);
    vi.stubGlobal('navigator', {
      serviceWorker: { register, ready: Promise.resolve(registration) },
    });
    const onClick = vi.fn();

    const result = await showCompletionNotification({
      status: 'succeeded',
      title: 'Task completed',
      body: 'Done',
      onClick,
    });

    expect(result).toBe('shown');
    expect(register).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0]!.options).not.toHaveProperty('tag');
    MockNotification.instances[0]!.onclick?.();
    expect(onClick).toHaveBeenCalledOnce();

    await showCompletionNotification({
      status: 'succeeded',
      title: 'Task completed',
      body: 'Another task',
    });
    expect(MockNotification.instances).toHaveLength(2);
    expect(MockNotification.instances[1]!.options).not.toHaveProperty('tag');
  });

  it('does not create a notification when permission is not granted', async () => {
    MockNotification.permission = 'denied';
    vi.stubGlobal('Notification', MockNotification as unknown as typeof Notification);

    const result = await showCompletionNotification({
      status: 'failed',
      title: 'Task failed',
      body: 'Error',
    });

    expect(result).toBe('permission-denied');
    expect(MockNotification.instances).toHaveLength(0);
  });
});
