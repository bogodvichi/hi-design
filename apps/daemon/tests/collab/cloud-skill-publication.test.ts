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

async function fixture(options: { owner?: string; kind?: string; missing?: boolean; updateCode?: number; canShare?: boolean } = {}) {
  const updates: unknown[] = [];
  const cloudFetch = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === 'PUT') {
      updates.push(JSON.parse(String(init.body)));
      return Response.json({ code: options.updateCode ?? 0, msg: 'update result' });
    }
    if (options.missing) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    return Response.json({ id: resourceId, kind: options.kind ?? 'skill', ownerMemberId: options.owner ?? 'member-a',
      metadata: { localId: 'requirement-analysis', title: 'Requirement analysis', preserved: true }, version: 3 });
  });
  const resolveDir = vi.fn(() => { throw new Error('cloud-only Skill has no local directory'); });
  const share = createTeamResourceShareService({
    kind: 'skill', idPrefix: 'skill', resolveDir,
    hdwClient: createHdwCloudClient({ config: { baseUrl: 'https://cloud.example', pathPrefix: '/hdw', token: 'test-token' }, fetch: cloudFetch }),
    env: {},
  });
  const app = express();
  app.use(express.json());
  registerTeamResourceShareRoutes(app, { basePath: 'skills', share, authorizeShare: () => false,
    resolveScope: async () => ({ ok: true, scope: { ...scope, canShare: options.canShare ?? true } }) });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address() as { port: number };
  return { updates, cloudFetch, resolveDir,
    publish: (query = '?scope=public', body: unknown = { category: 'data_analysis', logoKey: 'research' }) =>
      fetch(`http://127.0.0.1:${address.port}/api/workspace/skills/${resourceId}/share${query}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
  };
}

describe('publishing an existing cloud Skill to the community', () => {
  it('publishes the owned cloud resource without requiring a local personal binding or uploading its files again', async () => {
    const f = await fixture();
    const response = await f.publish();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ shared: true, version: 3 });
    expect(f.resolveDir).not.toHaveBeenCalled();
    expect(f.updates).toEqual([{ scope: 'public', metadata: { localId: 'requirement-analysis', title: 'Requirement analysis', preserved: true,
      category: 'data_analysis', logoKey: 'research' } }]);
    expect(f.cloudFetch.mock.calls[1]?.[0].toString()).toBe(`https://cloud.example/hdw/api/workspaces/team-a/resources/${resourceId}`);
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
