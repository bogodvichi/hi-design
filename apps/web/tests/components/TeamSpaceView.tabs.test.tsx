// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamSpaceView } from '../../src/components/TeamSpaceView';
import { I18nProvider } from '../../src/i18n';
import { useRoute } from '../../src/router';

vi.mock('../../src/components/CloudSkillList', () => ({ CloudSkillList: () => <div>Skill content</div> }));
vi.mock('../../src/components/CloudMcpList', () => ({ CloudMcpList: () => <div>MCP content</div> }));
vi.mock('../../src/components/AddSkillDialog', () => ({ AddSkillDialog: () => null }));
vi.mock('../../src/components/AddMcpDialog', () => ({ AddMcpDialog: () => null }));
vi.mock('../../src/auth/auth', async (original) => ({ ...await original<typeof import('../../src/auth/auth')>(), getStoredUsername: () => 'teammate' }));
vi.mock('../../src/utils/deterministicId', async (original) => ({ ...await original<typeof import('../../src/utils/deterministicId')>(), getTeamMemberId: async () => 'member-1' }));

function RoutedTeamSpace() {
  const route = useRoute();
  if (route.kind !== 'home' || route.view !== 'team-space') return null;
  return <TeamSpaceView teamId={route.teamId} tab={route.tab} />;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/workspace/directory') {
      return Response.json({ items: [{
        workspaceId: 'team-1', workspaceName: 'Design Team', workspaceType: 'team',
        workspaceMemberId: 'member-1', role: 'member', memberStatus: 'active',
        lifecycleState: 'active', isDefaultTeam: false,
      }] });
    }
    if (url === '/api/hdw/api/team/team-1/member/member-1') return Response.json({ code: 0, data: { workspace_member_id: 'member-1', role: 'member' } });
    if (url === '/api/hdw/api/team/team-1/members') {
      return Response.json({ code: 0, data: { members: [{
        workspace_member_id: 'member-1', displayname: 'Design teammate',
        email: 'teammate@example.test', role: 'member', created_at: '2026-01-01',
      }] } });
    }
    return Response.json({ code: 0, data: { folders: [], projects: [] }, projects: [] });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('team space tab navigation', () => {
  it.each(['skill', 'mcp'])('keeps Members selected after switching from %s', async (tab) => {
    window.history.replaceState(null, '', `/team/team-1/${tab}`);
    render(<I18nProvider initial="en"><RoutedTeamSpace /></I18nProvider>);

    const resourceTab = await screen.findByRole('tab', { name: tab.toUpperCase() });
    expect(resourceTab.getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Members' }));
    });

    expect(window.location.pathname).toBe('/team/team-1/members');
    expect(screen.getByRole('tab', { name: 'Members' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Projects' }).getAttribute('aria-selected')).toBe('false');
    expect(await screen.findByText('Design teammate')).toBeTruthy();
  });

  it('lets a member enter and exit project multiselect without management permissions', async () => {
    window.history.replaceState(null, '', '/team/team-1');
    render(<I18nProvider initial="en"><RoutedTeamSpace /></I18nProvider>);
    const select = await screen.findByRole('button', { name: 'Multi-select' });
    fireEvent.click(select);
    expect(select.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(select);
    expect(select.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens the member list directly from its URL', async () => {
    window.history.replaceState(null, '', '/team/team-1/members');
    render(<I18nProvider initial="en"><RoutedTeamSpace /></I18nProvider>);

    expect(await screen.findByText('Design teammate')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Members' }).getAttribute('aria-selected')).toBe('true');
  });
});
