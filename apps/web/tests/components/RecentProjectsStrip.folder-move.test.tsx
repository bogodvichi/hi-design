// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { MoveToTeamTreeDialog } from '../../src/components/MoveToTeamTreeDialog';

vi.mock('../../src/i18n', async (importOriginal) => {
  const translate = (key: string) => key;
  return { ...await importOriginal<typeof import('../../src/i18n')>(), useT: () => translate };
});
vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>(),
  useWorkspaceContext: () => ({ context: null, loading: false, failure: null }),
  useSharedSpaceTeamId: () => null,
  notifyTeamProjectsChanged: vi.fn(),
}));
vi.mock('../../src/components/MoveToTeamTreeDialog', () => ({
  MoveToTeamTreeDialog: ({ onConfirm }: ComponentProps<typeof MoveToTeamTreeDialog>) => <button onClick={() => onConfirm({ workspaceId: 'personal', workspaceName: 'Personal', folderId: 'target', folderName: 'Target', isDefaultTeam: true })}>choose destination</button>,
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function click(name: string) { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); }
async function setup(onMoveSelected: () => Promise<number>) {
  const onClear = vi.fn(); const onModeChange = vi.fn();
  render(<RecentProjectsStrip projects={[]} space="drafts" heading="Personal" onOpen={vi.fn()} emptyContent={null} canManageProjectCollection selectionExtension={{ selectedCount: 2, onMoveSelected, onClear, onModeChange, preserveFailedMoveSelection: true }} />);
  await click('recentProjects.multiSelect');
  onClear.mockClear(); onModeChange.mockClear();
  await click('recentProjects.moveTo');
  await click('choose destination');
  return { onClear, onModeChange };
}

describe('folder-aware bulk move selection lifecycle', () => {
  it('keeps selection mode and does not clear failed folders on partial success', async () => {
    const { onClear, onModeChange } = await setup(async () => 1);
    expect(screen.getByRole('toolbar')).toBeTruthy();
    expect(onClear).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalledWith(false);
  });
  it('exits and clears selection only after every folder succeeded', async () => {
    const { onClear, onModeChange } = await setup(async () => 2);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith(false);
  });
  it('prevents a second move or selection cancellation while the first move is pending', async () => {
    let complete!: (n: number) => void;
    const move = vi.fn(() => new Promise<number>((resolve) => { complete = resolve; }));
    const { onClear } = await setup(move);
    expect((screen.getByRole('button', { name: 'recentProjects.moveTo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'recentProjects.multiSelect' }) as HTMLButtonElement).disabled).toBe(true);
    await click('designs.cancelSelect');
    expect(onClear).not.toHaveBeenCalled();
    await act(async () => { complete(1); });
    expect(move).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('toolbar')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'recentProjects.moveTo' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
