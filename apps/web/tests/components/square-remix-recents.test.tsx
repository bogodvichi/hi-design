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

  it('requests a community preview once and shows the error state instead of looping on loading', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
          }],
        });
      }
      if (pathname === '/api/marketplaces/hdw-community/plugins/square-deck/preview') {
        return new Response(JSON.stringify({ error: 'archive extraction failed' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="en">
        <SquareView />
      </I18nProvider>,
    );

    const cardTitle = await screen.findByText('Square deck');
    const cardButton = cardTitle.closest('button');
    expect(cardButton).toBeTruthy();
    fireEvent.click(cardButton!);

    expect(await screen.findByText("Couldn't load this example.")).toBeTruthy();

    await waitFor(() => {
      const previewCalls = fetchMock.mock.calls.filter(([input]) => (
        new URL(String(input), 'http://daemon.local').pathname
          === '/api/marketplaces/hdw-community/plugins/square-deck/preview'
      ));
      expect(previewCalls).toHaveLength(1);
    });
  });

  it('renders Markdown project content in the community preview', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
            name: 'trip-project',
            title: '霞浦国庆行程',
            version: '1.0.0',
            publisher: { displayName: 'Project Author' },
          }],
        });
      }
      if (pathname === '/api/marketplaces/hdw-community/plugins/trip-project/preview') {
        return new Response('# 霞浦国庆行程\n\n第一天：到达霞浦。', {
          status: 200,
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            'x-open-design-preview-file': encodeURIComponent('霞浦国庆行程.md'),
          },
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="zh-CN">
        <SquareView />
      </I18nProvider>,
    );

    const cardTitle = await screen.findByText('霞浦国庆行程');
    fireEvent.click(cardTitle.closest('button')!);

    expect(await screen.findByRole('heading', { name: '霞浦国庆行程' })).toBeTruthy();
    expect(screen.getByText('第一天：到达霞浦。')).toBeTruthy();
    expect(screen.getByText('霞浦国庆行程.md')).toBeTruthy();
  });

  it('renders PDF document-preview content in the community preview', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
            name: 'pdf-project',
            title: 'PDF project',
            version: '1.0.0',
            publisher: { displayName: 'Project Author' },
          }],
        });
      }
      if (pathname === '/api/marketplaces/hdw-community/plugins/pdf-project/preview') {
        return new Response(JSON.stringify({
          kind: 'pdf',
          title: 'report.pdf',
          sections: [{
            title: 'PDF',
            lines: ['行程 PDF 正文第一行', '行程 PDF 正文第二行'],
          }],
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-open-design-preview-file': encodeURIComponent('report.pdf'),
          },
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="zh-CN">
        <SquareView />
      </I18nProvider>,
    );

    const cardTitle = await screen.findByText('PDF project');
    fireEvent.click(cardTitle.closest('button')!);

    expect(await screen.findByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('行程 PDF 正文第一行')).toBeTruthy();
    expect(screen.getByText('行程 PDF 正文第二行')).toBeTruthy();
  });

  it('records a remixed project in recently opened projects and polls its cover', async () => {
    const selfSharedSpaceMemberId = await getSharedSpaceMemberId('square-tester');

    render(
      <I18nProvider initial="en">
        <SquareView />
      </I18nProvider>,
    );

    // SquareView derives the shared-space member id asynchronously via Web Crypto.
    await new Promise((resolve) => window.setTimeout(resolve, 25));
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

  it('creates a separate community card for every project publish', async () => {
    const publications: Array<{
      name: string;
      title: string;
      version: string;
      publisher: { displayName: string };
    }> = [];
    const publishBodies: Array<Record<string, unknown>> = [];
    let pendingPublicationName: string | null = null;
    let pendingPublicationListCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://daemon.local');
      if (url.pathname === '/api/workspace/directory') {
        return jsonResponse({
          items: [{
            workspaceId: 'shared-space',
            workspaceName: 'Personal',
            workspaceMemberId: 'directory-member-id',
            workspaceType: 'personal',
            isDefaultTeam: true,
            isSharedSpace: false,
            memberStatus: 'active',
            lifecycleState: 'active',
          }],
          activeWorkspaceId: 'shared-space',
        });
      }
      if (url.pathname === '/api/folders') {
        return jsonResponse({ data: { folders: [] } });
      }
      if (url.pathname === '/api/workspaces/shared-space/projects') {
        return jsonResponse({
          projects: [{
            visibility: 'personal',
            createdByWorkspaceMemberId: 'directory-member-id',
            project: {
              id: 'webgl2-project',
              name: '自包含WebGL2主视觉',
              updatedAt: Date.now(),
              metadata: { kind: 'prototype', entryFile: 'index.html' },
            },
          }],
        });
      }
      if (url.pathname === '/api/projects/webgl2-project/files') {
        return jsonResponse({
          files: [{ name: 'index.html', path: 'index.html', kind: 'html', mtime: 1, size: 1 }],
        });
      }
      if (url.pathname === '/api/projects/webgl2-project/publish-community' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        publishBodies.push(body);
        const publicationNumber = publications.length + 1;
        const publication = {
          name: `webgl2-community-entry-${publicationNumber}`,
          title: '自包含WebGL2主视觉',
          version: '0.0.0',
          publisher: { displayName: 'Project Author' },
        };
        publications.push(publication);
        pendingPublicationName = publication.name;
        pendingPublicationListCalls = 0;
        return jsonResponse({
          status: 'created',
          publicationId: publication.name,
          pluginId: `plugin-webgl2-${publicationNumber}`,
          versionId: `version-webgl2-${publicationNumber}`,
          name: publication.name,
          version: '0.0.0',
          publishedAt: String(body.publishedAt),
          url: `/api/hdw/api/community/plugins/${publication.name}`,
        });
      }
      if (url.pathname === '/api/marketplaces/hdw-community/plugins') {
        if (pendingPublicationName) pendingPublicationListCalls += 1;
        const visiblePublications = pendingPublicationName && pendingPublicationListCalls < 2
          ? publications.filter((entry) => entry.name !== pendingPublicationName)
          : publications;
        if (pendingPublicationName && pendingPublicationListCalls >= 2) {
          pendingPublicationName = null;
        }
        return jsonResponse({
          plugins: [...visiblePublications].reverse(),
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="en">
        <SquareView />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New Publish' }));
    fireEvent.click(await screen.findByRole('option', { name: /自包含WebGL2主视觉/ }));
    const publishButton = screen.getByRole('button', { name: 'Publish' });
    await waitFor(() => expect(publishButton).not.toBeDisabled());
    fireEvent.click(publishButton);

    await waitFor(() => expect(screen.queryByTestId('publish-dialog')).toBeNull());
    await waitFor(() => {
      expect(document.querySelector('[data-plugin-name="webgl2-community-entry-1"]')).toBeTruthy();
    }, { timeout: 2500 });

    fireEvent.click(screen.getByRole('button', { name: 'New Publish' }));
    fireEvent.click(await screen.findByRole('option', { name: /自包含WebGL2主视觉/ }));
    const secondPublishButton = screen.getByRole('button', { name: 'Publish' });
    await waitFor(() => expect(secondPublishButton).not.toBeDisabled());
    fireEvent.click(secondPublishButton);

    await waitFor(() => expect(screen.queryByTestId('publish-dialog')).toBeNull());
    await waitFor(() => {
      expect(document.querySelector('[data-plugin-name="webgl2-community-entry-1"]')).toBeTruthy();
      expect(document.querySelector('[data-plugin-name="webgl2-community-entry-2"]')).toBeTruthy();
    }, { timeout: 2500 });

    expect(publishBodies).toHaveLength(2);
    expect(publishBodies[0]?.publishAttemptId).toEqual(expect.any(String));
    expect(publishBodies[1]?.publishAttemptId).toEqual(expect.any(String));
    expect(publishBodies[1]?.publishAttemptId).not.toBe(publishBodies[0]?.publishAttemptId);
    expect(publishBodies[0]?.publishedAt).toEqual(expect.any(String));
    expect(screen.getByText('自包含WebGL2主视觉 was published as a new community project')).toBeTruthy();
  });
});
