// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SquareView } from '../../src/components/SquareView';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/components/PublishDialog', () => ({
  PublishDialog: ({ onPublish }: { onPublish: (input: unknown) => Promise<void> }) => <button onClick={() => { void onPublish({
    label: 'Team MCP', description: 'Team description', config: '', resourceId: 'mcp-team',
    workspaceContext: {
      workspaceId: 'team', workspaceMemberId: 'team-member', workspaceType: 'team',
      role: 'owner', lifecycleState: 'active', memberStatus: 'active',
      permissions: { canShareProjects: true, canWriteSyncedFiles: true },
    },
  }); }}>Publish team MCP</button>,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('community MCP publication request', () => {
  it('passes the original source identity for server-side independent community copy creation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/workspace/directory') return Response.json({ items: [{ workspaceId: 'personal', workspaceMemberId: 'personal-member', workspaceType: 'team', isDefaultTeam: true }] });
      if (url === '/api/mcp/servers') return Response.json({ servers: [] });
      if (url.startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates: [] });
      return Response.json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<I18nProvider initial="zh-CN"><SquareView tab="mcp" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '新建发布' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish team MCP' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/workspace/mcp/cloud/mcp-team/publish', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'x-od-workspace-id': 'team', 'x-od-workspace-member-id': 'team-member' }),
    })));
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/workspace/mcp/cloud')).toBe(false);
  });
});
