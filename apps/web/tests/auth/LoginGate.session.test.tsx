// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginGate } from '../../src/auth/LoginGate';
import { AUTH_STATUS_REFRESH_EVENT, checkAuthStatus } from '../../src/auth/auth';

vi.mock('../../src/auth/auth', async (original) => ({
  ...await original<typeof import('../../src/auth/auth')>(),
  checkAuthStatus: vi.fn(),
}));
vi.mock('../../src/auth/lanz-account', () => ({ loadLanzAccount: async () => null }));
vi.mock('../../src/analytics/provider', () => ({ useAppVersion: () => 'test' }));
vi.mock('../../src/components/UpdaterPopup', () => ({ UpdaterPopup: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.removeAttribute('data-od-app-mounted');
  vi.mocked(checkAuthStatus).mockReset().mockResolvedValue({ ok: true, username: 'synthetic-user' });
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-od-app-mounted');
  vi.useRealTimers();
});

async function mount() {
  render(<LoginGate><div>Authenticated workbench</div></LoginGate>);
  await act(async () => {});
}

it('signals desktop readiness as soon as the first-launch login form mounts', async () => {
  vi.mocked(checkAuthStatus).mockResolvedValueOnce({ ok: false });
  await mount();
  expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
  expect(screen.queryByText('Authenticated workbench')).toBeNull();
  expect(document.documentElement.getAttribute('data-od-app-mounted')).toBe('1');
});

it('does not signal desktop readiness while the initial session check is pending', async () => {
  let finishCheck!: (result: Awaited<ReturnType<typeof checkAuthStatus>>) => void;
  vi.mocked(checkAuthStatus).mockImplementationOnce(() => new Promise(resolve => { finishCheck = resolve; }));
  await mount();
  expect(screen.queryByRole('button', { name: '登录' })).toBeNull();
  expect(document.documentElement.hasAttribute('data-od-app-mounted')).toBe(false);
  await act(async () => { finishCheck({ ok: false }); });
  expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
  expect(document.documentElement.getAttribute('data-od-app-mounted')).toBe('1');
});

it('returns to the OA login form immediately when a workspace rejection confirms OA expiry', async () => {
  await mount();
  expect(screen.getByText('Authenticated workbench')).toBeTruthy();
  vi.mocked(checkAuthStatus).mockResolvedValue({ ok: false });
  await act(async () => { window.dispatchEvent(new Event(AUTH_STATUS_REFRESH_EVENT)); });
  expect(screen.queryByText('Authenticated workbench')).toBeNull();
  expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
});

it('retains the workbench on a temporary OA outage and retries verification', async () => {
  await mount();
  vi.mocked(checkAuthStatus).mockResolvedValueOnce({ ok: false, error: 'unavailable' });
  await act(async () => { window.dispatchEvent(new Event(AUTH_STATUS_REFRESH_EVENT)); });
  expect(screen.getByText('Authenticated workbench')).toBeTruthy();
  const reads = vi.mocked(checkAuthStatus).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(checkAuthStatus).toHaveBeenCalledTimes(reads + 1);
});

it('retries a startup outage without falsely displaying the login form', async () => {
  vi.mocked(checkAuthStatus).mockResolvedValueOnce({ ok: false, error: 'unavailable' });
  await mount();
  expect(screen.queryByRole('button', { name: '登录' })).toBeNull();
  expect(document.documentElement.hasAttribute('data-od-app-mounted')).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('Authenticated workbench')).toBeTruthy();
});

it('ignores an old successful verification after a newer check has rejected the session', async () => {
  await mount();
  let finishOld!: (result: Awaited<ReturnType<typeof checkAuthStatus>>) => void;
  vi.mocked(checkAuthStatus).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  await act(async () => { window.dispatchEvent(new Event(AUTH_STATUS_REFRESH_EVENT)); });
  vi.mocked(checkAuthStatus).mockResolvedValueOnce({ ok: false });
  await act(async () => { window.dispatchEvent(new Event(AUTH_STATUS_REFRESH_EVENT)); });
  await act(async () => { finishOld({ ok: true, username: 'synthetic-user' }); });
  expect(screen.queryByText('Authenticated workbench')).toBeNull();
  expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
});
