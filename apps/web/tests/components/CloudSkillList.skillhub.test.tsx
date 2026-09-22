// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
        expect(query.get('source')).toBe('all');
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
    expect(screen.getByText(/作者: 张三/)).toBeTruthy();
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
        return jsonResponse({
          skills: developmentOnly ? [developmentSkill] : [developmentSkill, otherSkill],
          categoryCounts: {
            all: 2,
            development_tools: 1,
            content_creation: 0,
            data_analysis: 0,
            productivity: 0,
            other: 1,
          },
        });
      }
      return new Response(null, { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    render(
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

    expect(await screen.findByRole('tab', { name: '全部 (2)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '开发工具 (1)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '其他 (1)' })).toBeTruthy();
    expect(screen.getByText('Misc Helper')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '开发工具 (1)' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = new URL(input.toString(), 'http://localhost');
        return url.pathname === '/api/workspace/skills/cloud'
          && url.searchParams.get('category') === 'development_tools';
      })).toBe(true);
    });
    await waitFor(() => expect(screen.queryByText('Misc Helper')).toBeNull());
    expect(screen.getByText('Developer Helper')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '全部 (2)' })).toBeTruthy();
  });

  it('shows the daemon error when installation fails while cards are visible', async () => {
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
          message: 'A skill named "design-review" is already installed',
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
      'A skill named "design-review" is already installed',
    );
  });
});
