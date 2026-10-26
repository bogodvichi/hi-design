// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderView } from '../../src/components/TeamSpaceView';
import { PersonalFolderView } from '../../src/components/PersonalFolderView';
import type { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';

const state = vi.hoisted(() => ({ strip: null as ComponentProps<typeof RecentProjectsStrip> | null }));
vi.mock('../../src/components/RecentProjectsStrip', () => ({
  RecentProjectsStrip: (props: ComponentProps<typeof RecentProjectsStrip>) => { state.strip = props; return null; },
}));
vi.mock('../../src/components/AddSkillDialog', () => ({ AddSkillDialog: () => null }));
vi.mock('../../src/components/AddMcpDialog', () => ({ AddMcpDialog: () => null }));
vi.mock('../../src/components/CloudSkillList', () => ({ CloudSkillList: () => null }));
vi.mock('../../src/components/CloudMcpList', () => ({ CloudMcpList: () => null }));
vi.mock('../../src/auth/auth', () => ({ getStoredUsername: () => null }));

afterEach(() => { cleanup(); state.strip = null; vi.unstubAllGlobals(); });

describe.each(['team', 'personal'] as const)('%s folder project actions', (kind) => {
  async function setup() {
    let present = true;
    const workspaceId = `${kind}-workspace`;
    const onDeleteProject = vi.fn(async () => true);
    const onCopyProject = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/workspace/directory') return Response.json({ items: [{
        workspaceId, workspaceMemberId: 'source-member', workspaceName: 'Source', workspaceType: 'team',
        role: 'owner', memberStatus: 'active', lifecycleState: 'active', isDefaultTeam: kind === 'personal',
      }] });
      if (url.pathname === '/api/hdw/api/folder/detail') return Response.json({ code: 0, data: { folder_id: 'folder', folder_name: 'Folder' } });
      if (url.pathname === '/api/workspace/projects/team') return Response.json({ projects: present ? [{
        projectId: 'folder-project', name: 'In folder', ownerMemberId: 'source-member', folderId: 'folder', sharedAt: '2026-10-23T00:00:00Z',
      }] : [] });
      if (url.pathname.endsWith('/projects')) return Response.json({ code: 0, data: { projects: present ? [{
        id: 'folder-project', name: 'In folder', workspaceId, createdByWorkspaceMemberId: 'source-member', createdAt: 1, updatedAt: 1,
      }] : [] } });
      return Response.json({ code: 0, data: { folders: [], path: [{ folder_id: 'folder', folder_name: 'Folder' }] } });
    }));
    await act(async () => {
      render(kind === 'team'
        ? <FolderView teamId={workspaceId} folderId="folder" onDeleteProject={onDeleteProject} onCopyProject={onCopyProject} />
        : <PersonalFolderView folderId="folder" onDeleteProject={onDeleteProject} onCopyProject={onCopyProject} />);
    });
    await waitFor(() => expect(state.strip?.projects).toHaveLength(1));
    return { workspaceId, onDeleteProject, onCopyProject, remove: () => { present = false; } };
  }

  it('passes the collection identity into card operations', async () => {
    const { workspaceId, onDeleteProject, onCopyProject } = await setup();
    expect(state.strip?.workspaceContextOverride).toMatchObject({ workspaceId, workspaceMemberId: 'source-member' });
    await act(async () => { await state.strip?.onDelete?.('folder-project'); });
    expect(onDeleteProject).toHaveBeenCalledWith('folder-project', {
      project: expect.objectContaining({ id: 'folder-project', workspaceId }),
      workspaceContext: expect.objectContaining({ workspaceId, workspaceMemberId: 'source-member' }),
    });
    await act(async () => { await state.strip?.onDuplicate?.('folder-project'); });
    expect(onCopyProject).toHaveBeenCalledWith('folder-project', expect.objectContaining({
      sourceWorkspaceId: workspaceId, targetFolderId: 'folder',
    }));
  });

  it('refreshes projects after workspace-wide move/delete notifications', async () => {
    const { workspaceId, remove } = await setup();
    remove();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(kind === 'team' ? 'hdw:subfolders-updated' : 'personal:folders-updated', {
        detail: { teamId: workspaceId },
      }));
    });
    await waitFor(() => expect(state.strip?.projects).toHaveLength(0));
  });
});
