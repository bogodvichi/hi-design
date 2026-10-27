// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CollabProvider, type CollabContextValue } from '../../src/collab/collab-context';
import { FileViewer } from '../../src/components/FileViewer';
import { I18nProvider } from '../../src/i18n';
import { resetSharedCancellableGet } from '../../src/lib/shared-cancellable-get';
import type { ProjectFile } from '../../src/types';
import { workspaceContextFixture } from '../helpers/workspace-context';

const WORKSPACE_CONTEXT = workspaceContextFixture({
  workspaceId: 'ws-review-push-menu',
  workspaceMemberId: 'member-review-push-menu',
});

function collabValue(role: 'member' | 'guest' = 'member'): CollabContextValue {
  return {
    workspaceContext: { ...WORKSPACE_CONTEXT, role },
    workspaceContextLoading: false,
    projectResourceAuthority: 'workspace',
    enabled: false,
    member: null,
    present: [],
    publishedVersion: null,
    syncState: null,
    viewerOnly: false,
    writerAuthority: 'pending',
    isOwner: false,
    isEffectiveOwner: false,
    isSharedNonOwner: false,
    ownerDisplayName: null,
    ownerRole: null,
    downloadPending: false,
    reportChange: () => {},
    requestPublish: () => {},
    refreshPresence: () => {},
    checkStatusNow: () => {},
  };
}

function Wrap({ children, role = 'member' }: { children: ReactNode; role?: 'member' | 'guest' }) {
  return <I18nProvider initial="zh-CN"><CollabProvider value={collabValue(role)}>{children}</CollabProvider></I18nProvider>;
}

function pageFile(): ProjectFile {
  return {
    name: 'page.html',
    path: 'page.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
  };
}

function installFetchMock(projectId: string) {
  const filesUrl = `/api/projects/${encodeURIComponent(projectId)}/files`;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.split('?')[0] === filesUrl) {
      return new Response(
        JSON.stringify({ files: [pageFile()] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('', { status: 404 });
  }));
}

beforeEach(() => {
  resetSharedCancellableGet();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HTML viewer review and push menus', () => {
  it('lets read-only teammates and guests view review history without initiating reviews', async () => {
    const projectId = 'proj-review-readonly';
    installFetchMock(projectId);
    render(
      <Wrap>
        <FileViewer
          projectId={projectId}
          projectKind="prototype"
          file={pageFile()}
          liveHtml="<html><body><main>preview</main></body></html>"
          viewerOnly
        />
      </Wrap>,
    );

    const review = await screen.findByRole('button', { name: '评审' });
    expect(review).not.toBeDisabled();
    fireEvent.click(review);
    expect(await screen.findByRole('menuitem', { name: '历史评审' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '发起评审' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '推送' })).toBeDisabled();
  });

  it.each([['member', true], ['guest', false]] as const)(
    'allows read-only team %s to open sharing with the correct operations', async (role, mayInitiate) => {
      const projectId = `proj-share-${role}`;
      installFetchMock(projectId);
      render(
        <Wrap role={role}>
          <FileViewer
            projectId={projectId}
            projectKind="prototype"
            file={pageFile()}
            liveHtml="<html><body><main>preview</main></body></html>"
            viewerOnly
          />
        </Wrap>,
      );
      const share = await screen.findByRole('button', { name: '分享' });
      expect(share).not.toBeDisabled();
      fireEvent.click(share);
      const linkTab = await screen.findByRole('tab', { name: '分享链接' });
      expect(screen.queryByRole('tab', { name: '社区' })).not.toBeInTheDocument();
      expect(Boolean(screen.queryByRole('tab', { name: '分享文件' }))).toBe(mayInitiate);
      fireEvent.click(linkTab);
      if (mayInitiate) {
        expect(screen.getByRole('button', { name: '生成链接' })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole('button', { name: '生成链接' })).not.toBeInTheDocument();
        expect(await screen.findByText('暂无分享链接，请联系团队成员生成')).toBeInTheDocument();
      }
      expect(screen.getByRole('button', { name: '推送' })).toBeDisabled();
    },
  );

  it('keeps a team guest read-only even with a transient writable viewer snapshot', async () => {
    const projectId = 'proj-guest-stale-writer';
    installFetchMock(projectId);
    render(
      <Wrap role="guest">
        <FileViewer
          projectId={projectId}
          projectKind="prototype"
          file={pageFile()}
          liveHtml="<html><body><main>preview</main></body></html>"
          viewerOnly={false}
        />
      </Wrap>,
    );
    const share = await screen.findByRole('button', { name: '分享' });
    expect(share).not.toBeDisabled();
    fireEvent.click(share);
    expect(await screen.findByRole('tab', { name: '分享链接' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '分享文件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成链接' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '推送' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导出' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '评审' }));
    expect(await screen.findByRole('menuitem', { name: '历史评审' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '发起评审' })).not.toBeInTheDocument();
  });

  it('keeps the review and push popovers mutually exclusive', async () => {
    const projectId = 'proj-review-push-menu';
    installFetchMock(projectId);

    render(
      <Wrap>
        <FileViewer
          projectId={projectId}
          projectKind="prototype"
          file={pageFile()}
          liveHtml="<html><body><main>preview</main></body></html>"
        />
      </Wrap>,
    );

    const reviewButton = await screen.findByRole('button', { name: '评审' });
    const pushButton = screen.getByRole('button', { name: '推送' });

    fireEvent.click(reviewButton);
    await waitFor(() => expect(reviewButton).toHaveAttribute('aria-expanded', 'true'));
    expect(pushButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(pushButton);
    await waitFor(() => expect(pushButton).toHaveAttribute('aria-expanded', 'true'));
    expect(reviewButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(reviewButton);
    await waitFor(() => expect(reviewButton).toHaveAttribute('aria-expanded', 'true'));
    expect(pushButton).toHaveAttribute('aria-expanded', 'false');
  });
});
