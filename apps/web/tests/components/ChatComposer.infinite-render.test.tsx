// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer, STAGE_ATTACHMENT_EVENT } from '../../src/components/ChatComposer';
import { composerText, flushMounts, pressEnter, typeAndSettle } from '../helpers/lexical-composer';

let fetchMock: ReturnType<typeof vi.fn>;
const RESTORED_SKILL = {
  id: 'skill-restored',
  name: 'Restored Skill',
  description: 'Draft context',
  source: 'user',
} as never;
const CURRENT_WORKSPACE = {
  id: 'workspace-current',
  kind: 'project',
  label: 'Current project',
} as never;
const REFERENCE_WORKSPACE = {
  id: 'workspace-reference',
  kind: 'project',
  label: 'Reference project',
} as never;

function renderComposer(overrides: Partial<ComponentProps<typeof ChatComposer>> = {}) {
  return render(
    <ChatComposer
      projectId="project-1"
      projectFiles={[]}
      streaming={false}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      skills={[]}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/projects/project-1' && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ project: { id: 'project-1', skillId: 'skill-restored' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/mcp/servers') {
      return new Response(JSON.stringify({ servers: [], templates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/plugins') {
      return new Response(JSON.stringify({ plugins: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/skills') {
      return new Response(JSON.stringify({ skills: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  cleanup();
});

describe('ChatComposer infinite re-render regression (#2097)', () => {
  it('shows only stop while streaming with an empty composer', () => {
    renderComposer({ streaming: true });

    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByTestId('chat-send')).toBeNull();
  });

  it('keeps send available while streaming so the next prompt can queue', async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    renderComposer({ streaming: true, onSend, onStop });
    await flushMounts();

    typeAndSettle('change the font');

    // The editor's onChange → setDraft settles a tick after typeAndSettle
    // returns; wait for the send button (which only shows once the composer has
    // payload) before asserting Stop is gone.
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(screen.getByTestId('chat-send'));

    expect(onStop).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith('change the font', [], [], undefined);
  });

  it('restores a saved draft for the active conversation', async () => {
    window.localStorage.setItem('od:chat-composer:draft:project-1:conv-1', 'draft before refresh');

    renderComposer({
      draftStorageKey: 'od:chat-composer:draft:project-1:conv-1',
    });
    await flushMounts();

    await waitFor(() => expect(composerText()).toBe('draft before refresh'));
  });

  it('restores unsent resource and file selections for the active conversation', async () => {
    const key = 'od:chat-composer:draft:project-1:conv-context';
    const first = renderComposer({
      draftStorageKey: key,
      skills: [RESTORED_SKILL],
    });
    await flushMounts();

    await typeAndSettle('keep the whole draft');
    act(() => {
      window.dispatchEvent(new CustomEvent(STAGE_ATTACHMENT_EVENT, {
        detail: {
          attachments: [{ path: 'references/brief.pdf', name: 'brief.pdf', kind: 'file' }],
        },
      }));
    });
    fireEvent.click(screen.getByTestId('chat-plus-trigger'));
    expect(screen.queryByText('Design toolbox')).toBeNull();
    fireEvent.click(await screen.findByTestId('composer-plus-skills'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restored Skill' }));

    await waitFor(() => {
      expect(screen.getByTestId('staged-inside-contexts').textContent).toContain('Restored Skill');
      expect(screen.getByTestId('staged-outside-contexts').textContent).toContain('brief.pdf');
      expect(window.localStorage.getItem(`${key}:contexts`)).toBe('1');
    });
    expect(
      screen.getByTestId('chat-composer').querySelector('.composer-input-wrap')
        ?.contains(screen.getByTestId('staged-inside-contexts')),
    ).toBe(true);
    first.unmount();

    const second = renderComposer({
      draftStorageKey: key,
      skills: [RESTORED_SKILL],
    });
    await flushMounts();

    expect(composerText()).toBe('keep the whole draft');
    expect(screen.getByTestId('staged-inside-contexts').textContent).toContain('Restored Skill');
    expect(screen.getByTestId('staged-outside-contexts').textContent).toContain('brief.pdf');

    fireEvent.click(screen.getByLabelText('Remove Restored Skill'));
    fireEvent.click(screen.getByLabelText('Remove brief.pdf'));
    await waitFor(() => expect(window.localStorage.getItem(`${key}:contexts`)).toBeNull());
    second.unmount();

    renderComposer({
      draftStorageKey: key,
      skills: [RESTORED_SKILL],
    });
    await flushMounts();
    expect(composerText()).toBe('keep the whole draft');
    expect(screen.queryByTestId('staged-contexts')).toBeNull();
    expect(screen.queryByTestId('staged-outside-contexts')).toBeNull();
  });

  it('keeps non-Skill/MCP context cards in the gray tray above the white editor', async () => {
    renderComposer({
      activeWorkspaceContext: CURRENT_WORKSPACE,
      initialWorkspaceContexts: [REFERENCE_WORKSPACE],
    });
    await flushMounts();
    act(() => {
      window.dispatchEvent(new CustomEvent(STAGE_ATTACHMENT_EVENT, {
        detail: {
          attachments: [{ path: 'references/brief.pdf', name: 'brief.pdf', kind: 'file' }],
        },
      }));
    });
    await waitFor(() => expect(screen.getByText('brief.pdf')).toBeTruthy());

    const shell = screen.getByTestId('chat-composer').querySelector('.composer-shell');
    const input = shell?.querySelector('.composer-input-wrap');
    const outside = screen.getByTestId('staged-outside-contexts');
    const attachment = screen.getByTestId('composer-attachment-references/brief.pdf');
    const workspace = screen.getByTestId('composer-context-workspace-workspace-reference');
    expect(shell).toHaveAttribute('data-composer-surface', 'project');
    expect(input).toHaveAttribute('data-composer-surface-part', 'input');
    expect(workspace.textContent).toBe('Reference project');
    expect(workspace.querySelector('.staged-context-kind')).toBeNull();
    expect(attachment.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(outside.querySelector('.staged-chip')).toBeTruthy();
    expect(shell?.contains(outside)).toBe(true);
    expect(input?.contains(outside)).toBe(false);
    expect(outside.compareDocumentPosition(input!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clears the saved draft after submitting it', async () => {
    const key = 'od:chat-composer:draft:project-1:conv-1';
    const onSend = vi.fn();
    renderComposer({
      draftStorageKey: key,
      onSend,
    });
    await flushMounts();

    typeAndSettle('send then clear');

    await waitFor(() => expect(window.localStorage.getItem(key)).toBe('send then clear'));
    pressEnter({ meta: true });

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeNull());
  });

  it('keeps the original draft while Send is paused and when the decision is canceled', async () => {
    let resolveDecision!: (outcome: 'restore-draft') => void;
    const onSend = vi.fn(() => new Promise<'restore-draft'>((resolve) => {
      resolveDecision = resolve;
    }));
    renderComposer({ onSend });
    await flushMounts();

    typeAndSettle('keep this exact prompt');
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeTruthy());
    fireEvent.click(screen.getByTestId('chat-send'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(composerText()).toBe('keep this exact prompt');

    await act(async () => resolveDecision('restore-draft'));
    expect(composerText()).toBe('keep this exact prompt');
  });

  it('accepts only one submit while the current send decision is pending', async () => {
    let resolveFirstSend!: () => void;
    const firstSend = new Promise<void>((resolve) => {
      resolveFirstSend = resolve;
    });
    const onSend = vi.fn()
      .mockReturnValueOnce(firstSend)
      .mockResolvedValueOnce(undefined);
    renderComposer({ onSend });
    await flushMounts();

    await typeAndSettle('send this once');
    pressEnter();
    pressEnter();

    expect(onSend).toHaveBeenCalledTimes(1);

    await act(async () => resolveFirstSend());
    await waitFor(() => expect(composerText().trim()).toBe(''));

    await typeAndSettle('send a later turn');
    pressEnter();
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
  });

  it('does not enter an infinite update loop on rapid plain-text typing', async () => {
    // #2097 surfaced as "Maximum update depth exceeded" from a feedback loop
    // between the input and a layout effect. The Lexical editor owns its own
    // text now (no overlay scroll-sync effect), so rapid edits must settle
    // without re-render storms.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderComposer();
      await flushMounts();

      for (const value of ['h', 'he', 'hel', 'hell', 'hello']) {
        typeAndSettle(value);
      }

      const maxDepth = consoleError.mock.calls.find((args) =>
        args.some((a) => typeof a === 'string' && a.includes('Maximum update depth exceeded')),
      );
      expect(maxDepth).toBeUndefined();
      expect(composerText()).toBe('hello');
    } finally {
      consoleError.mockRestore();
    }
  });
});
