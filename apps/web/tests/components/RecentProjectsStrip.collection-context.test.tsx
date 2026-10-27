// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { MoveToTeamTreeDialog } from '../../src/components/MoveToTeamTreeDialog';
import { workspaceContextFixture } from '../helpers/workspace-context';

const source = workspaceContextFixture({ workspaceId: 'source', workspaceMemberId: 'source-member' });
const ambient = workspaceContextFixture({ workspaceId: 'other', workspaceMemberId: 'other-member' });
vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>(),
  useWorkspaceContext: () => ({ context: ambient, loading: false, failure: null }),
  useSharedSpaceTeamId: () => null,
  notifyTeamProjectsChanged: vi.fn(),
}));
vi.mock('../../src/collab/useTeamMembers', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/collab/useTeamMembers')>(),
  useTeamMembers: () => ({ members: [], resolve: () => null }),
}));
vi.mock('../../src/i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/i18n')>(), useT: () => (key: string) => key,
}));
vi.mock('../../src/components/MoveToTeamTreeDialog', () => ({
  MoveToTeamTreeDialog: ({ onConfirm }: ComponentProps<typeof MoveToTeamTreeDialog>) => <>
    <button onClick={() => onConfirm({
      workspaceId: 'target', workspaceName: 'Target', folderId: 'destination', folderName: 'Destination', isDefaultTeam: true,
    })}>choose destination</button>
    <button onClick={() => onConfirm({
      workspaceId: 'source', workspaceName: 'Source', folderId: 'local-folder', folderName: 'Local', isDefaultTeam: false,
    })}>choose local folder</button>
  </>,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('offers copy and removal of a received share without moving or deleting its source project', async () => {
  const onDuplicate = vi.fn();
  const onRemoveSharedWithMe = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ members: [], files: [] })));
  render(<RecentProjectsStrip
    projects={[{ id: 'shared-project', name: 'Shared project', workspaceId: 'owner-workspace', createdByWorkspaceMemberId: 'owner-member', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }]}
    space="team" badgeOverride="shared" heading="Shared folder"
    onOpen={vi.fn()} onDuplicate={onDuplicate} onRemoveSharedWithMe={onRemoveSharedWithMe}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
  expect(screen.queryByRole('menuitem', { name: 'recentProjects.moveTo' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'designs.menuDelete' })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'designs.menuDuplicate' })); });
  expect(onDuplicate).toHaveBeenCalledWith('shared-project');
  fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'sharedSpace.removeFromSharedWithMe' }));
  expect(onRemoveSharedWithMe).toHaveBeenCalledWith('shared-project');
});

