// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { I18nProvider } from '../../src/i18n';
import { ToastProvider } from '../../src/components/ToastProvider';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const resource = {
  id: 'skill-team-review', resourceId: 'skill-team-review', localId: 'review',
  title: 'review', ownerMemberId: 'other', publisherName: 'Other member',
  homeWorkspaceId: 'team', provider: 'hdw',
  installation: { status: 'not_installed', versionId: null },
};
function view(workspaceId = 'team') {
  return <I18nProvider initial="zh-CN"><ToastProvider><CloudSkillList
    workspaceId={workspaceId} workspaceMemberId="me" workspaceType="team" mode="team" memberRole="member"
  /></ToastProvider></I18nProvider>;
}

it('uses one team directory and never treats a same-name local Skill as installed', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/workspace/skills/team') return Response.json({ resources: [resource] });
    if (String(input) === '/api/skills') return Response.json({ skills: [{ id: 'review' }] });
    return Response.json({ skills: [{ ...resource, localId: 'review', installed: false }] });
  });
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(view());
  await screen.findByText('review');
  expect(container.querySelectorAll('article')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '添加' })).not.toBeDisabled();
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['/api/workspace/skills/team']);
});

it('adds and uninstalls by cloud identity, and remains uninstalled after a refresh', async () => {
  let installed = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/workspace/skills/team') return Response.json({ resources: [{ ...resource,
      installation: { status: installed ? 'installed' : 'not_installed', versionId: installed ? 'v1' : null },
    }] });
    if (init?.method === 'POST') installed = true;
    if (init?.method === 'DELETE') installed = false;
    return Response.json({ skills: [], installed, localId: 'review', ok: true });
  });
  vi.stubGlobal('fetch', fetcher);
  render(view());
  fireEvent.click(await screen.findByRole('button', { name: '添加' }));
  const added = await screen.findByRole('button', { name: '已添加' });
  await waitFor(() => expect(added).not.toBeDisabled());
  fireEvent.mouseEnter(added);
  fireEvent.click(screen.getByRole('button', { name: '卸载' }));
  await screen.findByRole('button', { name: '添加' });
  await act(async () => { window.dispatchEvent(new Event('personal:skill-refresh')); });
  expect(screen.queryByRole('button', { name: '已添加' })).toBeNull();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'DELETE')
    .map(([url]) => String(url))).toEqual([
      '/api/workspace/skills/cloud/skill-team-review/install?home_workspace_id=team&source=hdw',
      '/api/workspace/skills/cloud/skill-team-review/uninstall?home_workspace_id=team&source=hdw',
    ]);
});

it('ignores an old team directory response after switching teams', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Headers(init?.headers).get('x-od-workspace-id') === 'old' ? pending
      : Response.json({ resources: [resource], skills: [] })));
  const { rerender } = render(view('old'));
  rerender(view());
  await screen.findByText('review');
  await act(async () => { finish(Response.json({ resources: [{ ...resource, title: 'Old team' }] })); });
  expect(screen.queryByText('Old team')).toBeNull();
});
