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