describe.each(['team', 'drafts'] as const)('%s collection project moves', (space) => {
  it.each([false, true])('rejects cross-team moves from the picker (bulk=%s)', async (bulk) => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/move')) {
        expect(String(input)).toBe('/api/workspaces/source/projects/project/move');
        requests.push(init!);
        return Response.json({ project: { projectId: 'project', workspaceId: 'target' } });
      }
      return Response.json({ items: [], members: [], files: [] });
    }));
    render(<RecentProjectsStrip
      projects={[{ id: 'project', name: 'Project', workspaceId: 'source', createdByWorkspaceMemberId: 'source-member', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }]}
      space={space} heading="Folder" homeWorkspaceId="source" currentWorkspaceId="source" currentFolderId="folder"
      workspaceContextOverride={source} onOpen={vi.fn()}
    />);
    if (bulk) {
      fireEvent.click(screen.getByRole('button', { name: 'recentProjects.multiSelect' }));
      fireEvent.click(screen.getByRole('button', { name: 'Project' }));
      fireEvent.click(screen.getByRole('button', { name: 'recentProjects.moveTo' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'recentProjects.moveTo' }));
    }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose destination' })); });
    expect(requests).toHaveLength(0);
    expect(await screen.findByText('不允许跨团队移动项目，请选择当前团队内的文件夹。')).toBeInTheDocument();
  });

  it.each([false, true])('uses the exact source identity for same-team moves (bulk=%s)', async (bulk) => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/move')) {
        expect(String(input)).toBe('/api/workspaces/source/projects/project/move');
        requests.push(init!);
        return Response.json({ project: { projectId: 'project', workspaceId: 'source' } });
      }
      return Response.json({ items: [], members: [], files: [] });
    }));
    render(<RecentProjectsStrip
      projects={[{ id: 'project', name: 'Project', workspaceId: 'source', createdByWorkspaceMemberId: 'source-member', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }]}
      space={space} heading="Folder" homeWorkspaceId="source" currentWorkspaceId="source" currentFolderId="folder"
      workspaceContextOverride={source} onOpen={vi.fn()}
    />);
    if (bulk) {
      fireEvent.click(screen.getByRole('button', { name: 'recentProjects.multiSelect' }));
      fireEvent.click(screen.getByRole('button', { name: 'Project' }));
      fireEvent.click(screen.getByRole('button', { name: 'recentProjects.moveTo' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'recentProjects.moveTo' }));
    }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose local folder' })); });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new Headers(requests[0]!.headers).get('x-od-workspace-id')).toBe('source');
    expect(new Headers(requests[0]!.headers).get('x-od-workspace-member-id')).toBe('source-member');
    expect(JSON.parse(String(requests[0]!.body))).toMatchObject({ visibility: 'team', targetWorkspaceId: 'source', targetFolderId: 'local-folder' });
  });

  it.each([false, true])('allows managers to reorganize a teammate project using metadata only (bulk=%s)', async (bulk) => {
    const requests: RequestInit[] = [];
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      if (String(input) === '/api/hdw/api/folder/project/move') {
        requests.push(init!);
        return Response.json({ code: 0, data: { folder_id: 'local-folder' } });
      }
      return Response.json({ items: [], members: [], files: [] });
    }));
    render(<RecentProjectsStrip
      projects={[{ id: 'project', name: 'Project', workspaceId: 'source', createdByWorkspaceMemberId: 'another-creator', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }]}
      space="team" heading="Folder" homeWorkspaceId="source" currentWorkspaceId="source" currentFolderId="folder"
      workspaceContextOverride={source} operator={{ memberId: 'source-member', role: 'admin' }} onOpen={vi.fn()}
    />);
    if (bulk) {
      fireEvent.click(screen.getByRole('button', { name: 'recentProjects.multiSelect' }));
      fireEvent.click(screen.getByRole('button', { name: 'Project' }));
      fireEvent.click(screen.getByRole('button', { name: 'recentProjects.moveTo' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'recentProjects.moveTo' }));
    }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose local folder' })); });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(JSON.parse(String(requests[0]!.body))).toMatchObject({
      project_id: 'project', workspace_id: 'source', folder_id: 'local-folder',
    });
    expect(urls.some((url) => url.endsWith('/projects/project/move'))).toBe(false);
  });

  it.each([['owner', true], ['admin', true], ['member', false], ['guest', false]] as const)(
    'permits team %s to delete a teammate project only when authorized', async (role, allowed) => {
      const onDelete = vi.fn().mockResolvedValue(true);
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [], members: [], files: [] })));
      render(<RecentProjectsStrip
        projects={[{ id: 'project', name: 'Project', workspaceId: 'source', createdByWorkspaceMemberId: 'another-creator', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }]}
        space="team" heading="Folder" homeWorkspaceId="source" currentWorkspaceId="source"
        workspaceContextOverride={source} operator={{ memberId: 'source-member', role }}
        onOpen={vi.fn()} onDelete={onDelete}
      />);
      const more = screen.queryByRole('button', { name: 'designs.menuMore' });
      if (more) fireEvent.click(more);
      const deleteMenu = screen.queryByRole('menuitem', { name: 'designs.menuDelete' });
      if (!allowed) {
        expect(deleteMenu).toBeNull();
        expect(onDelete).not.toHaveBeenCalled();
        return;
      }
      expect(deleteMenu).toBeInTheDocument();
      fireEvent.click(deleteMenu!);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'designs.menuDelete' }));
      });
      await waitFor(() => expect(onDelete).toHaveBeenCalledWith('project'));
    },
  );
});
