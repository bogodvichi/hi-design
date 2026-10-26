// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudMcpList } from '../../src/components/CloudMcpList';
import { I18nProvider } from '../../src/i18n';

type Mode = 'square' | 'personal' | 'team';
const workspaceMemberId = 'member';
const catalogItem = {
  id: 'same-slug', resourceId: 'cloud-resource-1', label: 'Research MCP',
  description: 'Research reports', transport: 'http', category: 'utilities',
  url: 'https://example.invalid/mcp', ownerMemberId: workspaceMemberId,
  homeWorkspaceId: 'origin-workspace', createdAt: '', updatedAt: '',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(mode: Mode, initiallyConnected = false) {
  const workspaceId = mode === 'team' ? 'team-workspace' : 'personal-workspace';
  let connected = initiallyConnected;
  let catalogFetches = 0;
  const server = {
    id: 'local-1', templateId: catalogItem.id, cloudResourceId: catalogItem.resourceId,
    cloudHomeWorkspaceId: catalogItem.homeWorkspaceId,
    workspaceId, ownerMemberId: workspaceMemberId, transport: 'http',
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/mcp/servers') return Response.json({ servers: connected ? [server] : [] });
    if (url.startsWith('/api/workspace/mcp/cloud?')) {
      catalogFetches++;
      return Response.json({ templates: [catalogItem] });
    }
    if (url.includes('/install') && init?.method === 'POST') {
      connected = true;
      return Response.json({ installed: true });
    }
    if (url.includes('/uninstall') && init?.method === 'DELETE') {
      connected = false;
      return Response.json({ ok: true });
    }
    if (url === '/api/community/stats/record') return Response.json({
      stats: { actionUserCount: 2, actionCount: 5 },
    });
    throw new Error('Unexpected request: ' + url);
  });
  vi.stubGlobal('fetch', fetchMock);
  const props = { workspaceId, workspaceMemberId, workspaceType: 'team', mode, ...(mode === 'square' ? { scope: 'public' } : {}) } as const;
  const renderList = () => render(<I18nProvider initial="zh-CN"><CloudMcpList {...props} /></I18nProvider>);
  return { renderList, fetchMock, get catalogFetches() { return catalogFetches; } };
}

