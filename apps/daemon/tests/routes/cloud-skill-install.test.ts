import type { TeamSkillCatalogResponse } from '@open-design/contracts';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startServer, type StartServerResult } from '../../src/server.js';
import { ensureWorkspaceResource, openDatabase } from '../../src/db.js';
import { teamResourceMaterializationDir } from '../../src/collab/team-resource-materialization.js';
import type { TeamResourceRequestScope } from '../../src/collab/team-resource-share.js';
import type { WorkspaceTeamResourceRefreshInput, WorkspaceTeamResourceRefreshResult } from '../../src/collab/workspace-resources-reconciler.js';

const remote = vi.hoisted(() => ({
  getResource: vi.fn(), pullResource: vi.fn(), downloadBlob: vi.fn(), listResources: vi.fn(),
  refreshTeam: undefined as undefined | ((input: WorkspaceTeamResourceRefreshInput<TeamResourceRequestScope>) => Promise<WorkspaceTeamResourceRefreshResult>),
}));
vi.mock('../../src/collab/workspace-resources-reconciler.js', async (original) => {
  const actual = await original<typeof import('../../src/collab/workspace-resources-reconciler.js')>();
  return { ...actual, createWorkspaceTeamResourceEventCoordinator: (deps: Parameters<typeof actual.createWorkspaceTeamResourceEventCoordinator<TeamResourceRequestScope>>[0]) => {
    const coordinator = actual.createWorkspaceTeamResourceEventCoordinator(deps);
    remote.refreshTeam = (input) => coordinator.refresh(input);
    return coordinator;
  } };
});
vi.mock('../../src/http/hdw.js', async (original) => ({
  ...await original<typeof import('../../src/http/hdw.js')>(),
  fetchHdwTeams: async () => [{ workspace_id: 'test-team', workspace_member_id: 'owner', role: 'owner' }],
  fetchSharedSpaceInfo: async () => ({ workspace_id: 'test-personal', workspace_member_id: 'owner' }),
  fetchHdwMarketplaceManifestText: async () => '',
}));
vi.mock('../../src/integrations/hdw-cloud.js', async (original) => ({
  ...await original<typeof import('../../src/integrations/hdw-cloud.js')>(),
  createHdwCloudClientFromEnv: () => ({ ...remote, getTeamProject: async () => null }),
}));

let runtime: StartServerResult;
let skillId: string;
let root: string;
const headers = {
  'x-od-workspace-id': 'test-personal', 'x-od-workspace-member-id': 'owner', 'x-od-workspace-type': 'team',
};

beforeEach(async () => {
  vi.stubEnv('OD_DISABLE_AUTO_IMPORT', '1');
  vi.clearAllMocks();
  skillId = `skill-test-team-${crypto.randomUUID()}`;
  root = path.join(process.env.OD_DATA_DIR!, 'skills');
  remote.getResource.mockResolvedValue({ id: skillId, kind: 'skill', ownerMemberId: 'owner',
    metadata: { localId: skillId }, version: 1, versionId: 'same-version' });
  remote.pullResource.mockResolvedValue({ version: 1, versionId: 'same-version', missingBlobs: [],
    manifest: { entries: [{ path: 'SKILL.md', digest: 'remote-digest' }] } });
  remote.downloadBlob.mockResolvedValue(Buffer.from('---\nname: Remote Skill\n---\nRemote contents'));
  remote.listResources.mockResolvedValue([]);
  runtime = await startServer({ port: 0, returnServer: true }) as StartServerResult;
});

afterEach(async () => {
  await runtime?.shutdown();
  if (runtime?.server.listening) await new Promise<void>(resolve => runtime.server.close(() => resolve()));
  vi.unstubAllEnvs();
});

async function install() {
  return fetch(`${runtime.url}/api/workspace/skills/cloud/${skillId}/install`, { method: 'POST', headers });
}

it.each(['test-personal', 'test-team'])('downloads the remote Skill in %s even when the owner has a local source', async (workspaceId) => {
  headers['x-od-workspace-id'] = workspaceId;
  const localDir = path.join(root, skillId);
  await mkdir(localDir, { recursive: true });
  await writeFile(path.join(localDir, 'SKILL.md'), 'Local author contents');
  ensureWorkspaceResource(openDatabase(process.cwd(), { dataDir: process.env.OD_DATA_DIR! }), 'skill', workspaceId, skillId, {
    visibility: 'personal', resourceState: 'active', createdByWorkspaceMemberId: 'owner',
  });
  const response = await install();
  expect(response.status).toBe(200);
  expect(remote.pullResource).toHaveBeenCalledWith(workspaceId, skillId, 'published');
  expect(remote.downloadBlob).toHaveBeenCalledWith(workspaceId, 'remote-digest');
  const target = teamResourceMaterializationDir(root, workspaceId, skillId, skillId);
  expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toContain('Remote contents');
  expect(await readFile(path.join(localDir, 'SKILL.md'), 'utf8')).toBe('Local author contents');
});

