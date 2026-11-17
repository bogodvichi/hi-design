// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { installMockOpenDesignHost } from '@open-design/host/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail, resetWorkspaceDirectoryCache } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';

function teamContext(): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-team',
    workspaceType: 'team',
    workspaceMemberId: 'wm-1',
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: 'team_plus',
    displayName: 'Leaf',
    seatSummary: { seatLimit: 5, usedSeats: 1, availableSeats: 4, isSeatFull: false },
    permissions: { canInviteMembers: true, canViewWorkspaceSettings: true },
  } as unknown as WorkspaceCollabContext;
}

function renderRail() {
  return render(
    <I18nProvider initial="zh-CN">
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        open
        context={teamContext()}
        billing={null}
      />
    </I18nProvider>,
  );
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages?')) {
        return Response.json({ messages: [], nextCursor: null, unreadCount: 0 });
      }
      if (url.includes('/status')) return Response.json({ loggedIn: false });
      return Response.json({ items: [] });
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWorkspaceDirectoryCache();
  stubFetch();
});

afterEach(() => {
  cleanup();
  resetWorkspaceDirectoryCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function advancePastHoverClose() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220);
  });
}

describe('EntryNavRail account menu interaction state', () => {
  it('places native Force Reload directly below developer tools and closes the menu on activation', async () => {
    const forceReload = vi.fn(async () => ({ ok: true as const }));
    const restore = installMockOpenDesignHost({ host: {
      developerTools: { open: async () => ({ ok: true }) },
      browser: { forceReload },
    } });
    try {
      renderRail();
      const trigger = screen.getByTestId('entry-nav-account');
      fireEvent.click(trigger);
      const tools = screen.getByRole('menuitem', { name: '开发者工具' });
      const reload = screen.getByRole('menuitem', { name: '强制刷新' });
      expect(tools.nextElementSibling).toBe(reload);
      expect(reload.className).toBe(tools.className);
      await act(async () => fireEvent.click(reload));
      expect(forceReload).toHaveBeenCalledOnce();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    } finally { restore(); }
  });

  it('keeps Force Reload available when developer tools are disabled and reports failures', async () => {
    const restore = installMockOpenDesignHost({ host: {
      browser: { forceReload: async () => ({ ok: false, reason: 'Reload unavailable' }) },
    } });
    try {
      renderRail();
      fireEvent.click(screen.getByTestId('entry-nav-account'));
      expect(screen.queryByRole('menuitem', { name: '开发者工具' })).toBeNull();
      await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '强制刷新' })));
      expect(screen.getByText('无法强制刷新')).toBeInTheDocument();
      expect(screen.queryByRole('menu')).toBeNull();
    } finally { restore(); }
  });

  it('places enabled native developer tools directly below Settings and closes the menu on activation', async () => {
    const open = vi.fn(async () => ({ ok: true as const }));
    const restore = installMockOpenDesignHost({ host: { developerTools: { open } } });
    try {
      renderRail();
      const trigger = screen.getByTestId('entry-nav-account');
      fireEvent.click(trigger);
      const settings = screen.getByRole('menuitem', { name: '设置' });
      const tools = screen.getByRole('menuitem', { name: '开发者工具' });
      expect(settings.nextElementSibling).toBe(tools);
      expect(tools.className).toBe(settings.className);
      await act(async () => fireEvent.click(tools));
      expect(open).toHaveBeenCalledOnce();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    } finally { restore(); }
  });

  it('omits developer tools in browser and older desktop hosts', () => {
    const restore = installMockOpenDesignHost();
    try {
      renderRail();
      fireEvent.click(screen.getByTestId('entry-nav-account'));
      expect(screen.queryByRole('menuitem', { name: '开发者工具' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: '强制刷新' })).toBeNull();
    } finally { restore(); }
  });

  it('reports native developer tools failures after the menu closes', async () => {
    const restore = installMockOpenDesignHost({ host: {
      developerTools: { open: async () => ({ ok: false, reason: 'Tools unavailable' }) },
    } });
    try {
      renderRail();
      fireEvent.click(screen.getByTestId('entry-nav-account'));
      await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '开发者工具' })));
      expect(screen.getByText('无法打开开发者工具')).toBeInTheDocument();
      expect(screen.queryByRole('menu')).toBeNull();
    } finally { restore(); }
  });
  it('pins a hover-open menu when the avatar is clicked', async () => {
    renderRail();
    const trigger = screen.getByTestId('entry-nav-account');

    fireEvent.mouseEnter(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseLeave(trigger.closest('.entry-nav-rail__account') as HTMLElement);
    await advancePastHoverClose();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('still closes a hover-only menu after the pointer leaves', async () => {
    renderRail();
    const trigger = screen.getByTestId('entry-nav-account');

    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger.closest('.entry-nav-rail__account') as HTMLElement);
    await advancePastHoverClose();

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('treats a second avatar click as an explicit close', () => {
    renderRail();
    const trigger = screen.getByTestId('entry-nav-account');

    fireEvent.mouseEnter(trigger);
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not treat focus loss as a close action after a click pins the menu', () => {
    renderRail();
    const trigger = screen.getByTestId('entry-nav-account');

    fireEvent.mouseEnter(trigger);
    fireEvent.click(trigger);
    fireEvent.blur(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['an outside press', () => fireEvent.pointerDown(document.body)],
  ])('keeps %s as an explicit close action', (_label, close) => {
    renderRail();
    const trigger = screen.getByTestId('entry-nav-account');

    fireEvent.mouseEnter(trigger);
    fireEvent.click(trigger);
    close();

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps selecting a menu item as an explicit close action', () => {
    const onOpenSettings = vi.fn();
    render(
      <I18nProvider initial="zh-CN">
        <EntryNavRail
          view="home"
          onViewChange={() => {}}
          onNewProject={() => {}}
          onOpenSettings={onOpenSettings}
          open
          context={teamContext()}
          billing={null}
        />
      </I18nProvider>,
    );
    const trigger = screen.getByTestId('entry-nav-account');
    fireEvent.mouseEnter(trigger);
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole('menuitem', { name: '设置' }));

    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
