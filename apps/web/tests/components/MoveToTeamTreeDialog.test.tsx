// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveToTeamTreeDialog } from '../../src/components/MoveToTeamTreeDialog';

vi.mock('../../src/i18n', () => {
  const translate = (key: string) => key;
  return { useT: () => translate };
});
vi.mock('../../src/collab/useWorkspaceContext', () => ({
  readWorkspaceDirectoryForCurrentGeneration: vi.fn(async () => ({ items: [] })),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  const personal: WorkspaceDirectoryItem = {
    workspaceId: 'personal', workspaceName: 'Personal', workspaceType: 'team',
    workspaceMemberId: 'me', role: 'owner', memberStatus: 'active',
    lifecycleState: 'active', isDefaultTeam: true,
  };
  const team: WorkspaceDirectoryItem = {
    ...personal, workspaceId: 'team', workspaceName: 'Team', isDefaultTeam: false,
  };
  const folder = (id: string, name: string, count = 0) => ({
    folder_id: id, folder_name: name, subfolder_count: count,
  });
  const tree: Record<string, ReturnType<typeof folder>[]> = {
    'personal:root': [folder('a', 'Blocked root', 2), folder('a-sibling', 'Allowed sibling'), folder('q', 'Second root', 1)],
    'personal:a': [folder('b', 'Blocked child', 1), folder('s', 'Sibling inside parent')],
    'personal:b': [folder('c', 'Blocked grandchild')],
    'personal:q': [folder('r', 'Second child')],
    'team:root': [folder('a', 'Team same id')],
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/folders' || url.pathname === '/api/hdw/api/folder/list') {
      const key = `${url.searchParams.get('workspace_id')}:${url.searchParams.get('folder_pid') ?? 'root'}`;
      return new Response(JSON.stringify({ code: 0, data: { folders: tree[key] ?? [] } }));
    }
    if (/^\/api\/folders\/[^/]+\/projects$/.test(url.pathname)) {
      const projects = url.pathname === '/api/folders/b/projects'
        ? [{ id: 'project-in-child', name: 'Blocked file' }]
        : [];
      return new Response(JSON.stringify({ code: 0, data: { projects } }));
    }
    if (url.pathname === '/api/workspace/projects/team') {
      return new Response(JSON.stringify({ projects: [] }));
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { workspaces: [personal, team], fetchMock };
}

function row(name: string): HTMLElement {
  const rows = screen.getAllByText(name)
    .map((element) => element.closest<HTMLElement>('[role="button"]'))
    .filter((element): element is HTMLElement => element !== null);
  const result = rows.at(-1);
  if (!result) throw new Error(`Folder row not found: ${name}`);
  return result;
}

async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); });
}

async function expand(name: string) {
  await click(within(row(name)).getByRole('button', { name: 'entry.navExpand' }));
}

function confirm(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'recentProjects.confirmMove' });
}

async function openDialog(overrides: Partial<ComponentProps<typeof MoveToTeamTreeDialog>> = {}) {
  const { workspaces, fetchMock } = fixture();
  const onConfirm = vi.fn();
  const props: ComponentProps<typeof MoveToTeamTreeDialog> = {
    onConfirm, onCancel: vi.fn(), workspaceItems: workspaces, mode: 'unified',
    currentWorkspaceId: 'personal', currentFolderId: null,
    disabledKeys: new Set(['personal:root', 'personal:a']),
    disabledSubtreeKeys: new Set(['personal:a']),
    ...overrides,
  };
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<MoveToTeamTreeDialog {...props} />); });
  return { ...view, props, onConfirm, fetchMock };
}

