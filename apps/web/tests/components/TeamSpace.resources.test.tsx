// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudMcpList } from '../../src/components/CloudMcpList';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { I18nProvider } from '../../src/i18n';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('team resource lists', () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders a locally materialized team Skill when the cloud catalog is empty', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/skills') {
        return jsonResponse({ skills: [{ id: 'team-design-review' }] });
      }
      if (url === '/api/workspace/skills/cloud?') {
        return jsonResponse({ skills: [] });
      }
      if (url === '/api/workspace/skills/team') {
        return jsonResponse({
          ids: ['team-design-review'],
          resources: [{
            id: 'team-design-review',
            title: 'Team Design Review',
            description: 'Shared from a team member client.',
            ownerMemberId: 'member-2',
          }],
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    render(
      <I18nProvider initial="zh-CN">
        <CloudSkillList
          workspaceId="team-1"
          workspaceMemberId="member-1"
          workspaceType="team"
          mode="team"
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Team Design Review')).toBeTruthy();
    expect(screen.getByText('团队共享')).toBeTruthy();
    expect(screen.getByText('已添加')).toBeTruthy();
    expect(screen.queryByText('暂无云端 Skill')).toBeNull();
  });

  it('renders only locally configured MCP servers belonging to the current team', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/workspace/mcp/cloud?') {
        return jsonResponse({ templates: [] });
      }
      if (url === '/api/mcp/servers') {
        return jsonResponse({
          servers: [
            { id: 'team-mcp', label: 'Team MCP', workspaceId: 'team-1', transport: 'http', enabled: true, url: 'https://team.test/mcp' },
            { id: 'other-mcp', label: 'Other MCP', workspaceId: 'team-2', transport: 'http', enabled: true, url: 'https://other.test/mcp' },
          ],
          templates: [],
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    render(
      <I18nProvider initial="zh-CN">
        <CloudMcpList
          workspaceId="team-1"
          workspaceMemberId="member-1"
          workspaceType="team"
          mode="team"
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Team MCP')).toBeTruthy();
    expect(screen.queryByText('Other MCP')).toBeNull();
    expect(screen.getByText('团队共享')).toBeTruthy();
    expect(screen.getByText('已连接')).toBeTruthy();
  });

  it('filters community MCP cards with the shared search query', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith('/api/workspace/mcp/cloud?')) {
        return jsonResponse({
          templates: [
            {
              id: 'data-mcp', resourceId: 'data-mcp', label: 'Data MCP', description: 'Analytics connector',
              transport: 'http', category: 'utilities', url: 'https://data.test/mcp', ownerMemberId: '',
              version: null, versionId: null, createdAt: '', updatedAt: '', publisherName: '李四',
            },
            {
              id: 'design-mcp', resourceId: 'design-mcp', label: 'Design MCP', description: 'Design connector',
              transport: 'http', category: 'utilities', url: 'https://design.test/mcp', ownerMemberId: '',
              version: null, versionId: null, createdAt: '', updatedAt: '',
            },
          ],
        });
      }
      if (url === '/api/mcp/servers') return jsonResponse({ servers: [] });
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    render(
      <I18nProvider initial="zh-CN">
        <CloudMcpList
          workspaceId="team-1"
          workspaceMemberId="member-1"
          workspaceType="team"
          mode="square"
          scope="public"
          searchQuery="analytics"
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Data MCP')).toBeTruthy();
    expect(screen.getByText('李四')).toBeTruthy();
    expect(screen.getByLabelText('接入人数 0, 接入次数 0')).toBeTruthy();
    expect(screen.queryByText('Design MCP')).toBeNull();
  });

  it('shows cancel publish for an owned community Skill', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/skills') return jsonResponse({ skills: [] });
      if (url.startsWith('/api/workspace/skills/cloud?')) {
        return jsonResponse({
          skills: [{
            resourceId: 'owned-skill', localId: 'owned-skill', title: 'Owned Skill',
            description: 'Published by me', provider: 'hidesign', ownerMemberId: 'member-1',
            createdAt: '', updatedAt: '',
          }],
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { container } = render(
      <I18nProvider initial="zh-CN">
        <CloudSkillList
          workspaceId="team-1"
          workspaceMemberId="member-1"
          workspaceType="team"
          mode="square"
          scope="public"
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Owned Skill')).toBeTruthy();
    fireEvent.click(container.querySelector<HTMLButtonElement>('[class*="cardMenuBtn"]')!);
    fireEvent.click(screen.getByRole('button', { name: '取消发布' }));

    expect(screen.getByRole('heading', { name: '取消发布' })).toBeTruthy();
    expect(screen.getByText('确定要取消发布「Owned Skill」吗？')).toBeTruthy();
  });

  it('shows cancel publish for an owned community MCP', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith('/api/workspace/mcp/cloud?')) {
        return jsonResponse({
          templates: [{
            id: 'owned-mcp', resourceId: 'owned-mcp', label: 'Owned MCP',
            description: 'Published by me', transport: 'http', category: 'utilities',
            url: 'https://mcp.test', ownerMemberId: 'member-1',
            version: null, versionId: null, createdAt: '', updatedAt: '',
          }],
        });
      }
      if (url === '/api/mcp/servers') return jsonResponse({ servers: [] });
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { container } = render(
      <I18nProvider initial="zh-CN">
        <CloudMcpList
          workspaceId="team-1"
          workspaceMemberId="member-1"
          workspaceType="team"
          mode="square"
          scope="public"
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('Owned MCP')).toBeTruthy();
    fireEvent.click(container.querySelector<HTMLButtonElement>('[class*="cardMenuBtn"]')!);
    fireEvent.click(screen.getByRole('button', { name: '取消发布' }));

    expect(screen.getByRole('heading', { name: '取消发布' })).toBeTruthy();
    expect(screen.getByText('确定要取消发布「Owned MCP」吗？')).toBeTruthy();
  });

  it('uses the shared empty state without a description', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString() === '/api/skills') return jsonResponse({ skills: [] });
      return jsonResponse({ skills: [], ids: [], resources: [] });
    }) as typeof fetch;

    render(
      <I18nProvider initial="zh-CN">
        <CloudSkillList
          workspaceId="team-1"
          workspaceMemberId="member-1"
          workspaceType="team"
          mode="team"
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('暂无内容')).toBeTruthy();
    expect(screen.queryByText('还没有共享到团队的内容')).toBeNull();
    expect(screen.queryByText('暂无云端 Skill')).toBeNull();
  });
});
