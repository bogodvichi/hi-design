// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardComposerPopover } from '../../src/components/BoardComposerPopover';
import type { PreviewCommentSnapshot } from '../../src/comments';
import type { PreviewComment } from '../../src/types';

afterEach(() => {
  cleanup();
});

function elementTarget(): PreviewCommentSnapshot {
  return {
    filePath: 'index.html',
    elementId: 'pod-1',
    selector: '',
    label: 'Pod',
    text: '',
    position: { x: 0, y: 0, width: 100, height: 60 },
    htmlHint: '',
    selectionKind: 'element',
    memberCount: undefined,
    podMembers: undefined,
  };
}

function existingComment(): PreviewComment {
  return {
    id: 'comment-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    filePath: 'index.html',
    elementId: 'pod-1',
    selector: '',
    label: 'Pod',
    text: '',
    position: { x: 0, y: 0, width: 100, height: 60 },
    htmlHint: '',
    note: 'existing note',
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
  };
}

function replyComment(id: string, note: string): PreviewComment {
  return {
    ...existingComment(),
    id,
    parentId: 'comment-1',
    note,
    createdAt: 2,
    updatedAt: 2,
  };
}

function renderReplyPopover({
  existing = existingComment(),
  replies = [],
  onSendComment,
  canSendReplyComment,
  allowSendToChat = true,
}: {
  existing?: PreviewComment;
  replies?: PreviewComment[];
  onSendComment?: (comment: PreviewComment) => void | Promise<void>;
  canSendReplyComment?: (reply: PreviewComment) => boolean;
  allowSendToChat?: boolean;
} = {}) {
  return render(
    <BoardComposerPopover
      target={elementTarget()}
      existing={existing}
      draft=""
      notes={[]}
      onDraft={() => {}}
      onAddDraft={() => {}}
      onRemoveQueuedNote={() => {}}
      onClose={() => {}}
      onSaveComment={() => {}}
      onSendBatch={() => {}}
      onRemoveMember={() => {}}
      sending={false}
      canReplyComment
      onReplyComment={vi.fn()}
      replies={replies}
      onSendComment={onSendComment}
      canSendReplyComment={canSendReplyComment}
      allowSendToChat={allowSendToChat}
      t={((key: string) => String(key)) as never}
    />,
  );
}

describe('BoardComposerPopover reply layout', () => {
  it('shows the save action only while editing an existing comment', () => {
    renderReplyPopover();

    expect(screen.queryByTestId('comment-add-send')).toBeNull();
    expect(screen.queryByTestId('comment-popover-save')).toBeNull();

    fireEvent.click(screen.getByTestId('comment-popover-edit'));

    expect(screen.getByTestId('comment-add-send')).not.toBeNull();
    expect(screen.getByTestId('comment-popover-save')).not.toBeNull();
  });

  it('shows send-to-chat on the saved comment and every saved reply', () => {
    const existing = existingComment();
    const firstReply = replyComment('reply-1', 'first reply');
    const secondReply = replyComment('reply-2', 'second reply');
    const onSendComment = vi.fn();
    renderReplyPopover({
      existing,
      replies: [firstReply, secondReply],
      onSendComment,
    });

    expect(screen.getByTestId('comment-popover-send-current')).toHaveTextContent(
      'chat.comments.sendToChat',
    );

    const replyActions = screen.getAllByTestId('comment-popover-send-reply');
    expect(replyActions).toHaveLength(2);
    expect(replyActions[0]).toHaveTextContent('chat.comments.sendToChat');
    expect(replyActions[1]).toHaveTextContent('chat.comments.sendToChat');

    fireEvent.click(screen.getByTestId('comment-popover-send-current'));
    fireEvent.click(replyActions[0]!);
    fireEvent.click(replyActions[1]!);

    expect(onSendComment).toHaveBeenNthCalledWith(1, existing);
    expect(onSendComment).toHaveBeenNthCalledWith(2, firstReply);
    expect(onSendComment).toHaveBeenNthCalledWith(3, secondReply);
  });

  it('hides every send-to-chat action when sending is disabled for the popover', () => {
    renderReplyPopover({
      replies: [replyComment('reply-1', 'first reply')],
      onSendComment: vi.fn(),
      allowSendToChat: false,
    });

    expect(screen.queryByTestId('comment-popover-send-current')).toBeNull();
    expect(screen.queryByTestId('comment-popover-send-reply')).toBeNull();
  });

  it('hides send-to-chat only for replies the viewer cannot send', () => {
    const firstReply = replyComment('reply-1', 'first reply');
    const secondReply = replyComment('reply-2', 'second reply');
    const onSendComment = vi.fn();
    renderReplyPopover({
      replies: [firstReply, secondReply],
      onSendComment,
      canSendReplyComment: (reply) => reply.id === 'reply-1',
    });

    const replyActions = screen.getAllByTestId('comment-popover-send-reply');
    expect(replyActions).toHaveLength(1);
    fireEvent.click(replyActions[0]!);
    expect(onSendComment).toHaveBeenCalledWith(firstReply);
  });

  it('stays compact when empty and expands once text is entered', () => {
    renderReplyPopover();

    const bar = screen.getByTestId('comment-popover-reply-bar');
    expect(bar.className).not.toContain('comment-popover-reply-bar--expanded');

    const input = screen.getByTestId('comment-popover-reply-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'a reply' } });

    expect(bar.className).toContain('comment-popover-reply-bar--expanded');

    fireEvent.change(input, { target: { value: '' } });
    expect(bar.className).not.toContain('comment-popover-reply-bar--expanded');
  });

  it('renders the current user profile image beside their name', () => {
    const existing = existingComment();
    existing.authorMemberId = 'wm-self';
    const { container } = render(
      <BoardComposerPopover
        target={elementTarget()}
        existing={existing}
        authorDisplayName="Current User"
        authorAvatarUrl="https://example.test/current-user.jpg"
        currentAuthorDisplayName="Current User"
        currentAuthorAvatarUrl="https://example.test/current-user.jpg"
        currentAuthorMemberId="wm-self"
        draft=""
        notes={[]}
        onDraft={() => {}}
        onAddDraft={() => {}}
        onRemoveQueuedNote={() => {}}
        onClose={() => {}}
        onSaveComment={() => {}}
        onSendBatch={() => {}}
        onRemoveMember={() => {}}
        sending={false}
        t={((key: string) => String(key)) as never}
      />,
    );

    expect(
      container.querySelector<HTMLImageElement>('.comment-popover-meta-avatar img')?.src,
    ).toBe('https://example.test/current-user.jpg');
  });
});