describe('folder move destination exclusions', () => {
  it('disables the moving folder and lazily expanded descendants without blocking siblings', async () => {
    const { onConfirm } = await openDialog();
    await click(row('Blocked root'));
    expect(row('Blocked root').getAttribute('aria-disabled')).toBe('true');
    expect(row('Blocked child').getAttribute('aria-disabled')).toBe('true');
    expect(within(row('Blocked root')).queryByRole('button', { name: 'settings.projectLocationsAddFolder' })).toBeNull();
    await expand('Blocked child');
    expect(row('Blocked grandchild').getAttribute('aria-disabled')).toBe('true');
    for (const name of ['Blocked root', 'Blocked child', 'Blocked grandchild']) {
      await click(row(name));
      fireEvent.keyDown(row(name), { key: 'Enter' });
      fireEvent.keyDown(row(name), { key: ' ' });
      expect(confirm().disabled).toBe(true);
    }
    await click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
    await click(row('Allowed sibling'));
    expect(confirm().disabled).toBe(false);
    await click(confirm());
    expect(onConfirm).toHaveBeenCalledWith({
      workspaceId: 'personal', workspaceName: 'personalFunc.all',
      folderId: 'a-sibling', folderName: 'Allowed sibling', isDefaultTeam: true,
    });
  });

  it('allows a nested folder to move upward or into other branches but not its current parent or own subtree', async () => {
    await openDialog({
      currentFolderId: 'a', disabledKeys: new Set(['personal:a', 'personal:b']),
      disabledSubtreeKeys: new Set(['personal:b']),
    });

    // Moving B out of A may target the personal root or another root branch.
    expect(row('personalFunc.all').getAttribute('aria-disabled')).not.toBe('true');
    expect(row('Second root').getAttribute('aria-disabled')).not.toBe('true');

    // Its existing parent (A) is a no-op destination; B and every descendant
    // are forbidden to prevent moving a folder into itself.
    expect(row('Blocked root').getAttribute('aria-disabled')).toBe('true');
    expect(row('Blocked child').getAttribute('aria-disabled')).toBe('true');
    await expand('Blocked child');
    expect(row('Blocked grandchild').getAttribute('aria-disabled')).toBe('true');

    // A sibling folder at the same source level remains a valid destination.
    await click(row('Sibling inside parent'));
    expect(confirm().disabled).toBe(false);

    // Moving upward to the workspace root is valid too.
    await click(row('personalFunc.all'));
    expect(confirm().disabled).toBe(false);
  });

  it('excludes every selected subtree in batch moves and scopes exclusions to the source workspace', async () => {
    const { onConfirm } = await openDialog({
      mode: 'personal-folders',
      disabledKeys: new Set(['personal:root', 'personal:a', 'personal:q']),
      disabledSubtreeKeys: new Set(['personal:a', 'personal:q']),
    });
    await expand('Blocked root');
    await expand('Blocked child');
    await expand('Second root');
    for (const name of ['Blocked root', 'Blocked child', 'Blocked grandchild', 'Second root', 'Second child']) {
      expect(row(name).getAttribute('aria-disabled')).toBe('true');
      await click(row(name));
    }
    expect(confirm().disabled).toBe(true);
    await click(row('Team same id'));
    await click(confirm());
    expect(onConfirm).toHaveBeenCalledWith({
      workspaceId: 'team', workspaceName: 'Team', folderId: 'a',
      folderName: 'Team same id', isDefaultTeam: false,
    });
  });

  it('disables search hits for descendants and projects located inside them', async () => {
    vi.useFakeTimers();
    const { onConfirm } = await openDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Blocked' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(179); });
    expect(screen.queryByRole('button', { name: /Blocked file/ })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    for (const name of ['Blocked root', 'Blocked child', 'Blocked grandchild', 'Blocked file']) {
      const result = screen.getByRole<HTMLButtonElement>('button', {
        name: new RegExp(`^${name}\\s*(personalFunc\\.all|recentProjects\\.moveSearchProjectIn)`),
      });
      expect(result.disabled).toBe(true);
      await click(result);
    }
    expect(confirm().disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Allowed' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    await click(screen.getByRole('button', { name: /^Allowed sibling\s*personalFunc\.all$/ }));
    expect(confirm().disabled).toBe(false);
  });

  it('rechecks a selected destination when the excluded subtrees change', async () => {
    const { rerender, props, onConfirm } = await openDialog({
      disabledKeys: new Set(['personal:root']), disabledSubtreeKeys: new Set(),
    });
    await click(row('Blocked root'));
    await expand('Blocked child');
    await click(row('Blocked grandchild'));
    expect(confirm().disabled).toBe(false);
    await act(async () => {
      rerender(<MoveToTeamTreeDialog {...props} disabledSubtreeKeys={new Set(['personal:a'])} />);
    });
    expect(confirm().disabled).toBe(true);
    await click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
