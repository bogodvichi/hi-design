// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { I18nProvider } from '../../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const skill = { resourceId: 'cloud-skill', localId: 'design-review', title: 'design-review', ownerMemberId: 'me' };
const list = (owner: string) => <I18nProvider initial="zh-CN"><CloudSkillList workspaceId="workspace"
  workspaceMemberId="me" workspaceType="team" ownerMemberId={owner} mode="square" scope="public" /></I18nProvider>;

describe('cloud Skill list request ordering', () => {
  it.each(['hdw', 'maas-skillhub'])('renders %s while the other community source is still loading', async (firstSource) => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const cloudFetch = vi.fn((input: RequestInfo | URL) => {
      const source = new URL(String(input), 'http://localhost').searchParams.get('source');
      return source === firstSource
        ? Promise.resolve(Response.json({ skills: [{ ...skill, provider: firstSource }] }))
        : pending;
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).startsWith('/api/workspace/skills/cloud?')
      ? cloudFetch(input) : Promise.resolve(Response.json({ skills: [] }))));
    render(<I18nProvider initial="zh-CN"><CloudSkillList workspaceId="workspace"
      workspaceMemberId="me" workspaceType="team" sourceProvider="all" mode="square" scope="public" /></I18nProvider>);
    try {
      expect(await screen.findByText('design-review')).toBeTruthy();
      expect(cloudFetch).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => { finish(Response.json({ skills: [{ ...skill, resourceId: 'second', title: 'Second source' }] })); });
    }
    expect(await screen.findByText('Second source')).toBeTruthy();
    expect(screen.getByText('design-review')).toBeTruthy();
  });

  it('explains a permission failure without exposing a code or calling it empty data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('/api/workspace/skills/cloud?')
        ? Response.json({ error: 'RESOURCE_ACCESS_DENIED' }, { status: 403 })
        : Response.json({ skills: [] })));
    render(list('me'));
    expect(await screen.findByText('没有 Skill 的访问权限，请联系所有者或团队管理员。')).toBeTruthy();
    expect(screen.queryByText('暂无数据')).toBeNull();
    expect(screen.queryByText('Failed to load cloud skills')).toBeNull();
  });

  it.each(['hdw', 'maas-skillhub'])('keeps the available community catalog when %s fails', async (failedSource) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.startsWith('/api/workspace/skills/cloud?')) return Response.json({ skills: [] });
      return new URL(url, 'http://localhost').searchParams.get('source') === failedSource
        ? Response.json({ error: 'RESOURCE_ACCESS_DENIED' }, { status: 403 })
        : Response.json({ skills: [skill] });
    }));
    render(<I18nProvider initial="zh-CN"><CloudSkillList workspaceId="workspace"
      workspaceMemberId="me" workspaceType="team" sourceProvider="all" mode="square" scope="public" /></I18nProvider>);
    expect(await screen.findByText('design-review')).toBeTruthy();
    if (failedSource === 'hdw') expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('ignores both old community sources after switching workspaces', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith('/api/workspace/skills/cloud?')) return Response.json({ skills: [] });
      if (new Headers(init?.headers).get('x-od-workspace-id') === 'old') return pending.then((response) => response.clone());
      const source = new URL(String(input), 'http://localhost').searchParams.get('source');
      return Response.json({ skills: source === 'hdw' ? [skill] : [] });
    }));
    const view = (workspace: string) => <I18nProvider initial="zh-CN"><CloudSkillList workspaceId={workspace}
      workspaceMemberId="me" workspaceType="team" sourceProvider="all" mode="square" scope="public" /></I18nProvider>;
    const { rerender } = render(view('old'));
    rerender(view('new'));
    await screen.findByText('design-review');
    await act(async () => { finish(Response.json({ skills: [{ ...skill, title: 'Old workspace Skill' }] })); });
    expect(screen.queryByText('Old workspace Skill')).toBeNull();
    expect(screen.getByText('design-review')).toBeTruthy();
  });

  it.each(['failure', 'success'])('ignores a stale %s after a newer request succeeds', async (result) => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('owner_member_id=old')) return pending;
      if (url.startsWith('/api/workspace/skills/cloud?')) return Response.json({ skills: [skill] });
      return Response.json({ skills: [] });
    }));
    const { rerender } = render(list('old'));
    rerender(list('me'));
    await screen.findByText('design-review');
    await act(async () => { finish(result === 'failure'
      ? Response.json({ error: 'internal_error' }, { status: 500 })
      : Response.json({ skills: [{ ...skill, title: 'Outdated result' }] })); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('design-review')).toBeTruthy();
    expect(screen.queryByText('Outdated result')).toBeNull();
  });

  it('shares identical concurrent list requests during Strict Mode mounting', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const cloudFetch = vi.fn(() => pending);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).startsWith('/api/workspace/skills/cloud?')
      ? cloudFetch() : Promise.resolve(Response.json({ skills: [] }))));
    render(<StrictMode>{list('me')}</StrictMode>);
    expect(cloudFetch).toHaveBeenCalledOnce();
    await act(async () => { finish(Response.json({ skills: [skill] })); });
    expect(screen.getByText('design-review')).toBeTruthy();
  });
});
