// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceContextFixture } from '../helpers/workspace-context';
import { movePersonalFolderRoots } from '../../src/components/personal-folder-move';

const mocks = vi.hoisted(() => ({ directory: vi.fn(), move: vi.fn() }));
vi.mock('../../src/collab/useWorkspaceContext', () => ({
  resolveBoundProjectWorkspaceContext: mocks.directory,
  currentWorkspaceAccountGeneration: () => 1,
}));
vi.mock('../../src/state/projects', () => ({ moveWorkspaceProject: mocks.move }));

afterEach(() => {
  localStorage.clear(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

function fixture(initiallyAttributed: boolean) {
  const personal = workspaceContextFixture({ workspaceId: 'personal', workspaceMemberId: 'personal-me', isDefaultTeam: true });
  const team = workspaceContextFixture({ workspaceId: 'team', workspaceMemberId: 'team-me' });
  const input = {
    sourceWorkspaceId: 'personal', sourceWorkspaceMemberId: 'personal-me',
    roots: [{ folderId: 'source-folder', folderName: 'Folder' }],
    action: 'to-team' as const, targetWorkspaceId: 'team', targetFolderId: null,
  };
  const folders: Array<{ folder_id: string; folder_pid: string | null }> = [];
  let location = { workspaceId: 'personal', folderId: 'source-folder' };
  let loseResponse = false;
  let movedElsewhere = false;
  let cleaned = false;
  const scopeRequests: Headers[] = [];
  mocks.directory.mockImplementation(async (id: string) => id === 'personal' ? personal : team);
  mocks.move.mockImplementation(async (move: { targetFolderId: string; workspaceContext: unknown }) => {
    expect(move.workspaceContext).toMatchObject({ workspaceId: 'personal', workspaceMemberId: 'personal-me' });
    location = { workspaceId: 'team', folderId: move.targetFolderId };
    if (loseResponse) throw new Error('response lost');
  });
  const json = (data: unknown) => Response.json({ code: 0, data });
  const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request), 'http://localhost');
    if (url.pathname.endsWith('/workspace-scope')) {
      const headers = new Headers(init?.headers);
      scopeRequests.push(headers);
      const current = location.workspaceId === 'personal' ? personal : team;
      const requested = headers.get('x-od-workspace-id');
      if (movedElsewhere || (requested && requested !== current.workspaceId)) return Response.json({}, { status: 403 });
      const context = requested ? current : {
        ...current,
        // A headerless scope falls back to persisted attribution, which can
        // be absent on legacy Personal projects or stale after a transfer.
        workspaceMemberId: initiallyAttributed && location.workspaceId === 'personal' ? 'personal-me' : 'local-user',
      };
      return Response.json({ scope: { kind: 'team', projectId: 'project', workspaceId: current.workspaceId, visibility: location.workspaceId === 'personal' ? 'personal' : 'team', context } });
    }
    if (url.pathname === '/api/hdw/api/folder/list') return json({ folders });
    if (url.pathname === '/api/hdw/api/folder/create') {
      folders.push(...JSON.parse(String(init?.body)).folders);
      return json(null);
    }
    if (url.pathname === '/api/hdw/api/folder/project/list') return json({ projects: location.workspaceId === 'team' && location.folderId === url.searchParams.get('folder_id') ? [{ project_id: 'project' }] : [] });
    if (url.pathname === '/api/folders/source-folder/projects') return json({ projects: location.workspaceId === 'personal' ? [{ id: 'project' }] : [] });
    if (url.pathname === '/api/folders') return json({ folders: [] });
    if (url.pathname.endsWith('/move-cleanup')) { cleaned = true; return json({ folder_id: 'source-folder' }); }
    if (url.pathname === '/api/folders/source-folder') return json({ folder_id: 'source-folder', folder_name: 'Folder', folder_pid: null, workspace_id: 'personal' });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { input, folders, fetchMock, scopeRequests, cleaned: () => cleaned, loseResponse: (value: boolean) => { loseResponse = value; }, moveElsewhere: () => { movedElsewhere = true; } };
}

describe('personal folder transfer with real project scope resolution', () => {
  it.each([false, true])('moves the full folder with exact membership (legacy attributed=%s)', async (attributed) => {
    const state = fixture(attributed);
    const result = await movePersonalFolderRoots(state.input);
    expect(result.failures).toEqual([]);
    expect(result.succeededFolderIds).toEqual(['source-folder']);
    expect(state.cleaned()).toBe(true);
    expect(state.scopeRequests.every((headers) => headers.has('x-od-workspace-member-id'))).toBe(true);
    expect(state.scopeRequests.at(-1)?.get('x-od-workspace-member-id')).toBe('team-me');
  });

  it('resumes a lost response in the original target without replaying the transfer', async () => {
    const state = fixture(false);
    state.loseResponse(true);
    expect((await movePersonalFolderRoots(state.input)).failures).toHaveLength(1);
    expect(state.cleaned()).toBe(false);
    state.loseResponse(false); mocks.move.mockClear();
    expect((await movePersonalFolderRoots(state.input)).succeededFolderIds).toEqual(['source-folder']);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(state.folders).toHaveLength(1);
    expect(state.cleaned()).toBe(true);
  });

  it('retains the source and recovery journal if neither recorded membership can read the project', async () => {
    const state = fixture(false);
    state.loseResponse(true);
    await movePersonalFolderRoots(state.input);
    state.moveElsewhere(); mocks.move.mockClear();
    expect((await movePersonalFolderRoots(state.input)).failures).toHaveLength(1);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(state.cleaned()).toBe(false);
    expect(localStorage.length).toBe(1);
  });
});
