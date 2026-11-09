// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { armCompletionFeedbackOnFirstGesture } from '../../src/utils/notifications';
import { flushMounts, pressEnter, typeAndSettle } from '../helpers/lexical-composer';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatComposer external-run controls', () => {
  const cases: Array<{ name: string; props: Partial<ComponentProps<typeof ChatComposer>> }> = [
    { name: 'an empty composer', props: {} },
    { name: 'an unsent draft', props: { initialDraft: 'Keep this follow-up' } },
    {
      name: 'a staged comment',
      props: {
        commentAttachments: [{
          id: 'comment-1',
          order: 1,
          filePath: 'article.html',
          elementId: 'article',
          selector: 'article.wrap',
          label: 'article.wrap',
          comment: 'Adjust the heading',
          currentText: 'Article heading',
          pagePosition: { x: 0, y: 0, width: 100, height: 40 },
          htmlHint: '<article class="wrap">Article heading</article>',
        }],
      },
    },
    {
      name: 'workspace context without typed text',
      props: {
        activeWorkspaceContext: {
          id: 'file:article.html',
          kind: 'file',
          label: 'article.html',
          title: 'article.html',
          path: 'article.html',
        },
      },
    },
  ];

  it.each(cases)('keeps Stop available when an external run starts with $name', async ({ props }) => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    const composer = (streaming: boolean) => (
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={onStop}
        {...props}
        streaming={streaming}
        sendDisabled
      />
    );
    const { container, rerender } = render(composer(false));
    await flushMounts();
    expect(container.querySelector('.composer-send.stop')).toBeNull();

    // Comment sends start in ProjectView, so the composer receives a running
    // prop without submitting or clearing its own draft/context first.
    rerender(composer(true));
    const stop = container.querySelector<HTMLButtonElement>('.composer-send.stop');
    expect(stop).not.toBeNull();
    expect(screen.queryByTestId('chat-send')).toBeNull();
    expect(stop!.disabled).toBe(false);
    fireEvent.click(stop!);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();

    rerender(composer(false));
    expect(container.querySelector('.composer-send.stop')).toBeNull();
    expect(screen.getByTestId('chat-send')).toBeTruthy();
  });
});

describe('ChatComposer empty-send guard (recvqaj7eKpxH6)', () => {
  it('disables the send button and no-ops a click on a truly empty composer', async () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    await flushMounts();

    const btn = screen.getByTestId('chat-send') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send on Enter with a truly empty composer', async () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    await flushMounts();
    pressEnter();
    expect(onSend).not.toHaveBeenCalled();
  });

  // The "next step" placeholder carousel rotates suggested prompts as ghost
  // text where the editor's own placeholder would sit, whenever the
  // composer is otherwise idle (empty draft, nothing staged) — this is the
  // ordinary steady state of a mid-conversation composer, not a rare edge
  // case. Regression: the send-guard used to treat that ghost text as real
  // payload, so clicking Send on a box the user had never typed into still
  // launched a real turn with the suggested text (recvqaj7eKpxH6).
  it('does not submit the rotating placeholder scenario when the user never typed anything', async () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
        placeholderScenarios={[
          { id: 'follow-up-1', text: 'Make the hero punchier', chipId: 'design-toolbox' },
        ]}
      />,
    );
    await flushMounts();
    // Let the carousel report its first scenario.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const btn = screen.getByTestId('chat-send') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSend).not.toHaveBeenCalled();

    // Enter must not bypass it either.
    pressEnter();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('still sends real typed text even while the placeholder carousel is mounted', async () => {
    const onSend = vi.fn();
    const onFeedbackActivation = vi.fn();
    const disposeFeedbackActivation = armCompletionFeedbackOnFirstGesture(
      {
        soundEnabled: false,
        successSoundId: 'ding',
        failureSoundId: 'buzz',
        desktopEnabled: false,
      },
      onFeedbackActivation,
    );
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
        placeholderScenarios={[
          { id: 'follow-up-1', text: 'Make the hero punchier', chipId: 'design-toolbox' },
        ]}
      />,
    );
    await flushMounts();

    await typeAndSettle('Ship the onboarding tweak');
    pressEnter();

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Ship the onboarding tweak', [], [], undefined);
    expect(onFeedbackActivation).toHaveBeenCalledWith({ desktopPermission: null });
    disposeFeedbackActivation();
  });

  it('pauses the typewriter while the empty composer owns the real caret', async () => {
    const { container } = render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        placeholderScenarios={[
          { id: 'follow-up-1', text: 'Make the hero punchier', chipId: 'design-toolbox' },
        ]}
      />,
    );
    await flushMounts();

    const editor = container.querySelector<HTMLElement>('.composer-editable');
    expect(editor).not.toBeNull();
    expect(screen.getByTestId('home-hero-carousel')).toBeTruthy();

    fireEvent.focus(editor!);
    expect(screen.queryByTestId('home-hero-carousel')).toBeNull();

    fireEvent.blur(editor!, { relatedTarget: null });
    expect(screen.getByTestId('home-hero-carousel')).toBeTruthy();
  });
});
