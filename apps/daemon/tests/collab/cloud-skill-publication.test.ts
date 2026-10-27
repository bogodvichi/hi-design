import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHdwCloudClient } from '../../src/integrations/hdw-cloud.js';
import { createTeamResourceShareService, type TeamResourceRequestScope } from '../../src/collab/team-resource-share.js';
import { registerTeamResourceShareRoutes } from '../../src/routes/team-resource-share.js';

const scope: TeamResourceRequestScope = {
  principal: { teamId: 'team-a', memberId: 'member-a', role: 'owner', lifecycleState: 'active' },
  canShare: true,
};
const resourceId = 'skill-team-a-requirement-analysis';
let server: http.Server;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function fixture(options: {
  owner?: string; kind?: string; missing?: boolean;
  snapshotMissing?: boolean; updateCode?: number; canShare?: boolean;
} = {}) {
  const updates: Array<{ path: string; body: Record<string, unknown> }> = [];
  const manifest = { entries: [{ path: 'SKILL.md', digest: 'source-digest', size: 15 }] };
  const cloudFetch = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    if (method === 'GET' && path.endsWith('/resources/' + resourceId)) {
      if (options.missing) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
      return Response.json({
        id: resourceId, kind: options.kind ?? 'skill', ownerMemberId: options.owner ?? 'member-a',
        scope: null, metadata: { localId: 'requirement-analysis', title: 'Requirement analysis', preserved: true },
        version: 3,
      });
    }
    if (method === 'POST' && path.endsWith('/resources/' + resourceId + '/materialize')) {
      if (options.snapshotMissing) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
      return Response.json({ version: 3, versionId: 'source-v3', manifest, missingBlobs: [] });
    }
    if (method === 'PUT' && /\/resources\/community-skill-[^/]+\/versions$/u.test(path)) {
      updates.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      if (options.updateCode === -1) return Response.json({ error: 'UPSTREAM_ERROR' }, { status: 500 });
      return Response.json({ version: 1, versionId: 'publication-v1', missingBlobs: [] });
    }
    throw new Error('Unexpected HDW request: ' + method + ' ' + path);
  });
  const resolveDir = vi.fn(() => { throw new Error('cloud-only Skill has no local directory'); });
  const share = createTeamResourceShareService({
    kind: 'skill', idPrefix: 'skill', resolveDir,
    hdwClient: createHdwCloudClient({
      config: { baseUrl: 'https://cloud.example', pathPrefix: '/hdw', token: 'test-token' }, fetch: cloudFetch,
    }),
    env: {},
  });
  const app = express();
  app.use(express.json());
  registerTeamResourceShareRoutes(app, { basePath: 'skills', share, authorizeShare: () => false,
    resolveScope: async () => ({ ok: true, scope: { ...scope, canShare: options.canShare ?? true } }) });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address() as { port: number };
  return { updates, cloudFetch, resolveDir, manifest,
    publish: (query = '?scope=public', body: unknown = { category: 'data_analysis', logoKey: 'research' }) =>
      fetch(`http://127.0.0.1:${address.port}/api/workspace/skills/${resourceId}/share${query}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
  };
}

describe('publishing an existing cloud Skill to the community', () => {
  it('publishes a separate community snapshot while leaving the cloud Skill source unchanged', async () => {
    const f = await fixture();
    const response = await f.publish();
    expect(response.status).toBe(200);
    const result = await response.json() as { shared: boolean; version: number; resourceId: string };
    expect(result).toMatchObject({ shared: true, version: 1 });
    expect(result.resourceId).toMatch(/^community-skill-/u);
    expect(f.resolveDir).not.toHaveBeenCalled();
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]).toMatchObject({
      path: expect.stringMatching(/\/resources\/community-skill-[^/]+\/versions$/u),
      body: {
        kind: 'skill', scope: 'public', ownerMemberId: 'member-a', manifest: f.manifest,
        metadata: {
          localId: 'requirement-analysis', title: 'Requirement analysis', preserved: true,
          category: 'data_analysis', logoKey: 'research',
          communitySourceResourceId: resourceId, communitySourceWorkspaceId: 'team-a',
          publicationSourceType: 'reference',
        },
      },
    });
    expect(f.cloudFetch.mock.calls.filter(([url, init]) =>
      init?.method === 'PUT' && String(url).endsWith('/resources/' + resourceId))).toHaveLength(0);
  });

  it('returns a safe 409 without creating a community resource when the source snapshot is missing', async () => {
    const f = await fixture({ snapshotMissing: true });
    const response = await f.publish();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'SOURCE_SKILL_SNAPSHOT_INCOMPLETE' });
    expect(f.updates).toHaveLength(0);
  });

  it.each([{ owner: 'someone-else' }, { kind: 'plugin' }, { canShare: false }])('rejects unauthorized publication %j', async (options) => {
    const f = await fixture(options);
    expect((await f.publish()).status).toBe(403);
    expect(f.updates).toEqual([]);
  });

  it('requires a category before publishing', async () => {
    const f = await fixture();
    expect((await f.publish('?scope=public', {})).status).toBe(400);
    expect(f.updates).toEqual([]);
  });

  it('keeps the local personal-resource authorization for normal team sharing', async () => {
    const f = await fixture();
    expect((await f.publish('')).status).toBe(403);
    expect(f.updates).toEqual([]);
  });

  it.each([{ missing: true }, { updateCode: -1 }])('reports cloud publication failures instead of success %j', async (options) => {
    const f = await fixture(options);
    const response = await f.publish();
    expect(response.ok).toBe(false);
    expect(await response.json()).not.toMatchObject({ shared: true });
  });
});
