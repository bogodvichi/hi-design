// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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