describe('MCP connection state without page refresh', () => {
  it.each(['square', 'personal', 'team'] as const)('connects and disconnects immediately in %s', async (mode) => {
    const state = setup(mode);
    state.renderList();
    const connect = await screen.findByRole('button', { name: '连接' });
    fireEvent.click(connect);
    const connected = await screen.findByRole('button', { name: '已连接' });
    expect(connected.hasAttribute('disabled')).toBe(false);
    expect(state.catalogFetches).toBe(1);
    fireEvent.mouseEnter(connected);
    const disconnect = screen.getByRole('button', { name: '断开' });
    fireEvent.click(disconnect);
    const reconnected = await screen.findByRole('button', { name: '连接' });
    expect(reconnected.hasAttribute('disabled')).toBe(false);
    expect(state.catalogFetches).toBe(1);
    expect(state.fetchMock).toHaveBeenCalledWith(
      '/api/workspace/mcp/cloud/cloud-resource-1/uninstall?home_workspace_id=origin-workspace',
      expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({
        'x-od-workspace-id': mode === 'team' ? 'team-workspace' : 'personal-workspace',
        'x-od-workspace-member-id': workspaceMemberId,
      }) }),
    );
  });

  it.each(['square', 'personal', 'team'] as const)('allows disconnecting an existing cloud install in %s', async (mode) => {
    const state = setup(mode, true);
    state.renderList();
    const connected = await screen.findByRole('button', { name: '已连接' });
    expect(connected.hasAttribute('disabled')).toBe(false);
    fireEvent.mouseEnter(connected);
    fireEvent.click(screen.getByRole('button', { name: '断开' }));
    expect(await screen.findByRole('button', { name: '连接' })).toBeTruthy();
  });

  it('syncs the same connection immediately between mounted community and personal lists', async () => {
    const state = setup('square');
    // Both surfaces use the same workspace/member identity.
    render(<I18nProvider initial="zh-CN">
      <section aria-label="社区"><CloudMcpList workspaceId="personal-workspace" workspaceMemberId={workspaceMemberId} workspaceType="team" mode="square" scope="public" /></section>
      <section aria-label="个人所有"><CloudMcpList workspaceId="personal-workspace" workspaceMemberId={workspaceMemberId} workspaceType="team" mode="personal" /></section>
    </I18nProvider>);
    const community = within(screen.getByRole('region', { name: '社区' }));
    const personal = within(screen.getByRole('region', { name: '个人所有' }));
    fireEvent.click(await community.findByRole('button', { name: '连接' }));
    expect(await community.findByRole('button', { name: '已连接' })).toBeTruthy();
    expect(await personal.findByRole('button', { name: '已连接' })).toBeTruthy();
    const connected = personal.getByRole('button', { name: '已连接' });
    fireEvent.mouseEnter(connected);
    fireEvent.click(personal.getByRole('button', { name: '断开' }));
    expect(await community.findByRole('button', { name: '连接' })).toBeTruthy();
    expect(await personal.findByRole('button', { name: '连接' })).toBeTruthy();
    expect(state.catalogFetches).toBe(2);
  });

  it('keeps equal template slugs from different source workspaces independent', async () => {
    const items = [
      { ...catalogItem, label: 'Workspace A MCP', homeWorkspaceId: 'workspace-a', resourceId: 'resource-a' },
      { ...catalogItem, label: 'Workspace B MCP', homeWorkspaceId: 'workspace-b', resourceId: 'resource-b' },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/mcp/servers') return Response.json({ servers: [] });
      if (url.startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates: items });
      if (init?.method === 'POST' && url.includes('/install')) return Response.json({ installed: true });
      if (url === '/api/community/stats/record') return Response.json({});
      throw new Error('Unexpected request: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<I18nProvider initial="zh-CN">
      <CloudMcpList workspaceId="personal-workspace" workspaceMemberId={workspaceMemberId} workspaceType="team" mode="square" scope="public" />
    </I18nProvider>);
    const first = (await screen.findByText('Workspace A MCP')).closest('article')!;
    const second = (await screen.findByText('Workspace B MCP')).closest('article')!;
    fireEvent.click(within(first).getByRole('button', { name: '连接' }));
    await waitFor(() => expect(within(first).getByRole('button', { name: '已连接' })).toBeTruthy());
    expect(within(second).getByRole('button', { name: '连接' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/mcp/cloud/resource-a/install?home_workspace_id=workspace-a',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not use another member\'s connection in the same workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/mcp/servers') return Response.json({ servers: [{
        id: 'someone-elses', cloudResourceId: catalogItem.resourceId,
        cloudHomeWorkspaceId: catalogItem.homeWorkspaceId,
        workspaceId: 'team-workspace', ownerMemberId: 'other-member',
      }] });
      return Response.json({ templates: [catalogItem] });
    }));
    render(<I18nProvider initial="zh-CN"><CloudMcpList
      workspaceId="team-workspace" workspaceMemberId={workspaceMemberId}
      workspaceType="team" mode="team"
    /></I18nProvider>);
    expect(await screen.findByRole('button', { name: '连接' })).toBeTruthy();
  });

  it('ignores a stale local list read that finishes after a successful connect', async () => {
    let resolveLocalRead!: (response: Response) => void;
    const staleLocalRead = new Promise<Response>((resolve) => { resolveLocalRead = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/mcp/servers') return staleLocalRead;
      if (url.startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates: [catalogItem] });
      if (init?.method === 'POST') return Response.json({ installed: true });
      throw new Error('Unexpected request: ' + url);
    }));
    render(<I18nProvider initial="zh-CN"><CloudMcpList
      workspaceId="personal-workspace" workspaceMemberId={workspaceMemberId}
      workspaceType="team" mode="personal"
    /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    expect(await screen.findByRole('button', { name: '已连接' })).toBeTruthy();
    await act(async () => { resolveLocalRead(Response.json({ servers: [] })); });
    expect(screen.getByRole('button', { name: '已连接' })).toBeTruthy();
  });

  it('does not wait for slow community statistics to show the confirmed connection', async () => {
    let finishStats!: (response: Response) => void;
    const pendingStats = new Promise<Response>((resolve) => { finishStats = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/mcp/servers') return Response.json({ servers: [] });
      if (url.startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates: [catalogItem] });
      if (init?.method === 'POST' && url.includes('/install')) return Response.json({ installed: true });
      if (url === '/api/community/stats/record') return pendingStats;
      throw new Error('Unexpected request: ' + url);
    }));
    render(<I18nProvider initial="zh-CN"><CloudMcpList
      workspaceId="personal-workspace" workspaceMemberId={workspaceMemberId}
      workspaceType="team" mode="square" scope="public"
    /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    const connected = await screen.findByRole('button', { name: '已连接' });
    expect(connected.hasAttribute('disabled')).toBe(false);
    await act(async () => { finishStats(Response.json({ stats: { actionUserCount: 2, actionCount: 5 } })); });
    expect(screen.getByLabelText('接入人数 2, 接入次数 5')).toBeTruthy();
  });

  it('keeps the previous state and reports a failed connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/mcp/servers') return Response.json({ servers: [] });
      if (url.startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates: [catalogItem] });
      if (init?.method === 'POST') return Response.json({ error: 'Connect failed' }, { status: 500 });
      throw new Error('Unexpected request: ' + url);
    }));
    render(<I18nProvider initial="zh-CN"><CloudMcpList
      workspaceId="personal-workspace" workspaceMemberId={workspaceMemberId}
      workspaceType="team" mode="personal"
    /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Connect failed');
    expect(screen.getByRole('button', { name: '连接' })).toBeTruthy();
  });
});
