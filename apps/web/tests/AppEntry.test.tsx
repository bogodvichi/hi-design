// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppEntry } from '../src/AppEntry';
import { useAuth } from '../src/auth/LoginGate';
import { AUTH_STATUS_REFRESH_EVENT, checkAuthStatus } from '../src/auth/auth';

const workbenchImported = vi.hoisted(() => vi.fn());
vi.mock('../src/App', () => {
  workbenchImported();
  return { App: () => <div>Workbench for {useAuth().username}</div> };
});
vi.mock('../src/auth/auth', async (original) => ({
  ...await original<typeof import('../src/auth/auth')>(),
  checkAuthStatus: vi.fn(),
}));
vi.mock('../src/auth/lanz-account', () => ({ loadLanzAccount: async () => null }));
vi.mock('../src/analytics/provider', () => ({ useAppVersion: () => 'test' }));
vi.mock('../src/components/UpdaterPopup', () => ({ UpdaterPopup: () => null }));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-od-app-mounted');
});

it('loads workbench code only after authentication and preserves the authenticated context', async () => {
  let finishCheck!: (result: Awaited<ReturnType<typeof checkAuthStatus>>) => void;
  vi.mocked(checkAuthStatus).mockImplementationOnce(() => new Promise(resolve => { finishCheck = resolve; }));
  render(<AppEntry />);
  expect(workbenchImported).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '登录' })).toBeNull();

  await act(async () => { finishCheck({ ok: false }); });
  expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
  expect(workbenchImported).not.toHaveBeenCalled();
  expect(document.documentElement.getAttribute('data-od-app-mounted')).toBe('1');

  vi.mocked(checkAuthStatus).mockResolvedValueOnce({ ok: true, username: 'synthetic-user' });
  await act(async () => { window.dispatchEvent(new Event(AUTH_STATUS_REFRESH_EVENT)); });
  expect(await screen.findByText('Workbench for synthetic-user')).toBeTruthy();
  expect(workbenchImported).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '登录' })).toBeNull();
});
