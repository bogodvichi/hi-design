// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { MoveToTeamTreeDialog } from '../../src/components/MoveToTeamTreeDialog';
import { workspaceContextFixture } from '../helpers/workspace-context';

const source = workspaceContextFixture({ workspaceId: 'source', workspaceMemberId: 'source-member' });
const ambient = workspaceContextFixture({ workspaceId: 'other', workspaceMemberId: 'other-member' });
const workspaceMocks = vi.hoisted(() => ({ resolveBound: vi.fn() }));
vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>(),
  useWorkspaceContext: () => ({ context: ambient, loading: false, failure: null }),
  useSharedSpaceTeamId: () => null,
  notifyTeamProjectsChanged: vi.fn(),
  resolveBoundProjectWorkspaceContext: workspaceMocks.resolveBound,
}));
vi.mock('../../src/collab/useTeamMembers', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/collab/useTeamMembers')>(),
  useTeamMembers: () => ({ members: [], resolve: () => null }),
}));
vi.mock('../../src/i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/i18n')>(), useT: () => (key: string) => key,
}));
vi.mock('../../src/components/MoveToTeamTreeDialog', () => ({
  MoveToTeamTreeDialog: ({ onConfirm, restrictToWorkspaceId, canMoveToPersonal, busy, copyMode }: ComponentProps<typeof MoveToTeamTreeDialog>) => <>
    <div data-testid="move-picker" data-restricted={restrictToWorkspaceId} data-personal={String(canMoveToPersonal)} data-busy={String(busy)} data-copy={String(copyMode)} />
    <button onClick={() => onConfirm({
      workspaceId: 'target', workspaceName: 'Target team', folderId: 'destination', folderName: 'Destination', isDefaultTeam: false,
    })}>choose target team</button>
    <button onClick={() => onConfirm({
      workspaceId: 'target', workspaceName: 'Target', folderId: 'destination', folderName: 'Destination', isDefaultTeam: true,
    })}>choose destination</button>
    <button onClick={() => onConfirm({
      workspaceId: 'source', workspaceName: 'Source', folderId: 'local-folder', folderName: 'Local', isDefaultTeam: false,
    })}>choose local folder</button>
  </>,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); workspaceMocks.resolveBound.mockReset(); });

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

it.each([['personal', false], ['personal', true], ['team', false], ['team', true]] as const)(
  'transfers a personally owned project with visibility=%s using its source identity (bulk=%s)', async (visibility, bulk) => {
  const requests: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/move')) {
      expect(String(input)).toBe('/api/workspaces/source/projects/project/move');
      requests.push(init!);
      return Response.json({ project: { id: 'project', workspaceId: 'target', visibility: 'team' } });
    }
    return Response.json({ items: [], members: [], files: [] });
  }));
  render(<RecentProjectsStrip
    projects={[{ id: 'project', name: 'Project', workspaceId: 'source', workspaceVisibility: visibility, createdByWorkspaceMemberId: 'source-member', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }]}
    space="drafts" homeWorkspaceId="source" currentWorkspaceId="source"
    workspaceContextOverride={{ ...source, isDefaultTeam: true }} onOpen={vi.fn()}
  />);
  if (bulk) {
    fireEvent.click(screen.getByRole('button', { name: 'recentProjects.multiSelect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'recentProjects.moveTo' }));
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'recentProjects.moveTo' }));
  }
  expect(screen.getByTestId('move-picker')).not.toHaveAttribute('data-restricted');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose target team' })); });
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(new Headers(requests[0]!.headers).get('x-od-workspace-member-id')).toBe('source-member');
  expect(JSON.parse(String(requests[0]!.body))).toMatchObject({ visibility: 'team', targetWorkspaceId: 'target', targetFolderId: 'destination' });
});

