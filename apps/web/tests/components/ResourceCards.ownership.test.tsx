// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { CloudMcpList } from '../../src/components/CloudMcpList';
import { I18nProvider } from '../../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each(['skill', 'mcp'] as const)('%s installation does not imply ownership', (kind) => {
  it('keeps a community installation out of Personal while retaining resources I own', async () => {
    let installed = false;
    const foreign = { resourceId: 'community-resource', id: 'community-item', localId: 'community-item',
      title: 'Community item', label: 'Community item', ownerMemberId: 'other-member', transport: 'http', url: 'https://mcp.example' };
    const owned = { ...foreign, resourceId: 'owned-resource', id: 'owned-item', localId: 'owned-item', title: 'My own item', label: 'My own item', ownerMemberId: 'me' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/cloud/community-resource/install')) { installed = true; return Response.json({ installed: true, localId: 'community-item' }); }
      if (url.startsWith('/api/workspace/skills/cloud?') || url.startsWith('/api/workspace/mcp/cloud?')) {
        const query = new URL(url, 'http://localhost').searchParams;
        const rows = query.get('owner_member_id') === 'me' ? [owned] : [foreign];
        return Response.json(kind === 'skill' ? { skills: rows } : { templates: rows });
      }
      if (url === '/api/skills') return Response.json({ skills: installed ? [{ id: 'community-item' }] : [] });
      if (url === '/api/mcp/servers') return Response.json({ servers: installed ? [
        { id: 'installed-community', label: 'Community item', templateId: 'community-item', ownerMemberId: 'other-member', workspaceId: 'personal', transport: 'http' },
        { id: 'local-settings', label: 'Local connection', transport: 'stdio', command: 'local' },
      ] : [] });
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const List = kind === 'skill' ? CloudSkillList : CloudMcpList;
    const view = render(<I18nProvider initial="zh-CN"><List workspaceId="personal" workspaceMemberId="me" workspaceType="team" mode="square" scope="public" /></I18nProvider>);
    await screen.findByText('Community item');
    fireEvent.click(screen.getByRole('button', { name: kind === 'skill' ? '添加' : '连接' }));
    await screen.findByRole('button', { name: kind === 'skill' ? '已添加' : '已连接' });
    view.unmount();
    render(<I18nProvider initial="zh-CN"><List workspaceId="personal" workspaceMemberId="me" workspaceType="team" mode="personal" /></I18nProvider>);
    await screen.findByText('My own item');
    expect(screen.queryByText('Community item')).toBeNull();
    expect(screen.queryByText('Local connection')).toBeNull();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/cloud') && init?.method === 'POST')).toBe(false);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('does not fall back to installed resources when the owned catalog fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/cloud?')) return Response.json({ error: 'unavailable' }, { status: 503 });
      return Response.json({ servers: [{ id: 'local', label: 'Unowned local item', templateId: 'local', transport: 'stdio' }], skills: [{ id: 'local' }] });
    }));
    const List = kind === 'skill' ? CloudSkillList : CloudMcpList;
    render(<I18nProvider initial="zh-CN"><List workspaceId="personal" workspaceMemberId="me" workspaceType="team" mode="personal" /></I18nProvider>);
    await waitFor(() => expect(screen.getByText(kind === 'skill' ? 'Failed to load cloud skills' : 'Failed to load cloud MCP templates')).toBeTruthy());
    expect(screen.queryByText('Unowned local item')).toBeNull();
  });
});
