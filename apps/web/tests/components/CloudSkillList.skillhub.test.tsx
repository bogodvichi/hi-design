// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudSkillList } from '../../src/components/CloudSkillList';
import { I18nProvider } from '../../src/i18n';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CloudSkillList Skillhub integration', () => {
  it.each(['取消发布', '删除'])('uses the source team identity for %s on My publishes', async (action) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/workspace/skills/cloud?')) return jsonResponse({ skills: [{
        resourceId: 'skill-team-analysis', localId: 'ued-requirement-analysis', title: 'ued-requirement-analysis', ownerMemberId: 'team-member',
        homeWorkspaceId: 'team-a', homeWorkspaceMemberId: 'team-member', homeWorkspaceType: 'team', canManage: true,
      }] });
      if (url === '/api/skills') return jsonResponse({ skills: [] });
      return jsonResponse({ ok: true });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    render(<I18nProvider initial="zh-CN"><CloudSkillList workspaceId="personal" workspaceMemberId="personal-member" workspaceType="team"
      ownerMemberId="personal-member" mode="square" scope="public" /></I18nProvider>);
    const title = await screen.findByText('ued-requirement-analysis');
    fireEvent.click(title.closest('article')!.querySelector('button')!);
    fireEvent.click(screen.getByRole('menuitem', { name: action }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: action }));
    const path = '/api/workspace/skills/cloud/skill-team-analysis' + (action === '取消发布' ? '/unpublish' : '');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({
      method: action === '取消发布' ? 'POST' : 'DELETE',
      headers: expect.objectContaining({ 'x-od-workspace-id': 'team-a', 'x-od-workspace-member-id': 'team-member' }),
    })));
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads from MAAS Skillhub and installs through the MAAS provider', async () => {
    let installed = false;
    const refreshListener = vi.fn();
    window.addEventListener('personal:skill-refresh', refreshListener);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/skills') {
        return jsonResponse({
          skills: installed ? [{ id: 'skillhub-design-review' }] : [],
        });
      }
      if (url.startsWith('/api/workspace/skills/cloud?')) {
        const query = new URL(url, 'http://localhost').searchParams;
        expect(query.get('scope')).toBe('public');
        if (query.get('source') === 'hdw') return jsonResponse({ skills: [] });
        expect(query.get('source')).toBe('maas-skillhub');
        return jsonResponse({
          skills: [{
            resourceId: 'resource-1',
            localId: 'skillhub-design-review',
            title: 'Skillhub Design Review',
            description: 'Review a design against internal standards.',
            ownerMemberId: 'member-1',
            version: 1,
            versionId: 'version-1',
            createdAt: '2026-09-15T00:00:00.000Z',
            updatedAt: '2026-09-15T00:00:00.000Z',
            homeWorkspaceId: '2018527041046511617',
            provider: 'maas-skillhub',
            sourceLabel: 'MAAS Skillhub',
            publisherName: '张三',
            peopleCount: 12,
            actionCount: 428,
            iconUrl: 'https://maas.example.test/design-review.png',
          }],
        });
      }
      if (
        url === '/api/workspace/skills/cloud/resource-1/install?home_workspace_id=2018527041046511617&source=maas-skillhub'
        && init?.method === 'POST'
      ) {
        installed = true;
        return jsonResponse({ installed: true, localId: 'skillhub-design-review' });
      }
      return new Response(null, { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { container } = render(
      <I18nProvider initial="zh-CN">
        <CloudSkillList
          workspaceId="current-workspace"
          workspaceMemberId="current-member"
          workspaceType="team"
          sourceProvider="all"
          mode="square"
          scope="public"
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Skillhub Design Review')).toBeTruthy();
    expect(screen.getByText(/MAAS Skillhub/)).toBeTruthy();
    expect(screen.getByText(/张三/)).toBeTruthy();
    expect(screen.getByLabelText('接入人数 12, 接入次数 428')).toBeTruthy();
    expect(container.querySelector('img[src="https://maas.example.test/design-review.png"]'))
      .toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'design' } });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = input.toString();
        return url.startsWith('/api/workspace/skills/cloud?')
          && new URL(url, 'http://localhost').searchParams.get('q') === 'design';
      })).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspace/skills/cloud/resource-1/install?home_workspace_id=2018527041046511617&source=maas-skillhub',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'x-od-workspace-id': 'current-workspace',
            'x-od-workspace-member-id': 'current-member',
            'x-od-workspace-type': 'team',
          },
        }),
      );
    });
    expect(await screen.findByText('已添加')).toBeTruthy();
    expect(refreshListener).toHaveBeenCalledOnce();
    window.removeEventListener('personal:skill-refresh', refreshListener);
  });

  it('shows category counts and reloads the community list when a category is selected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/skills') return jsonResponse({ skills: [] });
      if (url.startsWith('/api/workspace/skills/cloud?')) {
        const query = new URL(url, 'http://localhost').searchParams;
        const developmentOnly = query.get('category') === 'development_tools';
        const developmentSkill = {
          resourceId: 'resource-dev',
          localId: 'developer-helper',
          title: 'Developer Helper',
          description: null,
          ownerMemberId: 'member-1',
          version: 1,
          versionId: 'v-dev',
          createdAt: '',
          updatedAt: '',
          provider: 'maas-skillhub',
          category: 'development_tools',
        };
        const otherSkill = {
          resourceId: 'resource-other',
          localId: 'misc-helper',
          title: 'Misc Helper',
          description: null,
          ownerMemberId: 'member-2',
          version: 1,
          versionId: 'v-other',
          createdAt: '',
          updatedAt: '',
          provider: 'hdw',
          category: 'other',
        };
        const isMaas = query.get('source') === 'maas-skillhub';
        return jsonResponse({
          skills: isMaas ? [developmentSkill] : developmentOnly ? [] : [otherSkill],
          categoryCounts: {
            all: 1,
            development_tools: isMaas ? 1 : 0,
            content_creation: 0,
            data_analysis: 0,
            productivity: 0,
            other: isMaas ? 0 : 1,
          },
        });
      }
      return new Response(null, { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const toolbarTarget = document.createElement('div');
    toolbarTarget.setAttribute('data-testid', 'community-skill-toolbar');
    document.body.appendChild(toolbarTarget);

    const { container } = render(
      <I18nProvider initial="zh-CN">
        <CloudSkillList
          workspaceId="current-workspace"
          workspaceMemberId="current-member"
          workspaceType="team"
          sourceProvider="all"
          mode="square"
          scope="public"
          controlsPortalTarget={toolbarTarget}
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Misc Helper')).toBeTruthy();
    expect(toolbarTarget.querySelector('.recent-projects__search')).toBeTruthy();
    expect(toolbarTarget.querySelector('.recent-projects__select-toggle')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /分类/ }));
    expect(screen.getByRole('menuitemradio', { name: '全部 (2)' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '开发工具 (1)' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '其他 (1)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitemradio', { name: '开发工具 (1)' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = new URL(input.toString(), 'http://localhost');
        return url.pathname === '/api/workspace/skills/cloud'
          && url.searchParams.get('category') === 'development_tools';
      })).toBe(true);
    });
    await waitFor(() => expect(screen.queryByText('Misc Helper')).toBeNull());
    expect(screen.getByText('Developer Helper')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    toolbarTarget.remove();
  });

  it('uses the shared external community search query for Skill requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/skills') return jsonResponse({ skills: [] });
      if (url.startsWith('/api/workspace/skills/cloud?')) {
        if (new URL(url, 'http://localhost').searchParams.get('source') === 'hdw') return jsonResponse({ skills: [] });
        return jsonResponse({
          skills: [{
            resourceId: 'resource-visual',
            localId: 'visual-helper',
            title: 'Visual Helper',
            description: 'Visualization skill',
            ownerMemberId: 'member-1',
            version: 1,
            versionId: 'v1',
            createdAt: '',
            updatedAt: '',
            provider: 'maas-skillhub',
            category: 'content_creation',
          }],
          categoryCounts: {
            all: 1,
            development_tools: 0,
            content_creation: 1,
            data_analysis: 0,
            productivity: 0,
            other: 0,
          },
        });
      }
      return new Response(null, { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { container } = render(
      <I18nProvider initial="zh-CN">
        <CloudSkillList
          workspaceId="current-workspace"
          workspaceMemberId="current-member"
          workspaceType="team"
          sourceProvider="all"
          mode="square"
          scope="public"
          externalSearchQuery="visual"
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Visual Helper')).toBeTruthy();
    expect(container.querySelector('img[src="/community/default-skill-logo.svg"]')).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = new URL(input.toString(), 'http://localhost');
        return url.pathname === '/api/workspace/skills/cloud'
          && url.searchParams.get('q') === 'visual';
      })).toBe(true);
    });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('explains the install conflict without exposing the daemon message', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/skills') return jsonResponse({ skills: [] });
      if (url.startsWith('/api/workspace/skills/cloud?')) {
        return jsonResponse({
          skills: [{
            resourceId: 'resource-1',
            localId: 'design-review',
            title: 'Design Review',
            description: null,
            ownerMemberId: 'member-1',
            version: null,
            versionId: null,
            createdAt: '',
            updatedAt: '',
            provider: 'maas-skillhub',
          }],
        });
      }
      if (url.includes('/resource-1/install') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          error: 'WORKSPACE_RESOURCE_ID_CONFLICT',
          message: '已安装的 Skill 与当前内容冲突，请联系团队管理员。',
        }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    render(
      <I18nProvider initial="zh-CN">
        <CloudSkillList
          workspaceId="current-workspace"
          workspaceMemberId="current-member"
          workspaceType="team"
          sourceProvider="maas-skillhub"
          mode="square"
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Design Review')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '已安装的 Skill 与当前内容冲突，请联系团队管理员。',
    );
  });
});
