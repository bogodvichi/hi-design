// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EntryNavRail } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';

const auth = vi.hoisted(() => ({
  username: 'oa-user' as string | null,
  userInfo: { displayName: 'OA User', email: 'oa-user@example.test', avatarUrl: 'https://example.test/avatar.png' },
}));
vi.mock('../../src/auth/LoginGate', async (original) => ({
  ...await original<typeof import('../../src/auth/LoginGate')>(), useAuth: () => auth,
}));

beforeEach(() => {
  auth.username = 'oa-user';
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [], messages: [], unreadCount: 0 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function rail(loading = true, unavailable = false, retry = vi.fn()) {
  return (
    <I18nProvider initial="zh-CN">
      <EntryNavRail view="home" open context={null} onViewChange={() => {}} onNewProject={() => {}}
        workspaceLoading={loading} workspaceUnavailable={unavailable} onRetryWorkspace={retry} />
    </I18nProvider>
  );
}

it('shows the OA avatar and name before workspace data arrives, without granting workspace actions', () => {
  render(rail());
  const account = screen.getByRole('button', { name: 'OA User' });
  expect(account.querySelector('img')?.getAttribute('src')).toBe(auth.userInfo.avatarUrl);
  expect(screen.getByTestId('team-tree-section').querySelector('[role="status"]')).toBeTruthy();
  fireEvent.click(account);
  expect(screen.getByText('OA User')).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeTruthy();
  expect(screen.queryByTestId('entry-nav-invite')).toBeNull();
  expect(screen.queryByTestId('entry-nav-workspace-settings')).toBeNull();
});

it('keeps the OA account while showing a workspace-specific failure and retry', () => {
  const retry = vi.fn();
  render(rail(false, true, retry));
  expect(screen.getByRole('button', { name: 'OA User' })).toBeTruthy();
  expect(screen.getByText('工作区同步失败，请重试。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('removes the account when OA signs out even if profile data remains cached', () => {
  const view = render(rail());
  expect(screen.getByRole('button', { name: 'OA User' })).toBeTruthy();
  auth.username = null;
  view.rerender(rail());
  expect(screen.queryByTestId('entry-nav-account')).toBeNull();
});
