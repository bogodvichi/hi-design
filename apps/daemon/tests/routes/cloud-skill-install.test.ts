import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startServer, type StartServerResult } from '../../src/server.js';
import { ensureWorkspaceResource, openDatabase } from '../../src/db.js';
import { teamResourceMaterializationDir } from '../../src/collab/team-resource-materialization.js';

const remote = vi.hoisted(() => ({
  getResource: vi.fn(), pullResource: vi.fn(), downloadBlob: vi.fn(),
}));
vi.mock('../../src/http/hdw.js', async (original) => ({
  ...await original<typeof import('../../src/http/hdw.js')>(),
  fetchHdwTeams: async () => [{ workspace_id: 'test-team', workspace_member_id: 'owner', role: 'owner' }],
  fetchSharedSpaceInfo: async () => ({ workspace_id: 'test-personal', workspace_member_id: 'owner' }),
  fetchHdwMarketplaceManifestText: async () => '',
}));
vi.mock('../../src/integrations/hdw-cloud.js', async (original) => ({
  ...await original<typeof import('../../src/integrations/hdw-cloud.js')>(),
  createHdwCloudClientFromEnv: () => ({ ...remote, listResources: async () => [], getTeamProject: async () => null }),
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
  skillId = `remote-skill-${crypto.randomUUID()}`;
  root = path.join(process.env.OD_DATA_DIR!, 'skills');
  remote.getResource.mockResolvedValue({ id: skillId, kind: 'skill', ownerMemberId: 'owner',
    metadata: { localId: skillId }, version: 1, versionId: 'same-version' });
  remote.pullResource.mockResolvedValue({ version: 1, versionId: 'same-version', missingBlobs: [],
    manifest: { entries: [{ path: 'SKILL.md', digest: 'remote-digest' }] } });
  remote.downloadBlob.mockResolvedValue(Buffer.from('---\nname: Remote Skill\n---\nRemote contents'));
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
