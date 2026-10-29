// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { I18nProvider } from '../../src/i18n';
import { readCommunitySkillCatalog } from '../../src/runtime/community-skill-catalog';

const identity = vi.hoisted(() => ({ token: 'account-a' }));
vi.mock('../../src/collab/useWorkspaceContext', async (original) => ({
  ...await original<typeof import('../../src/collab/useWorkspaceContext')>(),
  currentWorkspaceContextRequestToken: () => identity.token,
}));

const skill = (provider: string, title = provider === 'hdw' ? 'Community review' : 'Skillhub review') => ({
  resourceId: provider, localId: `${provider}-review`, title, provider,
  ownerMemberId: 'author', category: provider === 'hdw' ? 'other' : 'development_tools',
});
let cloudFetch: ReturnType<typeof vi.fn<(source: string, init?: RequestInit) => Promise<Response>>>;
let localSkills: Array<{ id: string; cloudResourceId?: string }>;
const view = (workspace = 'workspace') => <I18nProvider initial="zh-CN"><CloudSkillList
  workspaceId={workspace} workspaceMemberId="me" workspaceType="team" mode="square" scope="public" sourceProvider="all"
/></I18nProvider>;
const settle = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  identity.token = 'account-a';
  localSkills = [];
  cloudFetch = vi.fn(async (source: string) => Response.json({ skills: [skill(source)] }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/skills') return Response.json({ skills: localSkills });
    if (url.pathname === '/api/workspace/skills/cloud') return cloudFetch(url.searchParams.get('source')!, init);
    return Response.json({ installed: true, localId: 'installed-review' });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('community Skill catalog reuse', () => {
  it('keeps the metadata snapshot when a reentry check returns unchanged content', async () => {
    const params = new URLSearchParams({ scope: 'public', source: 'maas-skillhub' });
    const first = await readCommunitySkillCatalog(params, {}, identity.token).updated;
    const next = readCommunitySkillCatalog(params, {}, identity.token, true);
    expect(next.cached).toBe(first);
    expect(await next.updated).toBe(first);
    expect(cloudFetch).toHaveBeenCalledTimes(2);
  });

  it('opens a large cached catalog with one batch, yields before adding more, and searches the full catalog', async () => {
    const idleCallbacks = new Map<number, () => void>();
    let nextHandle = 0;
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: () => void) => {
      idleCallbacks.set(++nextHandle, callback);
      return nextHandle;
    }));
    vi.stubGlobal('cancelIdleCallback', vi.fn((handle: number) => idleCallbacks.delete(handle)));
    cloudFetch.mockImplementation(async (source: string) => Response.json({ skills: source === 'hdw' ? []
      : Array.from({ length: 60 }, (_, index) => ({ ...skill(source, `Skill ${index}`), resourceId: `skill-${index}` })) }));
    const first = render(view());
    await settle();
    first.unmount();
    const second = render(view());
    await settle();
    expect(cloudFetch).toHaveBeenCalledTimes(4);
    expect(screen.getAllByRole('button', { name: '添加' })).toHaveLength(12);
    const firstCard = screen.getByText('Skill 0').closest('article');
    const [handle, callback] = [...idleCallbacks][0]!;
    idleCallbacks.delete(handle);
    await act(async () => { callback(); });
    expect(screen.getAllByRole('button', { name: '添加' })).toHaveLength(24);
    expect(screen.getByText('Skill 0').closest('article')).toBe(firstCard);
    expect(screen.queryByText('Skill 59')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Skill 59' } });
    expect(screen.getAllByRole('button', { name: '添加' })).toHaveLength(1);
    expect(screen.getByText('Skill 59').closest('article')!.querySelector('button')).toBeTruthy();
    expect(cloudFetch).toHaveBeenCalledTimes(4);
    second.unmount();
    expect(idleCallbacks.size).toBe(0);
  });

  it('eventually renders the complete catalog when idle callbacks are unavailable', async () => {
    cloudFetch.mockImplementation(async (source: string) => Response.json({ skills: source === 'hdw' ? []
      : Array.from({ length: 60 }, (_, index) => ({ ...skill(source, `Skill ${index}`), resourceId: `skill-${index}` })) }));
    render(view());
    await settle();
    expect(screen.getAllByRole('button', { name: '添加' })).toHaveLength(12);
    for (let batch = 0; batch < 4; batch += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(16); });
    }
    expect(screen.getAllByRole('button', { name: '添加' })).toHaveLength(60);
    expect(cloudFetch).toHaveBeenCalledTimes(2);
  });

  it('immediately shows the cache on reopening, checks both sources, and refreshes installation state', async () => {
    const first = render(view());
    await settle();
    expect(screen.getByText('Skillhub review')).toBeTruthy();
    first.unmount();
    localSkills = [{ id: 'installed-review', cloudResourceId: 'maas-skillhub:maas-skillhub' }];
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    cloudFetch.mockImplementation(async (source: string) => {
      await pending;
      return Response.json({ skills: [skill(source, `${source} updated`)] });
    });
    render(view());
    await settle();
    expect(screen.getByText('Skillhub review')).toBeTruthy();
    expect(cloudFetch).toHaveBeenCalledTimes(4);
    expect(screen.getByText('已添加')).toBeTruthy();
    expect(screen.queryByText('正在加载…')).toBeNull();
    await act(async () => { finish(); });
    expect(screen.queryByText('Skillhub review')).toBeNull();
    expect(screen.getByText('maas-skillhub updated')).toBeTruthy();
    expect(screen.getByText('hdw updated')).toBeTruthy();
  });

  it('searches and filters the loaded catalog without requesting Skillhub again', async () => {
    render(view());
    await settle();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Skillhub' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText('Skillhub review')).toBeTruthy();
    expect(screen.queryByText('Community review')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '分类' }));
    expect(screen.getByRole('menuitemradio', { name: '全部 (1)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemradio', { name: '其他 (0)' }));
    await settle();
    expect(screen.queryByText('Skillhub review')).toBeNull();
    expect(cloudFetch).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight reentry check across quickly reopened lists and replaces cached results', async () => {
    const first = render(view());
    await settle();
    first.unmount();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    cloudFetch.mockImplementation(async (source: string) => {
      await pending;
      return Response.json({ skills: [skill(source, `${source} updated`)] });
    });
    const second = render(view());
    await settle();
    expect(screen.getByText('Skillhub review')).toBeTruthy();
    second.unmount();
    render(view());
    await settle();
    expect(cloudFetch).toHaveBeenCalledTimes(4);
    await act(async () => { finish(); });
    expect(screen.queryByText('Skillhub review')).toBeNull();
    expect(screen.getAllByText('maas-skillhub updated')).toHaveLength(1);
  });

  it('retains stale content when background revalidation has a network failure', async () => {
    const first = render(view());
    await settle();
    first.unmount();
    cloudFetch.mockRejectedValue(new TypeError('Network unavailable'));
    render(view());
    await settle();
    expect(screen.getByText('Skillhub review')).toBeTruthy();
    expect(screen.getByText('Community review')).toBeTruthy();
  });

  it('invalidates HiDesign publications without reloading the Skillhub directory', async () => {
    render(view());
    await settle();
    cloudFetch.mockImplementation(async (source: string) => Response.json({ skills: [skill(source, `${source} updated`)] }));
    await act(async () => { window.dispatchEvent(new CustomEvent('personal:skill-refresh')); });
    expect(screen.getByText('hdw updated')).toBeTruthy();
    expect(screen.getByText('Skillhub review')).toBeTruthy();
    expect(cloudFetch).toHaveBeenCalledTimes(3);
  });

  it('does not reuse catalogs across workspaces or account generations', async () => {
    const first = render(view());
    await settle();
    first.unmount();
    const second = render(view('another-workspace'));
    await settle();
    expect(cloudFetch).toHaveBeenCalledTimes(4);
    second.unmount();
    identity.token = 'account-b';
    cloudFetch.mockImplementation(async () => Response.json({ skills: [] }));
    render(view());
    await settle();
    expect(cloudFetch).toHaveBeenCalledTimes(6);
    expect(screen.queryByText('Skillhub review')).toBeNull();
  });

  it('drops stale catalogs after an authoritative access denial', async () => {
    const first = render(view());
    await settle();
    first.unmount();
    cloudFetch.mockImplementation(async () => Response.json({ error: 'RESOURCE_ACCESS_DENIED' }, { status: 403 }));
    render(view());
    await settle();
    expect(screen.queryByText('Skillhub review')).toBeNull();
    expect(screen.queryByText('Community review')).toBeNull();
    expect(screen.getByText('没有 Skill 的访问权限，请联系所有者或团队管理员。')).toBeTruthy();
  });

  it('shares one catalog invalidation across mounted pickers and refreshes installation state independently', async () => {
    render(<>{view()}{view()}</>);
    await settle();
    expect(cloudFetch).toHaveBeenCalledTimes(2);
    localSkills = [{ id: 'installed-review', cloudResourceId: 'maas-skillhub:maas-skillhub' }];
    await act(async () => { window.dispatchEvent(new CustomEvent('personal:skill-refresh', {
      detail: { source: 'cloud-skill-list', instanceId: 'another-picker' },
    })); });
    expect(screen.getAllByText('已添加')).toHaveLength(2);
    expect(cloudFetch).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new CustomEvent('personal:skill-refresh')); });
    expect(cloudFetch).toHaveBeenCalledTimes(3);
  });

  it('does not trust cached installed flags or a same-named local Skill as a Skillhub binding', async () => {
    localSkills = [{ id: 'maas-skillhub-review' }];
    cloudFetch.mockImplementation(async (source: string) => Response.json({ skills: [{ ...skill(source), installed: true }] }));
    render(view());
    await settle();
    expect(screen.queryByText('已添加')).toBeNull();
  });

  it('does not apply an old workspace installation response to the new workspace', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' && String(input).includes('/install') ? pending : originalFetch(input, init)));
    const { rerender } = render(view());
    await settle();
    fireEvent.click(screen.getAllByRole('button', { name: '添加' })[0]!);
    rerender(view('another-workspace'));
    await settle();
    await act(async () => { finish(Response.json({ installed: true, localId: 'installed-review' })); });
    expect(screen.queryByText('已添加')).toBeNull();
  });
});
