// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { SquareView } from '../../src/components/SquareView';
import {
  readRecentlyOpenedProjects,
} from '../../src/lib/recently-opened-projects';
import { getSharedSpaceMemberId } from '../../src/utils/deterministicId';
import type { Project } from '../../src/types';

const AUTH_SESSION_KEY = 'open-design:auth-session';

const REMIXED_PROJECT: Project = {
  id: 'square-remixed-project',
  name: 'Square remixed deck',
  skillId: null,
  designSystemId: null,
  createdAt: 1778244000000,
  updatedAt: 1778244000000,
  metadata: { kind: 'prototype' },
};

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    getProject: vi.fn(async () => ({
      ...REMIXED_PROJECT,
      coverDigest: 'cover-digest',
    })),
    remixHdwPlugin: vi.fn(async () => ({
      ok: true,
      projectId: REMIXED_PROJECT.id,
      conversationId: 'square-remixed-conversation',
      project: REMIXED_PROJECT,
    })),
  };
});

vi.mock('../../src/router', async () => {
  const actual = await vi.importActual<typeof import('../../src/router')>(
    '../../src/router',
  );
  return {
    ...actual,
    navigate: vi.fn(),
  };
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installDaemonStub(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const pathname = new URL(String(input), 'http://daemon.local').pathname;
    if (pathname === '/api/workspace/directory') {
      return jsonResponse({
        items: [{
          workspaceId: 'shared-space',
          workspaceMemberId: 'directory-member-id',
          workspaceType: 'personal',
          isDefaultTeam: true,
        }],
        activeWorkspaceId: 'shared-space',
      });
    }
    if (pathname === '/api/marketplaces/hdw-community/plugins') {
      return jsonResponse({
        plugins: [{
          name: 'square-deck',
          title: 'Square deck',
          version: '1.0.0',
          publisher: { displayName: 'Project Author' },
          previewUserCount: 120,
          actionCount: 7,
        }],
      });
    }
    return jsonResponse({});
  }));
}

describe('SquareView remix recents', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      version: 1,
      username: 'square-tester',
      loginAt: Date.now(),
    }));
    vi.clearAllMocks();
    installDaemonStub();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses the shared community search box to filter project cards', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input), 'http://daemon.local').pathname;
      if (pathname === '/api/workspace/directory') {
        return jsonResponse({
          items: [{
            workspaceId: 'shared-space',
            workspaceMemberId: 'directory-member-id',
            workspaceType: 'personal',
            isDefaultTeam: true,
          }],
          activeWorkspaceId: 'shared-space',
        });
      }
      if (pathname === '/api/marketplaces/hdw-community/plugins') {
        return jsonResponse({
          plugins: [
            {
              name: 'square-deck',
              title: 'Square deck',
              description: 'Presentation',
              version: '1.0.0',
              publisher: { displayName: 'Project Author' },
              previewUserCount: 120,
              actionCount: 7,
            },
            { name: 'data-dashboard', title: 'Data dashboard', description: 'Analytics board', version: '1.0.0' },
          ],
        });
      }
      return jsonResponse({});
    }));

    render(
      <I18nProvider initial="en">
        <SquareView />
      </I18nProvider>,
    );

    expect(await screen.findByText('Square deck')).toBeTruthy();
    expect(screen.getByText('Project Author')).toBeTruthy();
    expect(document.querySelector('.recent-projects__card')).toBeTruthy();
    const projectMain = document.querySelector('.recent-projects__card-main');
    expect(projectMain).toBeTruthy();
    expect(projectMain?.hasAttribute('title')).toBe(false);
    expect(document.querySelector('.recent-projects__card-thumb')).toBeTruthy();
    expect(document.querySelector('.recent-projects__card-meta')).toBeTruthy();
    expect(screen.queryByText('Presentation')).toBeNull();
    expect(screen.getByLabelText('Preview users 120, Reuses 7')).toBeTruthy();
    expect(screen.getByText('Data dashboard')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'dashboard' } });
    await waitFor(() => expect(screen.queryByText('Square deck')).toBeNull());
    expect(screen.getByText('Data dashboard')).toBeTruthy();
  });

  it('records a remixed project in recently opened projects and polls its cover', async () => {
    const selfSharedSpaceMemberId = await getSharedSpaceMemberId('square-tester');

    render(
      <I18nProvider initial="en">
        <SquareView />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Remix' }));

    await waitFor(() => {
      const recents = readRecentlyOpenedProjects();
      expect(recents).toHaveLength(1);
      expect(recents[0]?.id).toBe(REMIXED_PROJECT.id);
      expect(recents[0]?.workspaceVisibility).toBe('personal');
      expect(recents[0]?.createdByWorkspaceMemberId).toBe(selfSharedSpaceMemberId);
    });

    await waitFor(() => {
      const recents = readRecentlyOpenedProjects();
      expect(recents[0]?.coverDigest).toBe('cover-digest');
    }, { timeout: 4000 });
  });
});
