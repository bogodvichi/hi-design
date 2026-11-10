import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PreviewComment,
  PreviewCommentStatus,
  PreviewCommentTarget,
} from '@open-design/contracts';
import {
  NEW_TAB_COMMENT_CHANNEL_PREFIX,
  buildNewTabCommentsPreviewDocument,
  createNewTabCommentSession,
  isNewTabCommentStatus,
  normalizeNewTabCommentTarget,
  type NewTabCommentLabels,
  type NewTabCommentSession,
} from '../../src/runtime/new-tab-comments';
import { buildNewTabCommentsPreviewDocumentV2 } from '../../src/runtime/new-tab-comments-wrapper';
import { avatarColorForDisplayName } from '../../src/utils/avatarColor';

const FILE_PATH = 'pages/review.html';
const OTHER_FILE_PATH = 'pages/other.html';
const ORIGIN = 'https://open-design.test';

const LABELS: NewTabCommentLabels = {
  comments: 'Comments',
  comment: 'Comment',
  placeholder: 'Write a comment',
  empty: 'No comments',
  showResolved: 'Show resolved',
  unresolved: '{n} unresolved',
  searchPlaceholder: 'Search comments',
  sortAndFilter: 'Sort and filter',
  sortNewest: 'Newest first',
  sortOldest: 'Oldest first',
  filterOpen: 'Current page only',
  filterResolved: 'Show resolved',
  filterMentioned: 'Related to me',
  nComments: '{n} comments',
  resolved: 'Resolved',
  markResolved: 'Resolve',
  reopen: 'Reopen',
  deleteComment: 'Delete',
  deleteReply: 'Delete reply',
  reply: 'Reply',
  nReplies: '{n} replies',
  saved: 'Saved',
  sending: 'Sending',
  failed: 'Failed',
  close: 'Close',
  cancel: 'Cancel',
  justNow: 'Just now',
  minutesAgo: '{n} minutes ago',
  hoursAgo: '{n} hours ago',
  daysAgo: '{n} days ago',
};

class FakeBroadcastChannel {
  readonly name: string;
  readonly posted: Record<string, unknown>[] = [];
  closed = false;
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(name: string) {
    this.name = name;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message' && typeof listener === 'function') {
      this.listeners.add(listener as (event: MessageEvent) => void);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message' && typeof listener === 'function') {
      this.listeners.delete(listener as (event: MessageEvent) => void);
    }
  }

  postMessage(message: unknown): void {
    this.posted.push(message as Record<string, unknown>);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  emit(data: unknown, origin = ORIGIN): void {
    for (const listener of [...this.listeners]) {
      listener({ data, origin } as MessageEvent);
    }
  }
}

const sessions: NewTabCommentSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
  vi.restoreAllMocks();
});

function makeSession(
  options: Omit<Parameters<typeof createNewTabCommentSession>[0], 'channelFactory' | 'expectedOrigin'> = {
    filePath: FILE_PATH,
    comments: [],
  },
): { session: NewTabCommentSession; channel: FakeBroadcastChannel } {
  let channel: FakeBroadcastChannel | null = null;
  const session = createNewTabCommentSession({
    ...options,
    expectedOrigin: ORIGIN,
    readyTimeoutMs: 10_000,
    channelFactory: (name) => {
      channel = new FakeBroadcastChannel(name);
      return channel as unknown as BroadcastChannel;
    },
  });
  sessions.push(session);
  return { session, channel: channel! };
}

function makeTarget(overrides: Partial<PreviewCommentTarget> = {}): PreviewCommentTarget {
  return {
    filePath: FILE_PATH,
    elementId: 'hero',
    selector: '#hero',
    label: 'Hero',
    text: 'Welcome',
    position: { x: 10, y: 20, width: 200, height: 80 },
    htmlHint: '<section id="hero">Welcome</section>',
    ...overrides,
  };
}

