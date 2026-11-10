// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CollabProvider, type CollabContextValue } from '../../src/collab/collab-context';
import { FileViewer } from '../../src/components/FileViewer';
import { REMIX_ICON_PATHS } from '../../src/components/remix-icon-paths';
import { resetSharedCancellableGet } from '../../src/lib/shared-cancellable-get';
import type { PreviewComment, ProjectFile } from '../../src/types';
import { workspaceContextFixture } from '../helpers/workspace-context';

const WORKSPACE_CONTEXT = workspaceContextFixture({
  workspaceId: 'ws-presentation-comments',
  workspaceMemberId: 'member-presentation-comments',
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

const PAGE_HTML = '<html><body><main data-od-id="hero">Hero</main></body></html>';

function installFetchMock(projectId: string) {
  const filesUrl = `/api/projects/${encodeURIComponent(projectId)}/files`;
  const rawUrl = `/api/projects/${encodeURIComponent(projectId)}/raw/page.html`;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.split('?')[0] === filesUrl) {
      return new Response(
        JSON.stringify({ files: [pageFile()] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.startsWith(rawUrl)) return new Response(PAGE_HTML, { status: 200 });
    return new Response('', { status: 404 });
  }));
}

function overlay(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.present-overlay');
  if (!element) throw new Error('presentation overlay not rendered');
  return element;
}

function presentationFrame(): HTMLIFrameElement {
  const frame = overlay().querySelector<HTMLIFrameElement>('iframe[title="present"]');
  if (!frame) throw new Error('presentation iframe not rendered');
  return frame;
}

async function enterPresentation(mode: 'tab' | 'fullscreen' = 'tab') {
  const trigger = document.querySelector('.present-trigger');
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('present trigger not rendered');
  fireEvent.click(trigger);
  const menuItem = await screen.findByRole('menuitem', {
    name: mode === 'tab' ? /In this tab|在当前标签页/i : /Fullscreen|全屏/i,
  });
  fireEvent.click(menuItem);
  await waitFor(() => expect(document.querySelector('.present-overlay')).not.toBeNull());
}

function commentTarget(elementId: string, label = elementId) {
  return {
    type: 'od:comment-target',
    elementId,
    selector: `[data-od-id="${elementId}"]`,
    label,
    text: label,
    position: { x: 40, y: 30, width: 200, height: 100 },
    hoverPoint: { x: 60, y: 50 },
    style: {},
    selectionKind: 'element',
  };
}

function savedComment(): PreviewComment {
  return {
    id: 'comment-saved',
    projectId: 'project-presentation-comments',
    conversationId: 'conversation-presentation-comments',
    filePath: 'page.html',
    elementId: 'saved-hero',
    selector: '[data-od-id="saved-hero"]',
    label: 'Saved hero',
    text: 'Saved hero',
    htmlHint: '<main data-od-id="saved-hero">Saved hero</main>',
    position: { x: 30, y: 20, width: 180, height: 80 },
    note: 'Keep this visible in presentation',
    status: 'open',
    createdAt: 10,
    updatedAt: 10,
  };
}

function replyComment(input: { id: string; note: string; createdAt: number; authorDisplayName: string; authorAvatarUrl: string }): PreviewComment {
  return {
    ...savedComment(),
    id: input.id,
    parentId: 'comment-saved',
    rootCommentId: 'comment-saved',
    note: input.note,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    authorDisplayName: input.authorDisplayName,
    authorAvatarUrl: input.authorAvatarUrl,
  };
}

function otherPageComment(): PreviewComment {
  return {
    ...savedComment(),
    id: 'comment-other-page',
    filePath: 'other.html',
    elementId: 'other-hero',
    selector: '[data-od-id="other-hero"]',
    label: 'Other hero',
    text: 'Other hero',
    note: 'Hidden other page comment',
  };
}

beforeEach(() => {
  resetSharedCancellableGet();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer presentation comments', () => {
  it('opens comment mode from the presentation overlay and switches URL-load HTML to the bridge-enabled srcdoc', async () => {
    const projectId = 'project-presentation-comments-render-mode';
    installFetchMock(projectId);

    render(
      <Wrap>
        <FileViewer projectId={projectId} projectKind="prototype" file={pageFile()} />
      </Wrap>,
    );

    await waitFor(() => expect(document.querySelector('.present-trigger')).not.toBeNull());
    await enterPresentation();

    const buttons = overlay().querySelectorAll('button');
    expect(buttons[0]).toHaveClass('present-exit-btn');
    expect(buttons[1]).toHaveClass('present-comment-toggle');
    expect(presentationFrame()).toHaveAttribute('data-od-render-mode', 'url-load');
    const commentToggle = screen.getByTestId('present-comment-toggle');
    expect(commentToggle.querySelector('svg.od-icon path')).toHaveAttribute(
      'd',
      REMIX_ICON_PATHS['chat-1-line'],
    );

    fireEvent.click(commentToggle);

    await waitFor(() => {
      expect(presentationFrame()).toHaveAttribute('data-od-render-mode', 'srcdoc');
      expect(document.querySelector('.present-overlay [data-testid="comment-side-dock"]')).not.toBeNull();
    });
    expect(commentToggle).toHaveAttribute('aria-pressed', 'true');

    const postMessage = vi.spyOn(presentationFrame().contentWindow!, 'postMessage');
    fireEvent.load(presentationFrame());
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'od:comment-mode', enabled: true, mode: 'inspect' },
      '*',
    );

    fireEvent.click(commentToggle);

    await waitFor(() => {
      expect(document.querySelector('.present-overlay')).not.toBeNull();
      expect(screen.queryByTestId('comment-side-dock')).toBeNull();
      expect(presentationFrame()).toHaveAttribute('data-od-render-mode', 'url-load');
    });
    expect(commentToggle).toHaveAttribute('aria-pressed', 'false');
  });

  it.each([
    ['in-tab', 'tab'],
    ['fullscreen', 'fullscreen'],
  ] as const)(
    'renders %s presentation targets, locks current-page filtering, and ignores competing messages from the background preview',
    async (_modeName, mode) => {
    const projectId = 'project-presentation-comments-target';
    installFetchMock(projectId);

    render(
      <Wrap>
        <FileViewer
          projectId={projectId}
          projectKind="prototype"
          file={pageFile()}
          previewComments={[
            savedComment(),
            replyComment({
              id: 'reply-earlier',
              note: 'Earlier reply',
              createdAt: 20,
              authorDisplayName: 'Earlier author',
              authorAvatarUrl: 'https://example.test/earlier.png',
            }),
            replyComment({
              id: 'reply-latest',
              note: 'Latest reply',
              createdAt: 30,
              authorDisplayName: 'Latest author',
              authorAvatarUrl: 'https://example.test/latest.png',
            }),
            replyComment({
              id: 'reply-middle',
              note: 'Middle reply',
              createdAt: 25,
              authorDisplayName: 'Middle author',
              authorAvatarUrl: 'https://example.test/middle.png',
            }),
            otherPageComment(),
          ]}
        />
      </Wrap>,
    );

    await waitFor(() => expect(document.querySelector('.present-trigger')).not.toBeNull());
    await enterPresentation(mode);
    fireEvent.click(screen.getByTestId('present-comment-toggle'));

    await waitFor(() => {
      expect(presentationFrame()).toHaveAttribute('data-od-render-mode', 'srcdoc');
    });

    const postMessage = vi.spyOn(presentationFrame().contentWindow!, 'postMessage');
    window.dispatchEvent(new MessageEvent('message', {
      source: presentationFrame().contentWindow,
      data: {
        type: 'od:comment-targets',
        targets: [commentTarget('saved-hero', 'Saved hero'), commentTarget('hero', 'Hero')],
      },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      source: presentationFrame().contentWindow,
      data: commentTarget('hero', 'Hero'),
    }));

    const composer = await screen.findByTestId('comment-popover-input');
    const dock = screen.getByTestId('comment-side-dock');
    expect(overlay().contains(composer)).toBe(true);
    expect(overlay().contains(dock)).toBe(true);
    const inlineReply = dock.querySelector('.comment-card-user-inline');
    expect(inlineReply).not.toBeNull();
    const inlineReplyAvatar = inlineReply?.querySelector('.avatar');
    expect(inlineReplyAvatar).not.toBeNull();
    expect(inlineReplyAvatar?.querySelector('img')).toHaveAttribute('src', 'https://example.test/latest.png');
    expect(inlineReplyAvatar?.textContent).toContain('L');
    expect(within(dock).queryByText('Hidden other page comment')).toBeNull();
    expect(dock.querySelectorAll('[data-testid="comment-side-item"]')).toHaveLength(1);
    expect(dock.querySelector('.comment-side-unresolved-count')).toHaveTextContent('1 unresolved');

    const sortAndFilterButton = dock.querySelector<HTMLButtonElement>(
      '.comment-tool-control button[aria-haspopup="menu"]',
    );
    expect(sortAndFilterButton).not.toBeNull();
    fireEvent.click(sortAndFilterButton!);
    const currentPageFilter = screen.getByRole('menuitemcheckbox', {
      name: /Only show current page|仅显示当前页面/i,
    });
    expect(currentPageFilter).toBeDisabled();
    expect(currentPageFilter).toHaveAttribute('aria-checked', 'true');
    expect(currentPageFilter).toHaveClass('selected');
    fireEvent.click(currentPageFilter);
    expect(currentPageFilter).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('comment-saved-marker-saved-hero')).toBeTruthy();
    expect(
      overlay().querySelectorAll('[data-testid="comment-side-dock"]'),
    ).toHaveLength(1);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'od:comment-active-target',
        elementId: 'hero',
        selector: '[data-od-id="hero"]',
      },
      '*',
    );

    const backgroundFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    window.dispatchEvent(new MessageEvent('message', {
      source: backgroundFrame.contentWindow,
      data: commentTarget('background-hero', 'Background hero'),
    }));

    await waitFor(() => {
      expect(overlay().querySelector('.comment-target-overlay-label')?.textContent).toBe('hero');
    });
  });

  it('cleans up the presentation comment surface when presentation exits', async () => {
    const projectId = 'project-presentation-comments-cleanup';
    installFetchMock(projectId);

    render(
      <Wrap>
        <FileViewer projectId={projectId} projectKind="prototype" file={pageFile()} />
      </Wrap>,
    );

    await waitFor(() => expect(document.querySelector('.present-trigger')).not.toBeNull());
    await enterPresentation();
    fireEvent.click(screen.getByTestId('present-comment-toggle'));
    await waitFor(() => expect(screen.getByTestId('comment-side-dock')).toBeTruthy());

    const exit = within(overlay()).getAllByRole('button')[0]!;
    fireEvent.click(exit);

    await waitFor(() => {
      expect(document.querySelector('.present-overlay')).toBeNull();
      expect(screen.queryByTestId('comment-side-dock')).toBeNull();
    });
    expect(screen.getByTestId('artifact-preview-frame')).toHaveAttribute(
      'data-od-render-mode',
      'url-load',
    );
  });
});
