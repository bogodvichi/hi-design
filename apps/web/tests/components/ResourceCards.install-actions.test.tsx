// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { CloudMcpList } from '../../src/components/CloudMcpList';
import { ResourceCard } from '../../src/components/ResourceCard';
import { I18nProvider } from '../../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture(kind: 'skill' | 'mcp', mode: 'square' | 'shared', succeeds = true, localRefreshFails = false) {
  let installed = true;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const record = { resourceId: 'cloud-resource', id: 'test-resource', localId: 'test-resource',
    title: 'Test resource', label: 'Test resource', ownerMemberId: 'me', transport: 'http',
    homeWorkspaceId: 'origin', url: 'https://mcp.example' };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE' && url.includes('/uninstall')) {
      await pending;
      if (!succeeds) return Response.json({ error: 'Please retry' }, { status: 500 });
      installed = false;
      return Response.json({ ok: true });
    }
    if (url.startsWith('/api/resource-share/shared-with-me')) return Response.json({ resources: [
      { ...record, shareId: 'share', metadata: record },
    ] });
    if (url.startsWith('/api/workspace/skills/cloud?')) return Response.json({ skills: [record] });
    if (url.startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates: [record] });
    if (url === '/api/skills' || url === '/api/mcp/servers') {
      if (!installed && localRefreshFails) return Response.json({}, { status: 503 });
      return url === '/api/skills'
        ? Response.json({ skills: installed ? [{ id: 'test-resource' }] : [] })
        : Response.json({ servers: installed ? [{ id: 'local', templateId: 'test-resource', cloudResourceId: 'cloud-resource', cloudHomeWorkspaceId: 'origin', workspaceId: 'personal', ownerMemberId: 'me' }] : [] });
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  const List = kind === 'skill' ? CloudSkillList : CloudMcpList;
  render(<I18nProvider initial="zh-CN"><List workspaceId="personal" workspaceMemberId="me" workspaceType="team" mode={mode} /></I18nProvider>);
  return { fetchMock, finish };
}

describe.each(['skill', 'mcp'] as const)('%s installation action', (kind) => {
  const status = kind === 'skill' ? '已添加' : '已连接';
  const action = kind === 'skill' ? '卸载' : '断开';
  const pending = kind === 'skill' ? '卸载中…' : '断开中…';
  const install = kind === 'skill' ? '添加' : '连接';

  it('shows the confirmed status after clicking until the next hover or focus', () => {
    const onInstall = vi.fn();
    const uninstall = vi.fn();
    const card = (installed: boolean, busy = false) => <I18nProvider initial="zh-CN"><ResourceCard
      kind={kind} title="Test resource" icon={null} meta="" installed={installed} installing={busy}
      busy={busy} onInstall={onInstall} actions={{ uninstall }} /></I18nProvider>;
    const { rerender } = render(card(false));
    const button = screen.getByRole('button', { name: install });
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(onInstall).toHaveBeenCalledOnce();
    rerender(card(false, true));
    fireEvent.mouseLeave(button);
    rerender(card(true));
    expect(screen.getByRole('button', { name: status })).toBe(button);
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('button', { name: action })).toBe(button);
    fireEvent.click(button);
    expect(uninstall).toHaveBeenCalledOnce();
    rerender(card(false));
    expect(screen.getByRole('button', { name: install })).toBe(button);
  });

  it('shows successful removal even if the follow-up local list read fails', async () => {
    const { finish } = fixture(kind, 'square', true, true);
    const button = await screen.findByRole('button', { name: status });
    fireEvent.mouseEnter(button);
    fireEvent.click(button);
    await act(async () => { finish(); });
    expect(await screen.findByRole('button', { name: install })).toBeTruthy();
    expect(screen.getByText('Test resource')).toBeTruthy();
  });

  it('shows successful installation even if the follow-up local list read fails', async () => {
    let installed = false;
    const record = { resourceId: 'cloud-resource', id: 'test-resource', localId: 'test-resource',
      title: 'Test resource', label: 'Test resource', ownerMemberId: 'me', transport: 'http' };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/install')) {
        installed = true;
        return Response.json({ installed: true, localId: 'test-resource' });
      }
      if (url === '/api/skills' || url === '/api/mcp/servers') return installed
        ? Response.json({}, { status: 503 }) : Response.json({ skills: [], servers: [] });
      return Response.json({ skills: [record], templates: [record] });
    }));
    const List = kind === 'skill' ? CloudSkillList : CloudMcpList;
    render(<I18nProvider initial="zh-CN"><List workspaceId="personal" workspaceMemberId="me" workspaceType="team" mode="square" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: install }));
    expect(await screen.findByRole('button', { name: status })).toBeTruthy();
  });

  it.each(['square', 'shared'] as const)('disconnects directly from the hovered status in %s', async (mode) => {
    const { fetchMock, finish } = fixture(kind, mode);
    const button = await screen.findByRole('button', { name: status });
    expect(button.hasAttribute('disabled')).toBe(false);
    const card = button.closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: '更多' }));
    expect(within(card).queryByRole('menuitem', { name: action })).toBeNull();
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('button', { name: action })).toBe(button);
    fireEvent.click(button);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const busyButton = screen.getByRole('button', { name: pending });
    expect(busyButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(busyButton);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    await act(async () => { finish(); });
    await screen.findByRole('button', { name: install });
    expect(screen.getByText('Test resource')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspace/${kind === 'skill' ? 'skills' : 'mcp'}/cloud/cloud-resource/uninstall?home_workspace_id=origin`,
      expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ 'x-od-workspace-id': 'personal' }) }),
    );
  });

  it('shows the reverse action on focus and restores the status on blur', async () => {
    fixture(kind, 'square');
    const button = await screen.findByRole('button', { name: status });
    fireEvent.focus(button);
    expect(screen.getByRole('button', { name: action })).toBe(button);
    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);
    expect(screen.getByRole('button', { name: action })).toBe(button);
    fireEvent.blur(button);
    expect(screen.getByRole('button', { name: status })).toBe(button);
  });

  it('retains the installation after failure and allows retry', async () => {
    const { fetchMock, finish } = fixture(kind, 'square', false);
    const button = await screen.findByRole('button', { name: status });
    fireEvent.mouseEnter(button);
    fireEvent.click(button);
    await act(async () => { finish(); });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Please retry');
    const retry = screen.getByRole('button', { name: status });
    expect(retry.hasAttribute('disabled')).toBe(false);
    fireEvent.mouseEnter(retry);
    expect(screen.getByRole('button', { name: action })).toBe(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(2));
  });

  it('keeps non-removable team installations read-only', () => {
    render(<I18nProvider initial="zh-CN"><ResourceCard kind={kind} title="Team resource" icon={null}
      meta="" installed installing={false} busy={false} onInstall={vi.fn()} actions={{}} /></I18nProvider>);
    const button = screen.getByRole('button', { name: status });
    fireEvent.mouseEnter(button);
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: action })).toBeNull();
  });
});
