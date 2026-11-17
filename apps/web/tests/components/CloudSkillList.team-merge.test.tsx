// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudSkillList } from '../../src/components/CloudSkillList';
import { I18nProvider } from '../../src/i18n';
import { ToastProvider } from '../../src/components/ToastProvider';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CloudSkillList team merge', () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('merges team and cloud records by hub resource id', async () => {
    const resourceId = 'skill-4dewe6ai5282wtecxsa2ghjms-hui-ui-engineer';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/workspace/skills/cloud?')) {
        return jsonResponse({
          skills: [{
            resourceId,
            localId: 'hui-ui-engineer-cloud',
            title: 'hui-ui-engineer',
            description: 'Team skill',
            ownerMemberId: 'member-1',
            version: 1,
            versionId: 'version-1',
            createdAt: '',
            updatedAt: '',
            provider: 'hdw',
          }],
        });
      }
      if (url === '/api/workspace/skills/team') {
        return jsonResponse({
          ids: [resourceId],
          resources: [{
            id: resourceId,
            title: 'hui-ui-engineer',
            ownerMemberId: 'member-1',
            version: 1,
            versionId: 'version-1',
            hubResourceId: resourceId,
            canUnshare: false,
          }],
        });
      }
      if (url === '/api/skills') return jsonResponse({ skills: [] });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const { container } = render(
      <I18nProvider initial="zh-CN">
        <ToastProvider>
          <CloudSkillList
            workspaceId="team"
            workspaceMemberId="member-1"
            workspaceType="team"
            mode="team"
          />
        </ToastProvider>
      </I18nProvider>,
    );

    await screen.findByText('hui-ui-engineer');
    expect(container.querySelectorAll('article')).toHaveLength(1);
  });
});
