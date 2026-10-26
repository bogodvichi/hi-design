// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { CloudMcpList } from '../../src/components/CloudMcpList';
import { I18nProvider } from '../../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
type Mode = 'shared' | 'team' | 'square' | 'personal';

function fixture(kind: 'skill' | 'mcp', mode: Mode, installed = false, owner = 'me') {
  const metadata = { id: 'test-resource', localId: 'test-resource', title: 'Test resource', label: 'Test resource',
    description: 'Full resource description', transport: 'http', url: 'https://mcp.example', logoKey: 'flow' };
  const record = { ...metadata, resourceId: 'cloud-resource', ownerMemberId: owner,
    homeWorkspaceId: 'team', homeWorkspaceMemberId: 'me', homeWorkspaceType: 'team', canManage: owner === 'me' };
  let deleted = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE' && url.endsWith('/cloud/cloud-resource')) { deleted = true; return Response.json({ ok: true }); }
    if (init?.method === 'DELETE' || init?.method === 'POST') return Response.json({ ok: true });
    if (url.startsWith('/api/resource-share/shared-with-me')) return Response.json({ resources: [{ ...record, shareId: 'recipient-share', metadata, sharedByDisplayname: 'Sharer' }] });
    if (url.startsWith('/api/workspace/skills/cloud?')) return Response.json({ skills: deleted ? [] : [record] });
    // A materialized team resource must not hide deletion of the original owned cloud record.
    if (url === '/api/workspace/skills/team') return Response.json({ resources: deleted ? [] : [{ id: 'test-resource', hubResourceId: 'cloud-resource', ownerMemberId: owner }] });
    if (url.startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates: deleted ? [] : [record] });
    if (url === '/api/skills') return Response.json({ skills: installed ? [{ id: 'test-resource' }] : [] });
    if (url === '/api/mcp/servers') return Response.json({ servers: installed || mode === 'team' ? [{ id: 'test-resource', templateId: 'test-resource', cloudResourceId: 'cloud-resource', cloudHomeWorkspaceId: 'team', workspaceId: 'team', ownerMemberId: owner, transport: 'http' }] : [] });
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  const List = kind === 'skill' ? CloudSkillList : CloudMcpList;
  const view = render(<I18nProvider initial="zh-CN"><List workspaceId="team" workspaceMemberId="me" workspaceType="team" mode={mode} /></I18nProvider>);
  return { fetchMock, ...view };
}

describe.each(['skill', 'mcp'] as const)('%s card consistency and permissions', (kind) => {
  it('does not expose sharing for a foreign public resource, while keeping the owner action', async () => {
    const owned = { resourceId: 'owned', id: 'owned', localId: 'owned', title: 'Owned resource', label: 'Owned resource', ownerMemberId: 'me', canManage: true, homeWorkspaceId: 'team', transport: 'http', url: 'https://mcp.example' };
    const foreign = { ...owned, resourceId: 'foreign', id: 'foreign', localId: 'foreign', title: 'Foreign resource', label: 'Foreign resource', ownerMemberId: 'other', canManage: false };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/cloud?')) return Response.json(kind === 'skill' ? { skills: [foreign, owned] } : { templates: [foreign, owned] });
      if (url === '/api/mcp/servers') return Response.json({ servers: [] });
      if (url === '/api/skills') return Response.json({ skills: [] });
      return Response.json({ resources: [] });
    }));
    const List = kind === 'skill' ? CloudSkillList : CloudMcpList;
    render(<I18nProvider initial="zh-CN"><List workspaceId="team" workspaceMemberId="me" workspaceType="team" mode="square" scope="public" /></I18nProvider>);
    const foreignCard = (await screen.findByText('Foreign resource')).closest('article')!;
    expect(within(foreignCard).queryByRole('button', { name: '更多' })).toBeNull();
    const ownerCard = (await screen.findByText('Owned resource')).closest('article')!;
    fireEvent.click(within(ownerCard).getByRole('button', { name: '更多' }));
    expect(within(ownerCard).getByRole('menuitem', { name: '分享' })).toBeTruthy();
  });

  it('offers share removal and forwarding without original resource management', async () => {
    fixture(kind, 'shared');
    const card = (await screen.findByText('Test resource')).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: '更多' }));
    expect(within(card).queryByRole('menuitem', { name: '删除' })).toBeNull();
    expect(within(card).getByRole('menuitem', { name: '分享' })).toBeTruthy();
    expect(within(card).getByRole('menuitem', { name: '从分享给我的删除' })).toBeTruthy();
    expect(within(card).queryByRole('menuitem', { name: '取消发布' })).toBeNull();
    expect(within(card).queryByRole('menuitem', { name: '查看详情' })).toBeNull();
    expect(screen.getByRole('button', { name: kind === 'skill' ? '添加' : '连接' })).toBeTruthy();
  });

  it('keeps the two requested shared menu actions after installation', async () => {
    fixture(kind, 'shared', true);
    const card = (await screen.findByText('Test resource')).closest('article')!;
    await screen.findByRole('button', { name: kind === 'skill' ? '已添加' : '已连接' });
    fireEvent.click(within(card).getByRole('button', { name: '更多' }));
    expect(within(card).getByRole('menuitem', { name: '分享' })).toBeTruthy();
    expect(within(card).getByRole('menuitem', { name: '从分享给我的删除' })).toBeTruthy();
    expect(within(card).queryByRole('menuitem', { name: kind === 'skill' ? '卸载' : '断开' })).toBeNull();
  });

  it('allows deleting my cloud resource even when the team has materialized it', async () => {
    const { fetchMock } = fixture(kind, 'team');
    const card = (await screen.findByText('Test resource')).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: '更多' }));
    const deleteButton = within(card).getByRole('menuitem', { name: '删除' });
    expect(deleteButton.className).toBe(within(card).getByRole('menuitem', { name: '分享' }).className);
    fireEvent.click(deleteButton);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/workspace/${kind === 'skill' ? 'skills' : 'mcp'}/cloud/cloud-resource`,
      expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ 'x-od-workspace-id': 'team', 'x-od-workspace-member-id': 'me' }) })));
    await waitFor(() => expect(screen.queryByText('Test resource')).toBeNull());
  });

  it('does not offer deletion of another member resource in the team', async () => {
    fixture(kind, 'team', false, 'other');
    const card = (await screen.findByText('Test resource')).closest('article')!;
    expect(within(card).queryByRole('button', { name: '更多' })).toBeNull();
    expect(within(card).queryByRole('menuitem', { name: '删除' })).toBeNull();
  });

  it('uses the same card and primary action markup in every location', async () => {
    const classNames: string[] = [];
    for (const mode of ['shared', 'square', 'team', 'personal'] as const) {
      const { unmount } = fixture(kind, mode);
      const card = (await screen.findByText('Test resource')).closest('article')!;
      const footer = card.querySelector('footer');
      expect(footer).toBeTruthy();
      classNames.push(footer!.className);
      expect(footer!.querySelector('.community-template-card__actions button')).toBeTruthy();
      unmount();
    }
    expect(new Set(classNames).size).toBe(1);
  });
});
