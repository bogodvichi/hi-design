// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudMcpList } from '../../src/components/CloudMcpList';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { I18nProvider } from '../../src/i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Kind = 'skill' | 'mcp';
function installTeamCatalog(kind: Kind) {
  const externalId = kind + '-external';
  const nativeId = kind + '-native';
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/skills') return Response.json({ skills: [] });
    if (url === '/api/workspace/skills/team') return Response.json({ resources: [] });
    if (url === '/api/mcp/servers') return Response.json({ servers: [] });
    if (url.startsWith('/api/workspace/skills/cloud?')) return Response.json({ skills: [
      { resourceId: externalId, localId: externalId, title: 'External Skill', description: '',
        ownerMemberId: 'me', homeWorkspaceId: 'personal', homeWorkspaceMemberId: 'me',
        homeWorkspaceType: 'personal', canManage: true, createdAt: '', updatedAt: '' },
      { resourceId: nativeId, localId: nativeId, title: 'Team Skill', description: '',
        ownerMemberId: 'teammate', homeWorkspaceId: 'team', homeWorkspaceMemberId: 'me',
        homeWorkspaceType: 'team', canManage: false, createdAt: '', updatedAt: '' },
    ] });
    if (url.startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates: [
      { id: externalId, resourceId: externalId, label: 'External MCP', transport: 'http',
        ownerMemberId: 'me', homeWorkspaceId: 'personal', homeWorkspaceMemberId: 'me',
        homeWorkspaceType: 'personal', canManage: true },
      { id: nativeId, resourceId: nativeId, label: 'Team MCP', transport: 'http',
        ownerMemberId: 'teammate', homeWorkspaceId: 'team', homeWorkspaceMemberId: 'me',
        homeWorkspaceType: 'team', canManage: false },
    ] });
    return Response.json({ ok: true, code: 0 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <I18nProvider initial="zh-CN">
      {kind === 'skill'
        ? <CloudSkillList workspaceId="team" workspaceMemberId="me" workspaceType="team" mode="team" memberRole="admin" />
        : <CloudMcpList workspaceId="team" workspaceMemberId="me" workspaceType="team" mode="team" memberRole="admin" />}
    </I18nProvider>,
  );
  return fetchMock;
}

describe.each(['skill', 'mcp'] as const)('team %s deletion scope', (kind) => {
  it('does not delete another workspace source, even if the actor owns it', async () => {
    const fetchMock = installTeamCatalog(kind);
    const label = kind === 'skill' ? 'External Skill' : 'External MCP';
    const external = (await screen.findByText(label)).closest('article');
    expect(external).toBeTruthy();
    fireEvent.click(within(external!).getByRole('button', { name: '更多' }));
    expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes(kind + '-external')
      && init?.method === 'DELETE')).toBe(false);
  });

  it('allows a team admin to delete a native team resource without touching an external source', async () => {
    const fetchMock = installTeamCatalog(kind);
    const label = kind === 'skill' ? 'Team Skill' : 'Team MCP';
    const native = (await screen.findByText(label)).closest('article');
    expect(native).toBeTruthy();
    fireEvent.click(within(native!).getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/团队成员已有的连接及项目引用可能受到影响/)).toBeInTheDocument();
    const buttons = within(dialog).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]!);

    const targetPath = kind === 'skill'
      ? '/api/workspace/skills/cloud/skill-native'
      : '/api/workspace/mcp/cloud/mcp-native';
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => String(url) === targetPath
        && init?.method === 'DELETE')).toBe(true);
    });
    const [, request] = fetchMock.mock.calls.find(([url]) => String(url) === targetPath)!;
    expect(new Headers(request!.headers).get('x-od-workspace-id')).toBe('team');
    expect(new Headers(request!.headers).get('x-od-workspace-member-id')).toBe('me');
  });
});

it('allows a Skill creator to delete a team-only catalog item using its cloud ID', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/skills') return Response.json({ skills: [] });
    if (url.startsWith('/api/workspace/skills/cloud?')) return Response.json({ skills: [] });
    if (url === '/api/workspace/skills/team') return Response.json({ resources: [{
      id: 'mine', hubResourceId: 'skill-team-mine', ownerMemberId: 'me',
      title: 'My team Skill', description: 'Owned within this team',
    }] });
    return Response.json({ ok: true, code: 0 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<I18nProvider initial="zh-CN"><CloudSkillList
    workspaceId="team" workspaceMemberId="me" workspaceType="team"
    mode="team" memberRole="member"
  /></I18nProvider>);
  const resource = (await screen.findByText('My team Skill')).closest('article');
  expect(resource).toBeTruthy();
  fireEvent.click(within(resource!).getByRole('button', { name: '更多' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getAllByRole('button').at(-1)!);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    '/api/workspace/skills/cloud/skill-team-mine',
    expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({ 'x-od-workspace-id': 'team' }),
    }),
  ));
});

