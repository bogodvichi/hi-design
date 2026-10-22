// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CollabProvider, type CollabContextValue } from '../../src/collab/collab-context';
import { FileViewer } from '../../src/components/FileViewer';
import { resetSharedCancellableGet } from '../../src/lib/shared-cancellable-get';
import type { ProjectFile } from '../../src/types';
import { workspaceContextFixture } from '../helpers/workspace-context';

const WORKSPACE_CONTEXT = workspaceContextFixture({
  workspaceId: 'ws-review-push-menu',
  workspaceMemberId: 'member-review-push-menu',
});

function collabValue(): CollabContextValue {
  return {
    workspaceContext: WORKSPACE_CONTEXT,
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

function Wrap({ children }: { children: ReactNode }) {
  return <CollabProvider value={collabValue()}>{children}</CollabProvider>;
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
