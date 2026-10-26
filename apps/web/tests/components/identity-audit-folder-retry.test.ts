// @vitest-environment jsdom
// Red spec: the daemon resets folderId to null if transfer succeeds but the
// remote folder assignment fails. The retry must handle that actual response.
import { afterEach, expect, it, vi } from 'vitest';
import { movePersonalFolderRoots } from '../../src/components/personal-folder-move';
const mocks = vi.hoisted(() => ({ context: vi.fn(), scope: vi.fn(), move: vi.fn() }));
vi.mock('../../src/collab/useWorkspaceContext', () => ({
  resolveBoundProjectWorkspaceContext: mocks.context, currentWorkspaceAccountGeneration: () => 1,
}));
vi.mock('../../src/collab/useProjectWorkspaceScope', async (original) => ({
  ...await original<typeof import('../../src/collab/useProjectWorkspaceScope')>(), resolveProjectWorkspaceContext: mocks.scope,
}));
vi.mock('../../src/state/projects', () => ({ moveWorkspaceProject: mocks.move }));
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('resumes a personal folder move after the daemon leaves the transferred project at the team root', async () => {
  const contexts = {
    personal: { workspaceId: 'personal', workspaceMemberId: 'alice-personal', isDefaultTeam: true, permissions: { canShareProjects: true }, role: 'member', memberStatus: 'active', lifecycleState: 'active' },
    team: { workspaceId: 'team', workspaceMemberId: 'alice-team', isDefaultTeam: false, permissions: { canShareProjects: true }, role: 'member', memberStatus: 'active', lifecycleState: 'active' },
  };
  let location: keyof typeof contexts = 'personal';
  let folderId: string | null = 'source-folder';
  const targets: Array<{ folder_id: string; folder_name: string; folder_pid: string | null }> = [];
  let cleaned = false;
  const ok = (data: unknown) => Response.json({ code: 0, data });
  mocks.context.mockImplementation(async (id: keyof typeof contexts) => contexts[id]);
  mocks.scope.mockImplementation(async () => contexts[location]);
  mocks.move.mockImplementationOnce(async () => {
    location = 'team'; folderId = null;
    throw new Error('TEAM_PROJECT_SYNC_FAILED');
  }).mockImplementation(async (input: { targetFolderId: string }) => { folderId = input.targetFolderId; });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/folders/source-folder') return ok({ folder_id: 'source-folder', folder_name: 'Source', folder_pid: null, workspace_id: 'personal' });
    if (url.pathname === '/api/folders/source-folder/projects') return ok({ projects: location === 'personal' ? [{ id: 'p' }] : [] });
    if (url.pathname === '/api/folders') return ok({ folders: [] });
    if (url.pathname === '/api/hdw/api/folder/list') return ok({ folders: targets });
    if (url.pathname === '/api/hdw/api/folder/create') { targets.push(...JSON.parse(String(init?.body)).folders); return ok({}); }
    if (url.pathname === '/api/hdw/api/folder/project/list') return ok({ projects: folderId === url.searchParams.get('folder_id') ? [{ project_id: 'p' }] : [] });
    if (url.pathname === '/api/projects/p') return Response.json({ project: { id: 'p', workspaceId: location }, folderId });
    if (url.pathname === '/api/hdw/api/folder/project/move') { folderId = JSON.parse(String(init?.body)).folder_id; return ok({}); }
    if (url.pathname.endsWith('/move-cleanup')) { cleaned = true; return ok({}); }
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  }));
  const input = { sourceWorkspaceId: 'personal', sourceWorkspaceMemberId: 'alice-personal', roots: [{ folderId: 'source-folder', folderName: 'Source' }], action: 'to-team' as const, targetWorkspaceId: 'team', targetFolderId: null };
  expect((await movePersonalFolderRoots(input)).failures).toHaveLength(1);
  expect(location).toBe('team');
  expect(folderId).toBeNull();
  expect((await movePersonalFolderRoots(input)).succeededFolderIds).toEqual(['source-folder']);
  expect(cleaned).toBe(true);
});