function makeComment(
  id: string,
  overrides: Partial<PreviewComment> = {},
): PreviewComment {
  return {
    id,
    projectId: 'project-1',
    conversationId: 'conversation-1',
    ...makeTarget(),
    note: `Note ${id}`,
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function channelMessage(
  session: NewTabCommentSession,
  type: string,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type,
    token: session.token,
    channel: session.channelName,
    origin: ORIGIN,
    ...payload,
  };
}

async function flushOperations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function lastPosted(channel: FakeBroadcastChannel): Record<string, unknown> {
  return channel.posted[channel.posted.length - 1]!;
}

describe('new-tab comment protocol', () => {
  it('ignores messages with the wrong token, channel, data origin, or event origin', () => {
    const { session, channel } = makeSession();
    const ready = channelMessage(session, 'ready');

    channel.emit({ ...ready, token: 'wrong-token' });
    channel.emit({ ...ready, channel: 'wrong-channel' });
    channel.emit({ ...ready, origin: 'https://evil.test' });
    channel.emit(ready, 'https://evil.test');

    expect(session.isClosed()).toBe(false);
    expect(channel.posted).toEqual([]);
  });

  it('acknowledges ready and only sends comments for the exact file path', () => {
    const ownComment = makeComment('own');
    const otherComment = makeComment('other', { filePath: OTHER_FILE_PATH });
    const { session, channel } = makeSession({
      filePath: FILE_PATH,
      comments: [ownComment, otherComment],
      onSave: vi.fn(),
      onReply: vi.fn(),
      onRemove: vi.fn(),
      onChangeStatus: vi.fn(),
    });

    expect(session.channelName).toBe(`${NEW_TAB_COMMENT_CHANNEL_PREFIX}${session.token}`);
    channel.emit(channelMessage(session, 'ready'));

    expect(channel.posted.map((message) => message.type)).toEqual([
      'ready-ack',
      'comments-snapshot',
    ]);
    const snapshot = channel.posted[1]!;
    expect(snapshot.comments).toEqual([
      expect.objectContaining({
        id: 'own',
        filePath: FILE_PATH,
      }),
    ]);
    expect(snapshot.capabilities).toEqual({
      canCreate: true,
      canReply: true,
      canDelete: true,
      canChangeStatus: true,
    });
  });

  it('carries resolved author metadata and stable avatar colors for comments and replies', () => {
    const root = makeComment('root', {
      authorMemberId: 'member-stored',
      authorDisplayName: ' Stored Name ',
      authorAvatarUrl: '/avatars/stored.png',
    });
    const reply = makeComment('reply', {
      parentId: 'root',
      rootCommentId: 'root',
      authorMemberId: 'member-roster',
    });
    const resolveAuthor = vi.fn((memberId: string | null | undefined) => {
      if (memberId === 'member-roster') {
        return {
          displayName: 'Roster Reply',
          avatarUrl: 'https://cdn.open-design.test/reply.png',
        };
      }
      return {
        displayName: 'Roster Should Be Ignored',
        avatarUrl: 'https://cdn.open-design.test/stored-roster.png',
      };
    });
    const { session, channel } = makeSession({
      filePath: FILE_PATH,
      comments: [root, reply],
      resolveAuthor,
    });

    channel.emit(channelMessage(session, 'ready'));

    const snapshot = channel.posted.find((message) => message.type === 'comments-snapshot');
    expect(snapshot?.comments).toEqual([
      expect.objectContaining({
        id: 'root',
        authorMemberId: 'member-stored',
        authorDisplayName: 'Stored Name',
        authorAvatarUrl: 'https://open-design.test/avatars/stored.png',
        authorAvatarColor: avatarColorForDisplayName('Stored Name'),
      }),
      expect.objectContaining({
        id: 'reply',
        authorMemberId: 'member-roster',
        authorDisplayName: 'Roster Reply',
        authorAvatarUrl: 'https://cdn.open-design.test/reply.png',
        authorAvatarColor: avatarColorForDisplayName('Roster Reply'),
      }),
    ]);
    expect(resolveAuthor).toHaveBeenCalledWith('member-stored');
    expect(resolveAuthor).toHaveBeenCalledWith('member-roster');
  });

  it('normalizes targets to the session file and drops invalid optional style values', () => {
    const target = normalizeNewTabCommentTarget(
      makeTarget({
        filePath: OTHER_FILE_PATH,
        selectionKind: 'pod',
        slideIndex: 3,
        style: {
          color: 'red',
          fontSize: 42 as unknown as string,
        },
      }),
      FILE_PATH,
    );

    expect(target).toEqual(expect.objectContaining({
      filePath: FILE_PATH,
      selectionKind: 'pod',
      slideIndex: 3,
    }));
    expect(target?.style).toBeUndefined();
    expect(normalizeNewTabCommentTarget(
      makeTarget({ position: { x: 0, y: 0, width: -1, height: 20 } }),
      FILE_PATH,
    )).toBeNull();
    expect(isNewTabCommentStatus('resolved')).toBe(true);
    expect(isNewTabCommentStatus('applied')).toBe(false);
  });

  it('saves a comment and materializes it into the shared snapshot', async () => {
    const saved = makeComment('saved', {
      filePath: FILE_PATH,
      note: 'Please tighten this',
      updatedAt: 2,
    });
    const onSave = vi.fn().mockResolvedValue(saved);
    const { session, channel } = makeSession({
      filePath: FILE_PATH,
      comments: [],
      onSave,
    });
    channel.emit(channelMessage(session, 'ready'));
    channel.posted.length = 0;

    channel.emit(channelMessage(session, 'save-comment', {
      requestId: 'save-1',
      target: makeTarget({ filePath: OTHER_FILE_PATH }),
      note: 'Please tighten this',
    }));
    await flushOperations();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: FILE_PATH }),
      'Please tighten this',
    );
    expect(channel.posted).toEqual([
      expect.objectContaining({
        type: 'comments-snapshot',
        comments: [expect.objectContaining({ id: 'saved' })],
      }),
      expect.objectContaining({
        type: 'operation-result',
        requestId: 'save-1',
        ok: true,
        comment: expect.objectContaining({ id: 'saved' }),
      }),
    ]);
  });

  it('rejects invalid save and status payloads without calling the host callbacks', async () => {
    const onSave = vi.fn();
    const onChangeStatus = vi.fn();
    const { session, channel } = makeSession({
      filePath: FILE_PATH,
      comments: [makeComment('root')],
      onSave,
      onChangeStatus,
    });
    channel.emit(channelMessage(session, 'ready'));
    channel.posted.length = 0;

    channel.emit(channelMessage(session, 'save-comment', {
      requestId: 'save-invalid',
      target: makeTarget({ position: { x: 0, y: 0, width: -1, height: 1 } }),
      note: 'Invalid target',
    }));
    channel.emit(channelMessage(session, 'change-comment-status', {
      requestId: 'status-invalid',
      commentId: 'root',
      status: 'applied',
    }));
    await flushOperations();

    expect(onSave).not.toHaveBeenCalled();
    expect(onChangeStatus).not.toHaveBeenCalled();
    expect(channel.posted).toEqual([
      expect.objectContaining({
        type: 'operation-result',
        requestId: 'save-invalid',
        ok: false,
        error: 'invalid_request',
      }),
      expect.objectContaining({
        type: 'operation-result',
        requestId: 'status-invalid',
        ok: false,
        error: 'invalid_request',
      }),
    ]);
  });

  it('replies, resolves, reopens, and removes a comment subtree', async () => {
    const root = makeComment('root');
    const reply = makeComment('reply', {
      parentId: 'root',
      rootCommentId: 'root',
      note: 'Reply',
      createdAt: 2,
    });
    const nestedReply = makeComment('nested', {
      parentId: 'reply',
      rootCommentId: 'root',
      note: 'Nested reply',
      createdAt: 3,
    });
    const onReply = vi.fn().mockResolvedValue(reply);
    const onRemove = vi.fn().mockResolvedValue(true);
    const onChangeStatus = vi.fn();
    const { session, channel } = makeSession({
      filePath: FILE_PATH,
      comments: [root],
      onReply,
      onRemove,
      onChangeStatus,
    });
    channel.emit(channelMessage(session, 'ready'));
    channel.posted.length = 0;

    channel.emit(channelMessage(session, 'reply-comment', {
      requestId: 'reply-1',
      commentId: 'root',
      note: 'Reply',
    }));
    await flushOperations();
    expect(onReply).toHaveBeenCalledWith(root, 'Reply');
    expect(channel.posted[0]).toEqual(expect.objectContaining({
      type: 'comments-snapshot',
      comments: expect.arrayContaining([
        expect.objectContaining({ id: 'root' }),
        expect.objectContaining({ id: 'reply' }),
      ]),
    }));

    channel.posted.length = 0;
    channel.emit(channelMessage(session, 'change-comment-status', {
      requestId: 'resolve-1',
      commentId: 'root',
      status: 'resolved',
    }));
    await flushOperations();
    expect(onChangeStatus).toHaveBeenCalledWith('root', 'resolved');
    expect(channel.posted[0]).toEqual(expect.objectContaining({
      type: 'comments-snapshot',
      comments: expect.arrayContaining([
        expect.objectContaining({ id: 'root', status: 'resolved' }),
      ]),
    }));

    channel.posted.length = 0;
    channel.emit(channelMessage(session, 'change-comment-status', {
      requestId: 'reopen-1',
      commentId: 'root',
      status: 'open',
    }));
    await flushOperations();
    expect(onChangeStatus).toHaveBeenLastCalledWith('root', 'open');

    // Re-seed a nested subtree through the host snapshot before deletion.
    session.updateSnapshot([root, reply, nestedReply]);
    channel.posted.length = 0;
    channel.emit(channelMessage(session, 'remove-comment', {
      requestId: 'remove-1',
      commentId: 'root',
    }));
    await flushOperations();

    expect(onRemove).toHaveBeenCalledWith('root');
    expect(channel.posted[0]).toEqual(expect.objectContaining({
      type: 'comments-snapshot',
      comments: [],
    }));
    expect(channel.posted[1]).toEqual(expect.objectContaining({
      type: 'operation-result',
      requestId: 'remove-1',
      ok: true,
      commentId: 'root',
    }));
  });

  it('updates snapshots, closes once, and stops posting after cleanup', () => {
    const onClosed = vi.fn();
    const { session, channel } = makeSession({
      filePath: FILE_PATH,
      comments: [],
      onClosed,
    });
    channel.emit(channelMessage(session, 'ready'));
    channel.posted.length = 0;

    session.updateSnapshot([
      makeComment('next', { status: 'needs_review' }),
      makeComment('foreign', { filePath: OTHER_FILE_PATH }),
    ]);
    expect(lastPosted(channel)).toEqual(expect.objectContaining({
      type: 'comments-snapshot',
      comments: [
        expect.objectContaining({
          id: 'next',
          status: 'needs_review',
          filePath: FILE_PATH,
        }),
      ],
    }));

    session.close();
    session.close();

    expect(channel.posted).toEqual([
      expect.objectContaining({ type: 'comments-snapshot' }),
      expect.objectContaining({ type: 'closed' }),
    ]);
    expect(channel.closed).toBe(true);
    expect(onClosed).toHaveBeenCalledOnce();
    expect(session.isClosed()).toBe(true);
  });
});

