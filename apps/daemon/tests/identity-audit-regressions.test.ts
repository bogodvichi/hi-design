// Red specs for the identity audit. All cloud writes are mocked; SQLite and
// MCP configuration use disposable directories. No user data is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCollabRuntime, type CollabRuntime } from '../src/collab/runtime.js';
import { createTeamResourceShareService } from '../src/collab/team-resource-share.js';
import { createHdwHttpResourceAdapter } from '../src/collab/hdw-http-resource-adapter.js';
import { createHdwHttpTeamProjectCatalog } from '../src/collab/hdw-http-team-projects.js';
import type { HdwCloudClient } from '../src/integrations/hdw-cloud.js';
import type { ResourceHubPrincipal } from '../src/collab/resource-principal.js';
import { registerMcpRoutes, type RegisterMcpRoutesDeps } from '../src/mcp-routes.js';
import { registerCollabContextHideSignRoutes } from '../src/routes/collab-context-hidesign.js';
import { registerFolderRoutes } from '../src/routes/folders.js';
import { readMcpConfig, writeMcpConfig } from '../src/mcp-config.js';
import { getToken, setToken } from '../src/mcp-tokens.js';
import { closeDatabase, createWorkspaceFolder, ensureWorkspaceProject, insertProject, openDatabase } from '../src/db.js';

const hdw = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), delete: vi.fn(), folders: vi.fn(), grants: vi.fn(), shares: vi.fn() }));
vi.mock('../src/http/hdw.js', async (original) => ({
  ...await original<typeof import('../src/http/hdw.js')>(),
  hdwPost: hdw.post, hdwPut: hdw.put, hdwDelete: hdw.delete,
  fetchSharedSpaceInfo: async () => ({ workspace_id: 'shared', workspace_member_id: 'alice-shared' }),
  fetchHdwTeams: async () => [],
  createHdwFolders: hdw.folders, createHdwFolderShares: hdw.grants, shareFolderProjectsToSharedSpace: hdw.shares,
}));
vi.mock('../src/http/hik_logins/hicoo.js', () => ({
  readSsoConfigFile: () => ({ username: 'alice', cookies: [] }), readSsoUsername: () => 'alice',
}));

type Handler = (req: any, res: any) => unknown;
function router() {
  const handlers = new Map<string, Handler>();
  const app = Object.fromEntries(['get', 'post', 'put', 'delete', 'patch'].map((method) => [method,
    (url: string, ...callbacks: Handler[]) => handlers.set(`${method} ${url}`, callbacks.at(-1)!),
  ])) as unknown as Express;
  return { app, async call(method: string, url: string, req: Record<string, unknown>) {
    const res = { statusCode: 200, body: null as any,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
    };
    await handlers.get(`${method} ${url}`)!({ headers: {}, query: {}, params: {}, body: {}, ...req }, res);
    return res;
  } };
}

let dir: string;
const runtimes: CollabRuntime[] = [];
const principal: ResourceHubPrincipal = { teamId: 'source', memberId: 'alice-source', role: 'member', lifecycleState: 'active', workspaceType: 'team' };
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'od-identity-audit-'));
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Audit tests forbid real network access'); }));
  hdw.folders.mockResolvedValue({ created: 1 });
  hdw.grants.mockResolvedValue({ created: 1 });
  hdw.shares.mockResolvedValue({ shared: 1 });
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  vi.unstubAllGlobals();
  closeDatabase(); rmSync(dir, { recursive: true, force: true });
});

