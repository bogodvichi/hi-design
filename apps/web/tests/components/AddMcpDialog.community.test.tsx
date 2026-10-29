// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { AddMcpDialog } from '../../src/components/AddMcpDialog';

vi.mock('../../src/collab/useWorkspaceContext', async (original) => ({
  ...await original<typeof import('../../src/collab/useWorkspaceContext')>(),
  useWorkspaceContext: () => ({ context: null, loading: false }),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('lists community MCPs and connects to the target team using the original source', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST' && url.includes('/install?')) return pending;
    if (url.startsWith('/api/workspace/mcp/cloud?')) return Promise.resolve(Response.json({ templates: [{
      id: 'review', resourceId: 'publication', label: 'Community MCP', ownerMemberId: 'author',
      homeWorkspaceId: 'source-team', transport: 'http', url: 'https://mcp.example',
    }] }));
    return Promise.resolve(Response.json({ servers: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const context = { workspaceId: 'target-team', workspaceMemberId: 'target-member', workspaceType: 'team',
    role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: {} } as WorkspaceCollabContext;
  render(<I18nProvider initial="zh-CN"><AddMcpDialog open onClose={vi.fn()} workspaceContext={context} /></I18nProvider>);
  fireEvent.click(screen.getByRole('tab', { name: '社区' }));
  expect(await screen.findByText('Community MCP')).toBeTruthy();
  expect(screen.queryByText('相关内容将显示在这里。')).toBeNull();
  expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '连接' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/workspace/mcp/cloud/publication/install?home_workspace_id=source-team',
    expect.objectContaining({ method: 'POST', headers: expect.objectContaining({
      'x-od-workspace-id': 'target-team', 'x-od-workspace-member-id': 'target-member',
    }) }));
  expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true);
  await act(async () => { finish(Response.json({ installed: true, serverId: 'review' })); });
  expect(await screen.findByText('已连接')).toBeTruthy();
  expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(false);
});