describe('new-tab comments wrapper', () => {
  it('keeps the artifact in an opaque-origin iframe and pins frame messages to that iframe', () => {
    const wrapper = buildNewTabCommentsPreviewDocumentV2(
      '<main id="artifact">Artifact</main>',
      'Review',
      {
        token: 'token-1',
        channelName: `${NEW_TAB_COMMENT_CHANNEL_PREFIX}token-1`,
        filePath: FILE_PATH,
        currentMemberId: 'member-1',
        labels: LABELS,
      },
    );

    expect(wrapper).toContain('sandbox="allow-scripts"');
    expect(wrapper).not.toContain('allow-same-origin');
    expect(wrapper).toContain('data-od-new-tab-comments');
    expect(wrapper).toContain('"token":"token-1"');
    expect(wrapper).toContain(`"filePath":"${FILE_PATH}"`);
    expect(wrapper).toContain('"currentMemberId":"member-1"');
    expect(wrapper).toContain('if (event.source !== frame.contentWindow) return;');
    expect(wrapper).toContain('od:comment-target');
    expect(wrapper).toContain('od:comment-mode');
    expect(wrapper).toContain('comment-user-avatar-image');
    expect(wrapper).toContain('comment-saved-pin');
    expect(wrapper).toContain('comment-popover');
    expect(wrapper).toContain('comment-popover-meta-avatar');
    expect(wrapper).toContain('comment-popover-reply-bar');
    expect(wrapper).toContain('comment-popover-reply-floating-actions');
    expect(wrapper).toContain('comment-popover-close-btn');
    expect(wrapper).toContain('authorAvatarUrl');
    expect(wrapper).toContain('comment-card');
    expect(wrapper).toContain('comment-card-avatar');
    expect(wrapper).toContain('comment-card-author');
    expect(wrapper).toContain('comment-card-time');
    expect(wrapper).toContain('comment-card-replies');
    expect(wrapper).toContain('repliesRow.appendChild(createAvatar(reply, "comment-card-reply-avatar"));');
    expect(wrapper).toContain('function renderList()');
    expect(wrapper).not.toContain('reply-form');
    expect(wrapper).not.toContain('comment-popover-status');
    expect(wrapper).not.toContain('comment-popover-footer');
    expect(wrapper).not.toContain('grid-template-columns:minmax(0,1fr) 320px');
    expect(wrapper).toContain('&lt;main id=&quot;artifact&quot;&gt;Artifact&lt;/main&gt;');
    expect(wrapper).not.toContain('<main id="artifact">Artifact</main>');

    const scriptStart = wrapper.indexOf('<script data-od-new-tab-comments>');
    const scriptEnd = wrapper.indexOf('</script>', scriptStart);
    expect(scriptStart).toBeGreaterThan(-1);
    expect(scriptEnd).toBeGreaterThan(scriptStart);
    expect(() => new Function(wrapper.slice(
      scriptStart + '<script data-od-new-tab-comments>'.length,
      scriptEnd,
    ))).not.toThrow();

    const toolbar = wrapper.slice(
      wrapper.indexOf('<div class="toolbar">'),
      wrapper.indexOf('</div>', wrapper.indexOf('<div class="toolbar">')) + 6,
    );
    expect(toolbar).toContain('id="comments-toggle"');
    expect(toolbar).toContain('aria-controls="panel"');
    expect(toolbar).not.toContain('resolved-toggle');
    const panel = wrapper.slice(
      wrapper.indexOf('<aside class="panel"'),
      wrapper.indexOf('</aside>', wrapper.indexOf('<aside class="panel"')) + 8,
    );
    expect(panel).not.toContain('id="resolved-toggle"');
    expect(panel).toContain('id="comment-search"');
    expect(panel).toContain('id="sort-menu-toggle"');
    expect(panel).toContain('id="sort-menu"');
    expect(panel).toContain('id="visible-comment-count"');
    expect(panel).toContain('id="comment-list"');
    expect(wrapper).toContain('panel.setAttribute("aria-label", CONFIG.labels.comments);');
    expect(wrapper).toContain('panel.hidden = !open;');
    expect(wrapper).toContain('function renderList()');
    expect(wrapper).toContain('function visibleComments()');
    expect(wrapper).toContain('function commentActivityAt(comment)');
    expect(wrapper).toContain('function commentMatchesSearch(comment, query)');
    expect(wrapper).toContain('if (!filterShowResolved && comment.status === "resolved") return false;');
    expect(wrapper).toContain('if (filterCurrentPage && comment.filePath !== CONFIG.filePath) return false;');
    expect(wrapper).toContain('function renderSortMenu()');
    expect(wrapper).toContain('"menuitemradio"');
    expect(wrapper).toContain('"menuitemcheckbox"');
    expect(wrapper).toContain('var filterCurrentPage = true;');
    const unresolvedCounter = wrapper.slice(
      wrapper.indexOf('function unresolvedCount()'),
      wrapper.indexOf('function findComment(id)'),
    );
    expect(unresolvedCounter).toContain('(!filterCurrentPage || comment.filePath === CONFIG.filePath)');
    expect(wrapper).toContain('button.disabled = true;');
    expect(wrapper).toContain('button.setAttribute("aria-disabled", "true");');
    expect(wrapper).toContain('addSortMenuItem(CONFIG.labels.filterOpen, "menuitemcheckbox", filterCurrentPage, function() {');
    expect(wrapper).toContain('searchInput.addEventListener("input"');
    expect(wrapper).toContain('sortMenuToggle.addEventListener("click"');

    expect(wrapper).toContain('--glass-regular: rgba(250, 250, 250, 0.66);');
    expect(wrapper).toContain('--glass-backdrop: blur(28px) saturate(1.8);');
    expect(wrapper).toContain('--material-separator: rgba(73, 73, 73, 0.18);');
    expect(wrapper).toContain('.comment-popover-titlebar { display:flex; flex:0 0 auto; align-items:center; gap:8px; min-height:24px; margin:-2px 0 8px; }');
    expect(wrapper).toContain('.comment-popover-existing-actions { display:inline-flex; flex:0 0 auto; align-items:center; gap:4px; margin-right:24px; }');
    expect(wrapper).toContain('.comment-popover-reply-note { min-width:0; padding:12px 8px 12px 32px;');
    expect(wrapper).toContain('position:sticky; bottom:0;');
    expect(wrapper).toContain('.comment-popover-reply-bar .comment-popover-reply-input { width:100%; min-height:36px; padding:8px 68px 8px 8px;');
    expect(wrapper).toContain('.comment-popover-reply-bar--expanded { padding:8px 12px 10px; }');
    expect(wrapper).toContain('.comment-popover-reply-floating-actions { position:absolute; right:12px; bottom:12px;');
    expect(wrapper).toContain('function resizeReplyInput(area)');
    expect(wrapper).toContain('popoverComposerWrap.appendChild(replyBar);');
    expect(wrapper).toContain('avatar.style.background = avatarColor(name);');
    expect(wrapper).not.toContain('avatar.style.background = comment.authorAvatarColor');
    expect(wrapper).toContain('new ResizeObserver(schedulePopoverPosition)');
    expect(wrapper).toContain('popoverResizeObserver.observe(popover);');
    expect(wrapper).toContain('popoverResizeObserver.observe(popoverComposerWrap);');
    expect(wrapper).toContain('resizeReplyInput(area);\n        positionPopover();');

    const popoverRenderer = wrapper.slice(
      wrapper.indexOf('function renderPopover()'),
      wrapper.indexOf('function savedCommentHoverPoint('),
    );
    expect(popoverRenderer).toContain('positionPopover();');
    expect(popoverRenderer).not.toContain('requestAnimationFrame(positionPopover)');

    const listRenderer = wrapper.slice(
      wrapper.indexOf('function renderList()'),
      wrapper.indexOf('function savedCommentHoverPoint('),
    );
    expect(listRenderer).toContain('var visible = visibleComments();');

    const pinRenderer = wrapper.slice(
      wrapper.indexOf('function renderPins()'),
      wrapper.indexOf('function renderLabels()'),
    );
    expect(pinRenderer).toContain('var visible = visibleComments();');
    expect(pinRenderer).toContain('var authorName = commentAuthorName(comment);');
    expect(pinRenderer).toContain('pin.style.background = avatarColor(authorName);');
    expect(pinRenderer).toContain('commentAuthorInitial(authorName)');
    expect(pinRenderer).not.toContain('comment.authorAvatarColor');
    expect(pinRenderer).not.toContain('pinSeq');
    expect(pinRenderer).not.toContain('markerNumber');
  });

  it('shows the latest reply author in reply rows in the single-frame wrapper', () => {
    const wrapper = buildNewTabCommentsPreviewDocument('<main id="artifact">Artifact</main>', 'Review', {
      token: 'token-1',
      channelName: `${NEW_TAB_COMMENT_CHANNEL_PREFIX}token-1`,
      filePath: FILE_PATH,
      labels: LABELS,
    });

    expect(wrapper).toContain('replyButton.insertAdjacentHTML("beforeend", iconSvg("message"));');
    expect(wrapper).toContain('replyCountEl.insertAdjacentHTML("beforeend", iconSvg("message"));');
    expect(wrapper).toContain('if (latestReply) replyButton.appendChild(createAuthorAvatar(latestReply));');
    expect(wrapper).toContain('if (latestReply) replyCountEl.appendChild(createAuthorAvatar(latestReply));');
    expect(wrapper).not.toContain('replyButton.appendChild(createAuthorAvatar(comment));');
    expect(wrapper).not.toContain('replyCountEl.appendChild(createAuthorAvatar(comment));');
    const unresolvedCounter = wrapper.slice(
      wrapper.indexOf('function unresolvedCount()'),
      wrapper.indexOf('function sendFrame(type, payload)'),
    );
    expect(unresolvedCounter).toContain('comment.filePath === CONFIG.filePath');
  });
});