describe('identity audit safety invariants', () => {
  it('includes owned cloud projects in the personal root without importing recipient mirrors or duplicating folders', async () => {
    const db = openDatabase(dir, { dataDir: dir });
    const folder = createWorkspaceFolder(db, { workspaceId: 'shared', folderName: 'Local folder', folderPid: null, ownerMemberId: 'alice' });
    insertProject(db, { id: 'nested', name: 'Nested project', createdAt: 1, updatedAt: 1 });
    ensureWorkspaceProject(db, { projectId: 'nested', workspaceId: 'shared', folderId: folder, createdByWorkspaceMemberId: 'alice' });
    const cloud = ['restored-owner', 'recipient-mirror', 'nested'].map((id) => ({
      projectId: id, name: id, ownerMemberId: id === 'recipient-mirror' ? 'bob' : 'alice', sharedAt: '2026-10-23T00:00:00Z', resourceId: `durable-${id}`,
    }));
    const r = router();
    registerFolderRoutes(r.app, { db, listCloudRootProjects: async () => cloud,
      http: { requireLocalDaemonRequest: (_req, _res, next) => next(), sendApiError: (res: any, status: number) => res.status(status).json({}) },
    });
    const response = await r.call('get', '/api/folders/:folderId/projects', {
      params: { folderId: 'root' }, query: { workspace_id: 'shared', personal_scope: '1' }, get: () => 'alice',
    });
    expect(response.body.data.projects.map((p: any) => p.id)).toEqual(['restored-owner']);
    expect(response.body.data.projects[0]).toMatchObject({ workspaceId: 'shared', createdByWorkspaceMemberId: 'alice', workspaceVisibility: 'team' });
  });

  it('keeps the source published when transfer and destination publishing fail', async () => {
    const unpublish = vi.fn(async () => {});
    const publish = vi.fn(async () => { throw new Error('destination unavailable'); });
    const runtime = createCollabRuntime({ adapter: {
      publish, unpublish, transferToWorkspace: async () => { throw new Error('transfer unavailable'); },
    } });
    runtimes.push(runtime);
    const target = { ...principal, teamId: 'target', memberId: 'alice-target' };
    await expect(runtime.requestTeamTransfer('p', 'source', 'target', target)).rejects.toThrow();
    expect(unpublish).not.toHaveBeenCalled();
  });

  it('clears source ownership after a successful transfer with the route supplied target principal', async () => {
    const runtime = createCollabRuntime({ adapter: {
      publish: async () => ({ version: 1 }),
      transferToWorkspace: async () => ({ version: 2, targetOwnerMemberId: 'alice-target' }),
    } });
    runtimes.push(runtime);
    runtime.rememberTeamShare('p', principal, 'synced');
    await runtime.requestTeamTransfer('p', 'source', 'target', { ...principal, teamId: 'target', memberId: 'alice-target' });
    expect(runtime.projectOwnerMemberId('p', principal)).toBeNull();
    expect(runtime.projectSyncState('p', principal)).toBe('local_only');
  });

  it('keeps the cloud transferred resource ID when refreshing the destination catalog', async () => {
    const upsert = vi.fn(async (_workspace: string, _project: string, _body: unknown) => {});
    const client = {
      transferProject: async () => ({ resourceId: 'project-transfer-from-server', version: 2, versionId: 'version-2', targetOwnerMemberId: 'alice-target' }),
      upsertTeamProject: upsert,
      getTeamProject: async () => ({ resourceId: 'project-transfer-from-server' }),
    } as unknown as HdwCloudClient;
    const runtime = createCollabRuntime({
      adapter: createHdwHttpResourceAdapter({ resolveProjectDir: () => dir, hasTeamIdentity: () => true, client }),
      teamProjectCatalog: createHdwHttpTeamProjectCatalog(client),
    });
    runtimes.push(runtime);
    await runtime.requestTeamTransfer('p', 'source', 'target', { ...principal, teamId: 'target', memberId: 'alice-target' });
    expect(upsert).toHaveBeenCalledWith('target', 'p', expect.objectContaining({ resourceId: 'project-transfer-from-server' }));
  });

  it('does not let a queued source publish resurrect a transferred project', async () => {
    const publish = vi.fn(async () => ({ version: 2 }));
    const runtime = createCollabRuntime({ adapter: { publish,
      transferToWorkspace: async () => ({ version: 1, targetOwnerMemberId: 'alice-target' }),
    } });
    runtimes.push(runtime);
    runtime.rememberTeamShare('p', principal, 'synced');
    await runtime.requestTeamTransfer('p', 'source', 'target', { ...principal, teamId: 'target', memberId: 'alice-target' });
    runtime.scheduler.runBoundary('p', principal);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(publish).not.toHaveBeenCalled();
    expect(runtime.projectOwnerMemberId('p', principal)).toBeNull();
  });

  it('uses the transferred resource for later publish and unpublish operations', async () => {
    const publish = vi.fn(async () => ({ version: 3, versionId: 'v3', missingBlobs: [] }));
    const remove = vi.fn(async () => {});
    const adapter = createHdwHttpResourceAdapter({ resolveProjectDir: () => dir, hasTeamIdentity: () => true,
      client: { getTeamProject: async () => ({ resourceId: 'transferred' }), publishResource: publish, removeResource: remove } as unknown as HdwCloudClient,
    });
    await adapter.publish({ projectId: 'p', principal, reason: 'save' });
    await adapter.unpublish!({ projectId: 'p', principal });
    expect(publish).toHaveBeenCalledWith('source', 'transferred', expect.objectContaining({ ownerMemberId: 'alice-source' }));
    expect(remove).toHaveBeenCalledWith('source', 'transferred');
  });

  it('does not publish another member personal projects through folder sharing', async () => {
    const db = openDatabase(dir, { dataDir: dir });
    const folder = createWorkspaceFolder(db, { workspaceId: 'shared', folderName: 'Bob folder', folderPid: null, ownerMemberId: 'bob-shared' });
    insertProject(db, { id: 'bob-project', name: 'Bob project', createdAt: 1, updatedAt: 1 });
    ensureWorkspaceProject(db, { projectId: 'bob-project', workspaceId: 'shared', folderId: folder, createdByWorkspaceMemberId: 'bob-shared' });
    const publish = vi.fn(async () => ({ version: 1 }));
    const r = router();
    registerCollabContextHideSignRoutes(r.app, { db, dataDir: dir, requestTeamShare: publish });
    const res = await r.call('post', '/api/shared-space/share-folder', { body: {
      folder_id: folder, workspace_id: 'shared', home_workspace_id: 'shared', recipients: [{ username: 'recipient' }],
    } });
    expect({ status: res.statusCode, published: publish.mock.calls.length }).toEqual({ status: 403, published: 0 });
  });

  it('reports failure when neither folder grants nor project grants were persisted', async () => {
    hdw.grants.mockResolvedValue(null); hdw.shares.mockResolvedValue(null);
    const db = openDatabase(dir, { dataDir: dir });
    const folder = createWorkspaceFolder(db, { workspaceId: 'shared', folderName: 'Alice folder', folderPid: null, ownerMemberId: 'alice-shared' });
    insertProject(db, { id: 'p', name: 'P', createdAt: 1, updatedAt: 1 });
    ensureWorkspaceProject(db, { projectId: 'p', workspaceId: 'shared', folderId: folder, createdByWorkspaceMemberId: 'alice-shared' });
    const r = router();
    registerCollabContextHideSignRoutes(r.app, { db, dataDir: dir, requestTeamShare: async () => ({ version: 1 }) });
    const res = await r.call('post', '/api/shared-space/share-folder', { body: {
      folder_id: folder, workspace_id: 'shared', home_workspace_id: 'shared', recipients: [{ username: 'recipient' }],
    } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('does not return personal projects when the folder read lacks a verified member', async () => {
    const db = openDatabase(dir, { dataDir: dir });
    insertProject(db, { id: 'bob-project', name: 'Bob private', createdAt: 1, updatedAt: 1 });
    ensureWorkspaceProject(db, { projectId: 'bob-project', workspaceId: 'shared', createdByWorkspaceMemberId: 'bob-shared' });
    const r = router();
    registerFolderRoutes(r.app, { db, http: { requireLocalDaemonRequest: (_req, _res, next) => next(), sendApiError: (res, status, code) => res.status(status).json({ code }) } });
    const res = await r.call('get', '/api/folders/:folderId/projects', { params: { folderId: 'root' }, query: { workspace_id: 'shared' }, get: () => undefined });
    expect(res.body.data?.projects ?? []).toEqual([]);
  });

  it('gives two members distinct cloud Skill IDs for the same personal slug', async () => {
    writeFileSync(path.join(dir, 'SKILL.md'), '# Same slug');
    const publish = vi.fn(async (_workspaceId: string, _resourceId: string, _input: unknown) => ({ version: 1, missingBlobs: [] }));
    const service = createTeamResourceShareService({ kind: 'skill', idPrefix: 'skill', resolveDir: () => dir,
      hdwClient: { getResource: async () => null, publishResource: publish } as unknown as HdwCloudClient, env: { OD_WORKSPACE_CONTEXT_SOURCE: 'hidesign' },
    });
    await service.share('same-slug', { principal: { ...principal, teamId: 'shared', memberId: 'alice' }, canShare: true });
    await service.share('same-slug', { principal: { ...principal, teamId: 'shared', memberId: 'bob' }, canShare: true });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0]?.[1]).not.toBe(publish.mock.calls[1]?.[1]);
  });

  function mcpFixture(authorized = false, teamId = 'shared', memberId = 'alice', owner = 'bob') {
    const r = router();
    const resolveScope = vi.fn(async () => authorized
      ? { ok: true, scope: { principal: { ...principal, teamId, memberId }, canShare: true } }
      : { ok: false, status: 403, code: 'WORKSPACE_ACCESS_DENIED' });
    const getResource = vi.fn(async (_workspace: string, id: string) => ({ id, ownerMemberId: owner, scope: 'public', metadata: {
      id: 'same-slug', label: 'Different MCP', transport: 'http', url: 'https://different.invalid/mcp',
    } }));
    registerMcpRoutes(r.app, {
      http: { isLocalSameOrigin: () => true, resolvedPortRef: { current: 1 } },
      paths: { RUNTIME_DATA_DIR: dir, OD_BIN: '', PROJECTS_DIR: '' },
      mcp: { pendingAuth: new Map(), daemonUrlRef: { current: '' } },
      hdwClient: { getResource }, cloudResourceAccess: { resolveScope },
    } as unknown as RegisterMcpRoutesDeps);
    return { ...r, resolveScope };
  }

  it('rejects MCP deletion when the caller claims someone else member ID', async () => {
    hdw.delete.mockResolvedValue({ ok: true });
    const r = mcpFixture();
    const res = await r.call('delete', '/api/workspace/mcp/cloud/:resourceId', { params: { resourceId: 'bob-resource' },
      headers: { 'x-od-workspace-id': 'shared', 'x-od-workspace-member-id': 'bob' },
    });
    expect({ status: res.statusCode, writes: hdw.delete.mock.calls.length }).toEqual({ status: 403, writes: 0 });
  });

  it('strips credential placeholders before public MCP creation', async () => {
    hdw.post.mockResolvedValue({ resource: { id: 'new', metadata: {} } });
    const r = mcpFixture(true);
    await r.call('post', '/api/workspace/mcp/cloud', { headers: { 'x-od-workspace-id': 'shared', 'x-od-workspace-member-id': 'alice' },
      body: { scope: 'public', template: { id: 'mcp', label: 'MCP', transport: 'http', url: 'https://mcp.invalid', headerFields: [
        { key: 'Authorization', placeholder: 'audit-fake-secret', secret: false },
      ] } },
    });
    expect(hdw.post).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(hdw.post.mock.calls)).not.toContain('audit-fake-secret');
  });

  it('does not uninstall a different MCP with the same slug in another workspace', async () => {
    await writeMcpConfig(dir, { servers: [{ id: 'same-slug', templateId: 'same-slug', label: 'Original', transport: 'http', url: 'https://original.invalid/mcp', enabled: true, workspaceId: 'first-team', ownerMemberId: 'alice' }] });
    const r = mcpFixture(true, 'second-team', 'bob');
    const res = await r.call('delete', '/api/workspace/mcp/cloud/:resourceId/uninstall', { params: { resourceId: 'unrelated-resource' },
      headers: { 'x-od-workspace-id': 'second-team', 'x-od-workspace-member-id': 'bob' },
    });
    expect(res.statusCode).toBe(200);
    expect((await readMcpConfig(dir)).servers.map((s) => s.id)).toContain('same-slug');
  });

  it('removes the exact local MCP and token after permanent cloud deletion', async () => {
    await writeMcpConfig(dir, { servers: [
      {
        id: 'cloud-resource', templateId: 'same-slug', label: 'Installed', transport: 'http',
        url: 'https://installed.invalid/mcp', enabled: true, authMode: 'oauth',
        cloudResourceId: 'cloud-resource', cloudHomeWorkspaceId: 'shared',
        workspaceId: 'shared', ownerMemberId: 'alice',
      },
      {
        id: 'other-workspace-same-slug', templateId: 'same-slug', label: 'Other workspace',
        transport: 'http', url: 'https://other.invalid/mcp', enabled: true,
        cloudResourceId: 'cloud-resource', cloudHomeWorkspaceId: 'first-team',
        workspaceId: 'first-team', ownerMemberId: 'alice',
      },
      {
        id: 'unrelated', templateId: 'unrelated', label: 'Unrelated', transport: 'http',
        url: 'https://unrelated.invalid/mcp', enabled: true,
        cloudResourceId: 'other-resource', cloudHomeWorkspaceId: 'shared',
        workspaceId: 'shared', ownerMemberId: 'alice',
      },
    ] });
    await setToken(dir, 'cloud-resource', {
      accessToken: 'audit-fake-access-token', tokenType: 'Bearer', savedAt: 1,
    });
    await setToken(dir, 'unrelated', {
      accessToken: 'audit-fake-kept-token', tokenType: 'Bearer', savedAt: 1,
    });
    hdw.delete.mockResolvedValue({ ok: true });
    const r = mcpFixture(true, 'shared', 'alice', 'alice');
    const res = await r.call('delete', '/api/workspace/mcp/cloud/:resourceId', {
      params: { resourceId: 'cloud-resource' },
      headers: { 'x-od-workspace-id': 'shared', 'x-od-workspace-member-id': 'alice' },
    });

    expect(res.statusCode).toBe(200);
    expect((await readMcpConfig(dir)).servers.map((server) => server.id)).toEqual([
      'other-workspace-same-slug',
      'unrelated',
    ]);
    await expect(getToken(dir, 'cloud-resource')).resolves.toBeNull();
    await expect(getToken(dir, 'unrelated')).resolves.toMatchObject({
      accessToken: 'audit-fake-kept-token',
    });
  });

  it('preserves the local MCP when a legacy community publication is retracted', async () => {
    await writeMcpConfig(dir, { servers: [{
      id: 'cloud-resource', templateId: 'same-slug', label: 'Installed', transport: 'http',
      url: 'https://installed.invalid/mcp', enabled: true,
      cloudResourceId: 'cloud-resource', cloudHomeWorkspaceId: 'shared',
      workspaceId: 'shared', ownerMemberId: 'alice',
    }] });
    await setToken(dir, 'cloud-resource', {
      accessToken: 'audit-fake-access-token', tokenType: 'Bearer', savedAt: 1,
    });
    hdw.put.mockResolvedValue({ ok: true });
    const r = mcpFixture(true, 'shared', 'alice', 'alice');
    const res = await r.call('delete', '/api/workspace/mcp/cloud/:resourceId', {
      params: { resourceId: 'cloud-resource' },
      query: { community: '1' },
      headers: { 'x-od-workspace-id': 'shared', 'x-od-workspace-member-id': 'alice' },
    });

    expect(res.body).toEqual({ ok: true, originalPreserved: true });
    expect(hdw.delete).not.toHaveBeenCalled();
    expect((await readMcpConfig(dir)).servers.map((server) => server.id)).toEqual(['cloud-resource']);
    await expect(getToken(dir, 'cloud-resource')).resolves.toMatchObject({
      accessToken: 'audit-fake-access-token',
    });
  });
});
