import express from 'express';
import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMcpRoutes, type RegisterMcpRoutesDeps } from '../../src/mcp-routes.js';
import { createHdwCloudClient } from '../../src/integrations/hdw-cloud.js';
import { isLocalSameOrigin } from '../../src/origin-validation.js';

let server: http.Server;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

async function fixture(owner = 'team-member') {
  const cloudFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === 'POST' && url.pathname.endsWith('/resources')) {
      return Response.json({ code: 0, data: { resource: { id: 'mcp-copy' } } });
    }
    if (init?.method === 'PUT') throw new Error('publishing must never mutate the original MCP');
    const record = { id: 'mcp-team', kind: 'mcp', ownerMemberId: owner, version: null, metadata: {
      id: 'same-name', label: 'Team MCP', transport: 'http', category: 'utilities', url: 'https://mcp.example',
      headers: { Authorization: 'private-value' }, headerFields: [{ key: 'Authorization', placeholder: 'private-value', secret: true }],
    } };
    if (url.pathname.endsWith('/resources')) {
      if (url.pathname.includes('/personal/')) return Response.json({ resources: [] });
      return Response.json({ resources: [record] });
    }
    return Response.json(record);
  });
  const client = createHdwCloudClient({ config: { baseUrl: 'https://cloud.example', pathPrefix: '/hdw', token: 'test' }, fetch: cloudFetch });
  const directory = [
    { workspaceId: 'personal', workspaceMemberId: 'personal-member', workspaceName: 'Personal', workspaceType: 'team' as const, role: 'owner' as const, memberStatus: 'active' as const, lifecycleState: 'active' as const },
    { workspaceId: 'team', workspaceMemberId: 'team-member', workspaceName: 'Team', workspaceType: 'team' as const, role: 'owner' as const, memberStatus: 'active' as const, lifecycleState: 'active' as const },
  ];
  const app = express(); app.use(express.json());
  registerMcpRoutes(app, {
    http: { isLocalSameOrigin, resolvedPortRef: { get current() { return (server.address() as { port: number }).port; } } },
    paths: { RUNTIME_DATA_DIR: process.env.OD_DATA_DIR, OD_BIN: '', PROJECTS_DIR: '' },
    mcp: { pendingAuth: new Map(), daemonUrlRef: { current: '' } }, hdwClient: client,
    cloudResourceAccess: {
      readDirectory: async () => ({ ok: true, items: directory }),
      resolveScope: async (req: express.Request) => ({ ok: true, scope: { principal: {
        teamId: String(req.headers['x-od-workspace-id']), memberId: String(req.headers['x-od-workspace-member-id']),
        role: 'owner', lifecycleState: 'active', workspaceType: 'team',
      }, canShare: true } }),
    },
  } as unknown as RegisterMcpRoutesDeps);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { cloudFetch, get: (mine: boolean) => fetch(`${base}/api/workspace/mcp/cloud?scope=public${mine ? '&owner_member_id=personal-member' : ''}`, {
    headers: { 'x-od-workspace-id': 'personal', 'x-od-workspace-member-id': 'personal-member' },
  }), publish: () => fetch(`${base}/api/workspace/mcp/cloud/mcp-team/publish`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-od-workspace-id': 'team', 'x-od-workspace-member-id': 'team-member' },
    body: JSON.stringify({ description: 'Published description', logoKey: 'orbit' }),
  }) };
}

describe('cloud team MCP community publication', () => {
  it.each([false, true])('includes a team MCP in the account public catalog with mine=%s', async (mine) => {
    const f = await fixture(); const response = await f.get(mine);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ templates: [{ resourceId: 'mcp-team', homeWorkspaceId: 'team', homeWorkspaceMemberId: 'team-member', canManage: true }] });
    if (mine) expect(f.cloudFetch.mock.calls.some(([url]) => String(url).includes('owner_member_id=team-member'))).toBe(true);
  });
  it('creates an independent public MCP copy without modifying the owned source or leaking credentials', async () => {
    const f = await fixture(); const response = await f.publish();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, resourceId: 'mcp-copy' });
    const create = f.cloudFetch.mock.calls.find(([url, init]) =>
      init?.method === 'POST' && String(url).endsWith('/resources'));
    expect(String(create?.[0])).toContain('/workspaces/team/resources');
    const body = JSON.parse(String(create?.[1]?.body));
    expect(body).toMatchObject({
      kind: 'mcp', ownerMemberId: 'team-member', scope: 'public',
      metadata: { id: 'same-name', description: 'Published description', communitySourceResourceId: 'mcp-team' },
    });
    expect(JSON.stringify(body)).not.toContain('private-value');
    expect(f.cloudFetch.mock.calls.some(([, init]) => init?.method === 'PUT' || init?.method === 'DELETE')).toBe(false);
  });
  it('refuses to publish a resource owned by another team member', async () => {
    const f = await fixture('other-member');
    expect((await f.publish()).status).toBe(403);
    expect(f.cloudFetch.mock.calls.some(([, init]) => init?.method === 'PUT' || init?.method === 'POST')).toBe(false);
  });
});
