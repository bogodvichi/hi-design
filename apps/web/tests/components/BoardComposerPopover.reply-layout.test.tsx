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

function renderReplyPopover() {
  return render(
    <BoardComposerPopover
      target={elementTarget()}
      existing={existingComment()}
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
      t={((key: string) => String(key)) as never}
    />,
  );
}

describe('BoardComposerPopover reply layout', () => {
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