it('keeps the destination open while moving, prevents duplicate requests, and allows retry after failure', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  let moveCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/move')) { moveCount++; return pending; }
    return Response.json({ items: [], members: [], files: [] });
  }));
  render(<RecentProjectsStrip
    projects={[{ id: 'project', name: 'Project', workspaceId: 'source', createdByWorkspaceMemberId: 'source-member', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }]}
    space="drafts" homeWorkspaceId="source" currentWorkspaceId="source"
    workspaceContextOverride={{ ...source, isDefaultTeam: true }} onOpen={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'recentProjects.moveTo' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose target team' })); });
  expect(screen.getByTestId('move-picker')).toHaveAttribute('data-busy', 'true');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose target team' })); });
  expect(moveCount).toBe(1);
  await act(async () => { finish(Response.json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'offline' } }, { status: 503 })); });
  expect(screen.getByTestId('move-picker')).toHaveAttribute('data-busy', 'false');
  expect(screen.getByRole('alert')).toHaveTextContent('feedback.serviceUnavailable');
});

it.each(['member', 'guest'] as const)('omits Copy project to while preserving permitted Copy actions (%s)', (role) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [], members: [], files: [] })));
  render(<RecentProjectsStrip
    projects={[{ id: 'project', name: 'Project', workspaceId: 'source', workspaceVisibility: 'team', createdByWorkspaceMemberId: 'source-member', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }]}
    space="team" homeWorkspaceId="source" currentWorkspaceId="source"
    workspaceContextOverride={source} operator={{ memberId: 'source-member', role }} onOpen={vi.fn()} onDuplicate={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
  expect(screen.queryByRole('menuitem', { name: 'recentProjects.copyToPersonal' })).toBeNull();
  const copy = screen.queryByRole('menuitem', { name: 'designs.menuDuplicate' });
  if (role === 'guest') { expect(copy).toBeNull(); return; }
  expect(copy).toBeInTheDocument();
});

it('retries only failed items after a partial batch move', async () => {
  const moved: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const match = String(input).match(/\/projects\/(a|b)\/move$/);
    if (match) {
      const id = match[1]!;
      moved.push(id);
      if (id === 'b' && moved.filter((item) => item === 'b').length === 1) {
        return Response.json({ error: { code: 'UPSTREAM_UNAVAILABLE' } }, { status: 503 });
      }
      return Response.json({ project: { id, workspaceId: 'target', visibility: 'team' } });
    }
    return Response.json({ items: [], members: [], files: [] });
  }));
  render(<RecentProjectsStrip
    projects={['a', 'b'].map((id) => ({ id, name: id, workspaceId: 'source', createdByWorkspaceMemberId: 'source-member', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }))}
    space="drafts" homeWorkspaceId="source" currentWorkspaceId="source"
    workspaceContextOverride={{ ...source, isDefaultTeam: true }} onOpen={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'recentProjects.multiSelect' }));
  for (const name of ['a', 'b']) fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(screen.getByRole('button', { name: 'recentProjects.moveTo' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose target team' })); });
  expect(await screen.findByRole('alert')).toHaveTextContent('recentProjects.moveSummary');
  expect(screen.getByTestId('move-picker')).toHaveAttribute('data-busy', 'false');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose target team' })); });
  await waitFor(() => expect(moved).toEqual(['a', 'b', 'b']));
});

it.each([false, true])('retries only folder placement in Personal after a committed transfer (bulk=%s)', async (bulk) => {
  const requests: string[] = [];
  workspaceMocks.resolveBound.mockResolvedValue({ ...source, workspaceId: 'target', workspaceMemberId: 'personal-member', isDefaultTeam: true });
  const onProjectUnshared = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/move')) {
      requests.push(url);
      if (requests.length === 1) return Response.json({ error: { code: 'UPSTREAM_UNAVAILABLE', details: { movedProject: {
        id: 'project', workspaceId: 'target', visibility: 'personal', createdByWorkspaceMemberId: 'personal-member',
      } } } }, { status: 503 });
      expect(new Headers(init?.headers).get('x-od-workspace-member-id')).toBe('personal-member');
      return Response.json({ project: { id: 'project', workspaceId: 'target', visibility: 'personal' } });
    }
    return Response.json({ items: [], members: [], files: [] });
  }));
  const props: ComponentProps<typeof RecentProjectsStrip> = {
    projects: [{ id: 'project', name: 'Project', workspaceId: 'source', workspaceVisibility: 'team',
      createdByWorkspaceMemberId: 'source-member', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }],
    space: 'team', homeWorkspaceId: 'source', currentWorkspaceId: 'source', workspaceContextOverride: source,
    onOpen: vi.fn(), onProjectUnshared,
  };
  const view = render(<RecentProjectsStrip {...props} />);
  if (bulk) {
    fireEvent.click(screen.getByRole('button', { name: 'recentProjects.multiSelect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'recentProjects.moveTo' }));
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'recentProjects.moveTo' }));
  }
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose destination' })); });
  expect(onProjectUnshared).not.toHaveBeenCalled();
  view.rerender(<RecentProjectsStrip {...props} projects={[]} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose destination' })); });
  expect(requests).toEqual(['/api/workspaces/source/projects/project/move', '/api/workspaces/target/projects/project/move']);
  expect(onProjectUnshared).toHaveBeenCalledWith('project');
});

