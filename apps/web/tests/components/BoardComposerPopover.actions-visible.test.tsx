// @vitest-environment jsdom

// Acceptance defect #89: with the inspect/comment tool active, clicking an
// element low in the preview stage opened the annotation popover with content
// cut off by the height clamp. Keep the close button fixed outside one scrolling
// composer wrapper so the rest of the content remains reachable.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardComposerPopover } from '../../src/components/BoardComposerPopover';
import type { PreviewCommentSnapshot } from '../../src/comments';

afterEach(() => {
  cleanup();
});

const target: PreviewCommentSnapshot = {
  filePath: 'index.html',
  elementId: 'ag',
  selector: 'div.ag',
  label: 'div.ag',
  text: '',
  // Anchored near the bottom of the stage, which is what forces the clamp.
  position: { x: 40, y: 460, width: 1200, height: 64 },
  htmlHint: '',
  selectionKind: 'element',
};

function renderPopover() {
  return render(
    <BoardComposerPopover
      target={target}
      existing={null}
      draft="Tighten this heading"
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
      // A short stage: the card cannot fit below the anchor, so the host clamps
      // its height — the exact condition that used to hide the actions.
      bounds={{ width: 760, height: 520 }}
    />,
  );
}

describe('BoardComposerPopover action row', () => {
  it('renders the action row', () => {
    renderPopover();
    expect(screen.getByTestId('comment-add-send')).toBeTruthy();
    expect(screen.getByTestId('comment-popover-save')).toBeTruthy();
  });

  it('keeps the close button outside the scrolling composer wrapper', () => {
    renderPopover();
    const popover = screen.getByTestId('comment-popover');
    const closeButton = popover.querySelector('.comment-popover-close-btn');
    const wrapper = popover.querySelector('.comment-popover-composer-wrap');
    const body = popover.querySelector('.comment-popover-body');
    const titlebar = popover.querySelector('.comment-popover-titlebar');
    const actions = popover.querySelector('.comment-popover-actions');

    expect(closeButton).not.toBeNull();
    expect(wrapper).not.toBeNull();
    expect(body).not.toBeNull();
    expect(titlebar).not.toBeNull();
    expect(actions).not.toBeNull();
    // The close button and titlebar stay pinned while composer content scrolls.
    expect(closeButton!.parentElement).toBe(popover);
    expect(wrapper!.parentElement).toBe(popover);
    expect(titlebar!.parentElement).toBe(popover);
    expect(wrapper!.contains(titlebar!)).toBe(false);
    expect(wrapper!.contains(body!)).toBe(true);
    expect(wrapper!.contains(actions!)).toBe(true);
  });

  it('clamps the card height, which is what made the clipping reachable', () => {
    renderPopover();
    const popover = screen.getByTestId('comment-popover');
    // The host caps the card to the space left in the stage; the fix has to
    // survive that cap rather than depend on the card being tall enough.
    expect(popover.style.maxHeight).not.toBe('');
  });
});