it.each(['test-personal', 'test-team'])('reads the remote Skill in %s on repeated adds and preserves the installed copy if the remote read fails', async (workspaceId) => {
  headers['x-od-workspace-id'] = workspaceId;
  expect((await install()).status).toBe(200);
  remote.pullResource.mockRejectedValue(new Error('remote snapshot unavailable'));
  const response = await install();
  expect(response.status).toBe(500);
  expect(remote.pullResource).toHaveBeenCalledTimes(2);
  const target = teamResourceMaterializationDir(root, workspaceId, skillId, skillId);
  expect(existsSync(target)).toBe(true);
  expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toContain('Remote contents');
});

it('lists team cloud resources without adding them, and reports explicit install/uninstall accurately', async () => {
  headers['x-od-workspace-id'] = 'test-team';
  const localId = `review-${crypto.randomUUID()}`;
  const cloud = { id: skillId, kind: 'skill', ownerMemberId: 'teammate',
    metadata: { localId, title: 'Shared review' }, version: 1, versionId: 'same-version' };
  remote.listResources.mockResolvedValue([cloud]);
  remote.getResource.mockResolvedValue(cloud);
  remote.downloadBlob.mockResolvedValue(Buffer.from(`---\nname: ${localId}\n---\nRemote contents`));
  const catalog = async () => {
    const response = await fetch(`${runtime.url}/api/workspace/skills/team`, { headers });
    expect(response.status).toBe(200);
    return await response.json() as TeamSkillCatalogResponse;
  };
  const target = teamResourceMaterializationDir(root, 'test-team', localId, localId);
  const refresh = () => remote.refreshTeam!({ workspaceId: 'test-team', resourceKind: 'skill', reason: 'poll',
    scope: { principal: { teamId: 'test-team', memberId: 'owner', role: 'owner', lifecycleState: 'active', workspaceType: 'team' }, canShare: true } });
  expect((await refresh()).failedKinds).toEqual([]);
  expect((await catalog()).resources).toMatchObject([{ resourceId: skillId,
    installation: { status: 'not_installed', versionId: null } }]);
  expect(remote.pullResource).not.toHaveBeenCalled();
  expect(existsSync(target)).toBe(false);
  expect((await install()).status).toBe(200);
  expect((await catalog()).resources).toMatchObject([{ resourceId: skillId,
    installation: { status: 'installed', versionId: 'same-version' } }]);
  remote.listResources.mockResolvedValue([{ ...cloud, version: 2, versionId: 'new-version' }]);
  expect((await refresh()).failedKinds).toEqual([]);
  expect((await catalog()).resources).toMatchObject([{ versionId: 'new-version',
    installation: { status: 'installed', versionId: 'same-version' } }]);
  expect((await fetch(`${runtime.url}/api/workspace/skills/cloud/${skillId}/uninstall`,
    { method: 'DELETE', headers })).status).toBe(200);
  expect((await refresh()).failedKinds).toEqual([]);
  expect((await catalog()).resources).toMatchObject([{ resourceId: skillId,
    installation: { status: 'not_installed', versionId: null } }]);
  expect(remote.pullResource).toHaveBeenCalledTimes(1);
  expect(existsSync(target)).toBe(false);
});

it('includes Skills with opaque cloud IDs and excludes community publication copies', async () => {
  headers['x-od-workspace-id'] = 'test-team';
  remote.listResources.mockResolvedValue([
    { id: 'opaque-cloud-id', kind: 'skill', ownerMemberId: 'teammate', metadata: { localId: 'review', title: 'Review' } },
    { id: 'publication-copy', kind: 'skill', metadata: { communitySourceResourceId: 'opaque-cloud-id', title: 'Published' } },
  ]);
  const response = await fetch(`${runtime.url}/api/workspace/skills/team`, { headers });
  expect(response.status).toBe(200);
  const body = await response.json() as TeamSkillCatalogResponse;
  expect(body.resources).toHaveLength(1);
  expect(body.resources[0]).toMatchObject({ resourceId: 'opaque-cloud-id', localId: 'review', title: 'Review' });
  expect(remote.pullResource).not.toHaveBeenCalled();
});