describe.each(['team', 'drafts'] as const)('%s collection project moves', (space) => {
  it.each([false, true])('moves a creator-owned team project to Personal using its source identity (bulk=%s)', async (bulk) => {
    const requests: RequestInit[] = [];
    const onProjectUnshared = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/move')) {
        expect(String(input)).toBe('/api/workspaces/source/projects/project/move');
        requests.push(init!);
        return Response.json({ project: { id: 'project', workspaceId: 'target', visibility: 'personal' } });
      }
      return Response.json({ items: [], members: [], files: [] });
    }));
    render(<RecentProjectsStrip
      projects={[{ id: 'project', name: 'Project', workspaceId: 'source', workspaceVisibility: 'team', createdByWorkspaceMemberId: 'source-member', createdAt: 1, updatedAt: 1, skillId: null, designSystemId: null }]}
      space={space} heading="Folder" homeWorkspaceId="source" currentWorkspaceId="source" currentFolderId="folder"
      workspaceContextOverride={source} onOpen={vi.fn()} onProjectUnshared={onProjectUnshared}
    />);
    if (bulk) {
      fireEvent.click(screen.getByRole('button', { name: 'recentProjects.multiSelect' }));
      fireEvent.click(screen.getByRole('button', { name: 'Project' }));
      fireEvent.click(screen.getByRole('button', { name: 'recentProjects.moveTo' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'recentProjects.moveTo' }));
    }
    expect(screen.getByTestId('move-picker')).toHaveAttribute('data-personal', 'true');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose destination' })); });
    await waitFor(() => expect(onProjectUnshared).toHaveBeenCalledWith('project'));
    expect(requests).toHaveLength(1);
    expect(new Headers(requests[0]!.headers).get('x-od-workspace-member-id')).toBe('source-member');
    expect(JSON.parse(String(requests[0]!.body))).toMatchObject({ visibility: 'personal', targetWorkspaceId: 'target', targetFolderId: 'destination' });
  });

  it.each([false, true])('transfers creator projects across teams from the picker (bulk=%s)', async (bulk) => {
    const requests: RequestInit[] = [];
    const events = vi.spyOn(window, 'dispatchEvent');
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
    expect(screen.getByTestId('move-picker')).not.toHaveAttribute('data-restricted');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose target team' })); });
    await waitFor(() => expect(requests).toHaveLength(1));
    const refreshedTeams = events.mock.calls.map(([event]) => event)
      .filter((event) => event.type === 'hdw:folders-updated').map((event) => (event as CustomEvent).detail.teamId);
    expect(refreshedTeams).toEqual(expect.arrayContaining(['source', 'target']));
    events.mockRestore();
    expect(new Headers(requests[0]!.headers).get('x-od-workspace-member-id')).toBe('source-member');
    expect(JSON.parse(String(requests[0]!.body))).toMatchObject({ visibility: 'team', targetWorkspaceId: 'target', targetFolderId: 'destination' });
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
    expect(screen.getByTestId('move-picker')).toHaveAttribute('data-restricted', 'source');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'choose target team' })); });
    expect(urls.some((url) => url.endsWith('/move'))).toBe(false);
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
