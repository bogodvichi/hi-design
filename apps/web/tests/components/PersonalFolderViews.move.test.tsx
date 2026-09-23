// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalAllView } from '../../src/components/PersonalAllView';
import { PersonalFolderView } from '../../src/components/PersonalFolderView';
import type { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { MoveToTeamTreeDialog } from '../../src/components/MoveToTeamTreeDialog';

const mocks = vi.hoisted(() => ({ move: vi.fn() }));
vi.mock('../../src/components/personal-folder-move', () => ({ movePersonalFolderRoots: mocks.move }));
vi.mock('../../src/collab/useWorkspaceContext', () => ({ currentWorkspaceAccountGeneration: () => 1, notifyTeamProjectsChanged: vi.fn() }));
vi.mock('../../src/i18n', () => ({ useT: () => (key: string, vars?: Record<string, unknown>) => `${key} ${vars ? JSON.stringify(vars) : ''}`.trim() }));
vi.mock('../../src/router', () => ({ navigate: vi.fn() }));
vi.mock('../../src/components/AddSkillDialog', () => ({ AddSkillDialog: () => null }));
vi.mock('../../src/components/AddMcpDialog', () => ({ AddMcpDialog: () => null }));
vi.mock('../../src/components/CloudSkillList', () => ({ CloudSkillList: () => null }));
vi.mock('../../src/components/CloudMcpList', () => ({ CloudMcpList: () => null }));
vi.mock('../../src/components/ShareFolderDialog', () => ({ ShareFolderDialog: () => null }));
vi.mock('../../src/components/FolderCardMenu', () => ({ FolderCardMenu: ({ onMove }: { onMove?: () => void }) => <button onClick={(event) => { event.stopPropagation(); onMove?.(); }}>move one</button> }));
vi.mock('../../src/components/RecentProjectsStrip', () => ({
  RecentProjectsStrip: ({ selectionExtension }: ComponentProps<typeof RecentProjectsStrip>) => <div>
    <button onClick={() => selectionExtension?.onModeChange?.(true)}>select folders</button>
    <button onClick={() => { void selectionExtension?.onMoveSelected?.('to-personal', { targetWorkspaceId: 'personal', targetFolderId: 'target' }); }}>move folders</button>
    <span data-testid="selection-count">{selectionExtension?.selectedCount}</span>
  </div>,
}));
vi.mock('../../src/components/MoveToTeamTreeDialog', () => ({
  MoveToTeamTreeDialog: ({ onConfirm, onCancel, busy }: ComponentProps<typeof MoveToTeamTreeDialog>) => <div role="dialog">
    <button disabled={busy} onClick={() => onConfirm({ workspaceId: 'team', workspaceName: 'Team', folderId: null, folderName: null })}>confirm move</button>
    <button onClick={onCancel}>cancel move</button>
  </div>,
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); mocks.move.mockReset(); });
async function click(element: HTMLElement) { await act(async () => { fireEvent.click(element); }); }
async function openView(nested: boolean) {
  let listReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    let body: unknown;
    if (url.pathname === '/api/workspace/directory') body = { items: [{ workspaceId: 'personal', workspaceMemberId: 'me', workspaceType: 'team', isDefaultTeam: true }] };
    else if (url.pathname === '/api/folders') {
      // A refresh outage must not hide the retained failed folder or clear its selection.
      if (listReads++ > 0) return new Response('{}', { status: 503 });
      body = { code: 0, data: { folders: [{ folder_id: 'a', folder_name: 'A' }, { folder_id: 'b', folder_name: 'B' }] } };
    } else if (url.pathname.endsWith('/projects')) body = { code: 0, data: { projects: [] } };
    else body = { code: 0, data: { path: [{ folder_id: 'parent', folder_name: 'Parent' }] } };
    return new Response(JSON.stringify(body));
  }));
  await act(async () => {
    if (nested) render(<PersonalFolderView folderId="parent" />);
    else render(<PersonalAllView onOpenProject={vi.fn()} onDeleteProject={vi.fn()} onRenameProject={vi.fn()} />);
  });
}

describe.each([false, true])('personal folder view (nested=%s)', (nested) => {
  it('removes only successful folders and retains failed selections even if refresh fails', async () => {
    mocks.move.mockResolvedValue({ succeededFolderIds: ['a'], failures: [{ folderId: 'b', folderName: 'B', code: 'failed', completedProjectIds: [] }] });
    await openView(nested);
    await click(screen.getByText('select folders'));
    await click(screen.getByTitle('A')); await click(screen.getByTitle('B'));
    expect(screen.getByTestId('selection-count').textContent).toBe('2');
    await click(screen.getByText('move folders'));
    expect(mocks.move).toHaveBeenCalledWith(expect.objectContaining({ roots: [expect.objectContaining({ folderId: 'a' }), expect.objectContaining({ folderId: 'b' })] }));
    expect(screen.queryByTitle('A')).toBeNull();
    expect(screen.getByTitle('B')).toBeTruthy();
    expect(screen.getByTestId('selection-count').textContent).toBe('1');
    expect(screen.getByRole('alert').textContent).toContain('B');
  });

  it('keeps all folders on total failure and shows a failure instead of success', async () => {
    mocks.move.mockResolvedValue({ succeededFolderIds: [], failures: [{ folderId: 'a', folderName: 'A', code: 'failed', completedProjectIds: [] }, { folderId: 'b', folderName: 'B', code: 'failed', completedProjectIds: [] }] });
    await openView(nested);
    await click(screen.getByText('select folders'));
    await click(screen.getByTitle('A')); await click(screen.getByTitle('B'));
    await click(screen.getByText('move folders'));
    expect(screen.getByTitle('A')).toBeTruthy(); expect(screen.getByTitle('B')).toBeTruthy();
    expect(screen.getByTestId('selection-count').textContent).toBe('2');
    expect(screen.getByRole('alert').textContent).toContain('"succeeded":0');
  });

  it('keeps the single-item dialog open on interruption and closes it only on completed retry', async () => {
    mocks.move.mockResolvedValueOnce({ succeededFolderIds: [], failures: [{ folderId: 'a', folderName: 'A', code: 'interrupted', completedProjectIds: ['p1'], targetWorkspaceName: 'Team', targetRootId: 'target-a' }] })
      .mockResolvedValueOnce({ succeededFolderIds: ['a'], failures: [] });
    await openView(nested);
    await click(within(screen.getByTitle('A')).getByText('move one'));
    await click(screen.getByText('confirm move'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('"count":1');
    expect(screen.getByTitle('A')).toBeTruthy();
    await click(screen.getByText('confirm move'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTitle('A')).toBeNull();
  });
});
