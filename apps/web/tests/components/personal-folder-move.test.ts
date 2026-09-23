// @vitest-environment jsdom
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { movePersonalFolderRoots } from '../../src/components/personal-folder-move';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), context: vi.fn(), move: vi.fn(), generation: 1 }));
vi.mock('../../src/collab/useProjectWorkspaceScope', () => ({ resolveProjectWorkspaceContext: mocks.resolve }));
vi.mock('../../src/collab/useWorkspaceContext', () => ({
  resolveBoundProjectWorkspaceContext: mocks.context,
  currentWorkspaceAccountGeneration: () => mocks.generation,
}));
vi.mock('../../src/state/projects', () => ({ moveWorkspaceProject: mocks.move }));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.move.mockReset(); mocks.resolve.mockReset(); mocks.context.mockReset(); mocks.generation = 1;
});

function fixture() {
  const contexts = Object.fromEntries(['personal', 'team'].map((id) => [id, {
    workspaceId: id, workspaceMemberId: id === 'personal' ? 'me' : 'team-me',
    workspaceType: 'team', isDefaultTeam: id === 'personal', role: 'owner',
    lifecycleState: 'active', memberStatus: 'active', permissions: { canShareProjects: true },
  }])) as Record<string, WorkspaceCollabContext>;
  const source = [
    { folder_id: 'a', folder_name: 'A', folder_pid: null as string | null },
    { folder_id: 'c', folder_name: 'Child', folder_pid: 'a' as string | null },
    { folder_id: 'b', folder_name: 'B', folder_pid: null as string | null },
  ];
  const locations = new Map([
    ['p1', { workspaceId: 'personal', folderId: 'a' }],
    ['p2', { workspaceId: 'personal', folderId: 'c' }],
  ]);
  const created: Array<{ folder_id: string; folder_pid: string | null; folder_name: string }> = [];
  const removed: string[] = [];
  const unassigned = new Set<string>();
  const flags = { failSecond: false, uncertainFirst: false, createFails: false, malformedTree: false, cleanupFails: false, failAssignment: false };
  const response = (data: unknown, status = 200) => new Response(JSON.stringify({ code: status === 200 ? 0 : 1, data }), { status });
  mocks.context.mockImplementation(async (id: string) => contexts[id] ?? null);
  mocks.resolve.mockImplementation(async (id: string) => contexts[locations.get(id)?.workspaceId ?? ''] ?? null);
  mocks.move.mockImplementation(async (input: { projectId: string; targetWorkspaceId: string; targetFolderId: string }) => {
    if (flags.failSecond && input.projectId === 'p2') throw new Error('Second project rejected');
    locations.set(input.projectId, { workspaceId: input.targetWorkspaceId, folderId: input.targetFolderId });
    if (flags.failAssignment && input.projectId === 'p1') unassigned.add('p1');
    if (flags.uncertainFirst && input.projectId === 'p1') throw new Error('Response lost after commit');
    return { workspaceId: input.targetWorkspaceId, project: { id: input.projectId } };
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    if (path === '/api/hdw/api/folder/create') {
      if (flags.createFails) return response({}, 503);
      const body = JSON.parse(String(init?.body));
      created.push(...body.folders);
      return response({});
    }
    if (path === '/api/hdw/api/folder/list') {
      return response({ folders: created.filter((folder) => folder.folder_pid === (url.searchParams.get('folder_pid') ?? null)) });
    }
    if (path === '/api/hdw/api/folder/project/list') {
      return response({ projects: [...locations].filter(([id, loc]) => !unassigned.has(id) && loc.workspaceId === 'team' && loc.folderId === url.searchParams.get('folder_id')).map(([id]) => ({ project_id: id })) });
    }
    if (path === '/api/hdw/api/folder/project/move') {
      if (flags.failAssignment) return response({}, 503);
      const body = JSON.parse(String(init?.body));
      unassigned.delete(body.project_id);
      return response({});
    }
    if (path.startsWith('/api/projects/')) {
      const projectId = path.split('/').at(-1)!;
      const location = locations.get(projectId)!;
      return new Response(JSON.stringify({ project: { id: projectId, workspaceId: location.workspaceId }, folderId: location.folderId }));
    }
    if (path === '/api/folders') {
      return response({ folders: source.filter((folder) => !removed.includes(folder.folder_id) && folder.folder_pid === (url.searchParams.get('folder_pid') ?? null)) });
    }
    const id = path.split('/')[3]!;
    if (path.endsWith('/projects')) {
      if (flags.malformedTree) return response({});
      return response({ projects: [...locations].filter(([, loc]) => loc.workspaceId === 'personal' && loc.folderId === id).map(([projectId]) => ({ id: projectId })) });
    }
    if (path.startsWith('/api/folders/') && method === 'PATCH') return response({}, id === 'b' ? 403 : 200);
    if (path.endsWith('/move-cleanup') && method === 'POST') {
      if (flags.cleanupFails) return response({}, 409);
      removed.push(id);
      return response({ folder_id: id });
    }
    if (path.startsWith('/api/folders/')) {
      if (removed.includes(id)) return response({}, 404);
      const folder = source.find((f) => f.folder_id === id);
      return response({ ...folder, workspace_id: 'personal' }, folder ? 200 : 404);
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const input = {
    sourceWorkspaceId: 'personal', sourceWorkspaceMemberId: 'me',
    roots: [{ folderId: 'a', folderName: 'A' }], action: 'to-team' as const,
    targetWorkspaceId: 'team', targetFolderId: null,
  };
  return { input, fetchMock, created, removed, flags, locations, contexts };
}

describe('personal folder move outcomes and interrupted migration', () => {
  it('returns successful folder IDs rather than counting a partial batch as all moved', async () => {
    const { input } = fixture();
    const result = await movePersonalFolderRoots({ ...input, action: 'to-personal', targetWorkspaceId: 'personal', targetFolderId: 'other', roots: [...input.roots, { folderId: 'b', folderName: 'B' }] });
    expect(result.succeededFolderIds).toEqual(['a']);
    expect(result.failures.map((item) => item.folderId)).toEqual(['b']);
  });

  it('keeps structure and removes the source only after all project moves are confirmed', async () => {
    const { input, created, removed, fetchMock } = fixture();
    const result = await movePersonalFolderRoots(input);
    expect(result.succeededFolderIds).toEqual(['a']);
    expect(result.failures).toEqual([]);
    expect(created).toHaveLength(2);
    expect(created[1]?.folder_pid).toBe(created[0]?.folder_id);
    expect(removed).toEqual(['a']);
    const cleanup = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/move-cleanup'));
    expect(JSON.parse(String(cleanup?.[1]?.body)).expectedEmptyTree).toHaveLength(2);
  });

  it('reports partial progress and keeps the original folder when the second project fails', async () => {
    const { input, flags, created, removed } = fixture();
    flags.failSecond = true;
    const result = await movePersonalFolderRoots(input);
    expect(result.succeededFolderIds).toEqual([]);
    expect(result.failures[0]).toMatchObject({ folderId: 'a', code: 'interrupted', completedProjectIds: ['p1'] });
    expect(created).toHaveLength(2);
    expect(removed).toEqual([]);
    expect(localStorage.length).toBeGreaterThan(0);
  });

  it('resumes the same destination without duplicate directories or moving confirmed projects again', async () => {
    const { input, flags, created, removed } = fixture();
    flags.failSecond = true;
    await movePersonalFolderRoots(input);
    mocks.move.mockClear(); flags.failSecond = false;
    const result = await movePersonalFolderRoots(input);
    expect(result.succeededFolderIds).toEqual(['a']);
    expect(created).toHaveLength(2);
    expect(mocks.move.mock.calls.map(([args]) => args.projectId)).toEqual(['p2']);
    expect(removed).toEqual(['a']);
    expect(localStorage.length).toBe(0);
  });

  it('retains recovery state across a module reload', async () => {
    const { input, flags, created } = fixture();
    flags.failSecond = true;
    await movePersonalFolderRoots(input);
    flags.failSecond = false; mocks.move.mockClear();
    vi.resetModules();
    const reloaded = await import('../../src/components/personal-folder-move');
    expect((await reloaded.movePersonalFolderRoots(input)).succeededFolderIds).toEqual(['a']);
    expect(created).toHaveLength(2);
    expect(mocks.move.mock.calls.map(([args]) => args.projectId)).toEqual(['p2']);
  });

  it('rejects a different destination while a migration is incomplete', async () => {
    const { input, flags, fetchMock } = fixture();
    flags.failSecond = true;
    await movePersonalFolderRoots(input);
    fetchMock.mockClear(); mocks.move.mockClear();
    const result = await movePersonalFolderRoots({ ...input, targetFolderId: 'different' });
    expect(result.failures[0]?.code).toBe('destination-locked');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.move).not.toHaveBeenCalled();
  });

  it('does not treat a malformed tree response as an empty folder', async () => {
    const { input, flags, created, removed } = fixture();
    flags.malformedTree = true;
    const result = await movePersonalFolderRoots(input);
    expect(result.failures).toHaveLength(1);
    expect(created).toEqual([]); expect(removed).toEqual([]);
    expect(mocks.move).not.toHaveBeenCalled();
  });

  it('reconciles an unknown move outcome before retrying instead of replaying it', async () => {
    const { input, flags, created } = fixture();
    flags.uncertainFirst = true;
    await movePersonalFolderRoots(input);
    flags.uncertainFirst = false; mocks.move.mockClear();
    const result = await movePersonalFolderRoots(input);
    expect(result.succeededFolderIds).toEqual(['a']);
    expect(mocks.move.mock.calls.map(([args]) => args.projectId)).toEqual(['p2']);
    expect(created).toHaveLength(2);
  });

  it('repairs only the folder association after team transfer succeeded but folder sync failed', async () => {
    const { input, flags, created, fetchMock } = fixture();
    flags.failAssignment = true;
    const first = await movePersonalFolderRoots(input);
    expect(first.failures).toHaveLength(1);
    flags.failAssignment = false; mocks.move.mockClear(); fetchMock.mockClear();
    const resumed = await movePersonalFolderRoots(input);
    expect(resumed.succeededFolderIds).toEqual(['a']);
    expect(mocks.move.mock.calls.map(([args]) => args.projectId)).toEqual(['p2']);
    const assignment = fetchMock.mock.calls.find(([url]) => String(url) === '/api/hdw/api/folder/project/move');
    expect(JSON.parse(String(assignment?.[1]?.body))).toMatchObject({ project_id: 'p1', workspace_id: 'team', operator_member_id: 'team-me' });
    expect(created).toHaveLength(2);
  });

  it('accepts acknowledgement-only writes but still verifies actual destination membership', async () => {
    const { input, flags, fetchMock } = fixture();
    flags.failAssignment = true;
    await movePersonalFolderRoots(input);
    flags.failAssignment = false;
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (String(args[0]) === '/api/hdw/api/folder/project/move' && result.ok) {
        return new Response(JSON.stringify({ code: 0, data: null }));
      }
      return result;
    });
    expect((await movePersonalFolderRoots(input)).succeededFolderIds).toEqual(['a']);
  });

  it('retries only final cleanup when projects moved but source cleanup was refused', async () => {
    const { input, flags, created } = fixture();
    flags.cleanupFails = true;
    const interrupted = await movePersonalFolderRoots(input);
    expect(interrupted.succeededFolderIds).toEqual([]);
    expect(interrupted.failures[0]?.completedProjectIds).toEqual(['p1', 'p2']);
    flags.cleanupFails = false; mocks.move.mockClear();
    expect((await movePersonalFolderRoots(input)).succeededFolderIds).toEqual(['a']);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(created).toHaveLength(2);
  });

  it('does not begin remote writes if the recovery journal cannot be persisted', async () => {
    const { input, created, removed } = fixture();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
    const result = await movePersonalFolderRoots(input);
    expect(result.failures).toHaveLength(1);
    expect(created).toEqual([]); expect(removed).toEqual([]);
    expect(mocks.move).not.toHaveBeenCalled();
  });

  it('does not borrow another workspace member identity', async () => {
    const { input, contexts, created } = fixture();
    contexts.personal!.workspaceMemberId = 'someone-else';
    const result = await movePersonalFolderRoots(input);
    expect(result.failures).toHaveLength(1);
    expect(created).toEqual([]);
    expect(mocks.move).not.toHaveBeenCalled();
  });
});
