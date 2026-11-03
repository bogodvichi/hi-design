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
  vi.mocked(checkAuthStatus).mockReset().mockResolvedValue({ ok: true, username: 'synthetic-user' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function mount() {
  render(<LoginGate><div>Authenticated workbench</div></LoginGate>);
  await act(async () => {});
}

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
