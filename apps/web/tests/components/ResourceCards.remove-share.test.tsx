// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { CloudMcpList } from '../../src/components/CloudMcpList';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/components/PersonPicker', () => ({
  PersonPicker: ({ onChange }: { onChange: (people: unknown[]) => void }) =>
    <button type="button" onClick={() => onChange([{ name: 'Recipient', email: 'recipient@example.test' }])}>Choose recipient</button>,
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture(kind: 'skill' | 'mcp', installed: boolean, ok = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE') return Response.json({ ok });
    if (url.startsWith('/api/resource-share/shared-with-me?')) return Response.json({ resources: ['First', 'Second'].map((name) => ({
      shareId: `share/${name}`, resourceId: `resource-${name}`, homeWorkspaceId: 'origin', ownerMemberId: 'other',
      metadata: { id: name, localId: name, title: name, label: name, transport: 'http' },
    })) });
    if (url === '/api/skills') return Response.json({ skills: installed ? [{ id: 'First' }] : [] });
    if (url === '/api/mcp/servers') return Response.json({ servers: installed ? [{ id: 'First', templateId: 'First' }] : [] });
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  const List = kind === 'skill' ? CloudSkillList : CloudMcpList;
  render(<I18nProvider initial="zh-CN"><List workspaceId="personal" workspaceMemberId="me" workspaceType="team" mode="shared" /></I18nProvider>);
  return fetchMock;
}

describe.each(['skill', 'mcp'] as const)('remove shared %s reference', (kind) => {
  it.each([false, true])('forwards the original resource and retains grey removal, installed=%s', async (installed) => {
    const fetchMock = fixture(kind, installed);
    const card = (await screen.findByText('First')).closest('article')!;
    if (installed) await screen.findByRole('button', { name: kind === 'skill' ? '已添加' : '已连接' });
    fireEvent.click(within(card).getByRole('button', { name: '更多' }));
    const share = within(card).getByRole('menuitem', { name: '分享' });
    expect(within(card).getByRole('menuitem', { name: '从分享给我的删除' }).className).toBe(share.className);
    fireEvent.click(share);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('First')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose recipient' }));
    fireEvent.submit(dialog);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/resource-share/share', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ resource_id: 'resource-First', kind, home_workspace_id: 'origin', recipients: [{ username: 'recipient', displayname: 'Recipient' }] }),
    })));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it.each([false, true])('removes only my selected share, installed=%s', async (installed) => {
    const fetchMock = fixture(kind, installed);
    const card = (await screen.findByText('First')).closest('article')!;
    if (installed) await screen.findByRole('button', { name: kind === 'skill' ? '已添加' : '已连接' });
    fireEvent.click(within(card).getByRole('button', { name: '更多' }));
    fireEvent.click(within(card).getByRole('menuitem', { name: '从分享给我的删除' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(dialog.textContent).toContain('不会删除原始资源');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByText('First')).toBeNull());
    expect(screen.getByText('Second')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toEqual([
      [`/api/resource-share/shared-with-me/share%2FFirst?kind=${kind}`, { method: 'DELETE' }],
    ]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('keeps the card when removal fails and allows retry', async () => {
    fixture(kind, false, false);
    const card = (await screen.findByText('First')).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: '更多' }));
    fireEvent.click(within(card).getByRole('menuitem', { name: '从分享给我的删除' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '删除' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '删除失败，请重试');
    expect(screen.getByText('First')).toBeTruthy();
  });

  it('does not remove the reference when confirmation is cancelled', async () => {
    const fetchMock = fixture(kind, false);
    const card = (await screen.findByText('First')).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: '更多' }));
    fireEvent.click(within(card).getByRole('menuitem', { name: '从分享给我的删除' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('First')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
});
