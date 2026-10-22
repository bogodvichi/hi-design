// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudMcpList } from '../../src/components/CloudMcpList';
import { I18nProvider } from '../../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/mcp/servers') return Response.json({ servers: [{ id: 'private-local', label: 'Private local MCP', transport: 'stdio', command: 'private', enabled: true }] });
    if (String(input).startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates: [
      { id: 'same-name', resourceId: 'mcp-team', label: 'Team MCP', transport: 'http', url: 'https://mcp.example',
        ownerMemberId: 'team-member', homeWorkspaceId: 'team', homeWorkspaceMemberId: 'team-member', homeWorkspaceType: 'team', canManage: true },
      { id: 'same-name', resourceId: 'mcp-other', label: 'Other MCP', transport: 'http', ownerMemberId: 'other', canManage: false },
    ] });
    return Response.json({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<I18nProvider initial="zh-CN"><CloudMcpList workspaceId="personal" workspaceMemberId="personal-member" workspaceType="team" mode="square" scope="public" /></I18nProvider>);
  return fetchMock;
}
describe('public MCP catalog', () => {
  it('retains same-name public resources from different workspaces and excludes private local MCPs', async () => {
    fixture();
    expect(await screen.findByText('Team MCP')).toBeTruthy();
    expect(screen.getByText('Other MCP')).toBeTruthy();
    expect(screen.queryByText('Private local MCP')).toBeNull();
  });
  it.each(['取消发布', '删除'])('uses the source identity for %s', async (action) => {
    const fetchMock = fixture(); const title = await screen.findByText('Team MCP');
    fireEvent.click(title.closest('article')!.querySelector('button')!);
    fireEvent.click(screen.getByRole('button', { name: action }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: action }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/workspace/mcp/cloud/mcp-team' + (action === '取消发布' ? '/unpublish' : ''),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-od-workspace-id': 'team', 'x-od-workspace-member-id': 'team-member' }) })));
  });
});
