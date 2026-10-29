import express from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerMcpRoutes, type RegisterMcpRoutesDeps } from '../../src/mcp-routes.js';
import { readMcpConfig, writeMcpConfig } from '../../src/mcp-config.js';
import { createHdwCloudClient } from '../../src/integrations/hdw-cloud.js';
import { getToken, setToken } from '../../src/mcp-tokens.js';

let server: Server;
let dir: string;
let base: string;
let remoteUrl: string;
let remoteStatus: number;
let cloudFetch: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cloud-mcp-install-'));
  remoteUrl = 'https://remote.example/new';
  remoteStatus = 200;
  cloudFetch = vi.fn<typeof fetch>(async () => Response.json(remoteStatus === 200 ? {
    id: 'cloud-mcp', kind: 'mcp', ownerMemberId: 'owner',
    metadata: { id: 'review', label: 'Remote review', transport: 'http', url: remoteUrl,
      authMode: 'none', headerFields: [{ key: 'Authorization', secret: true }] },
  } : { error: 'unavailable' }, { status: remoteStatus }));
  const app = express();
  app.use(express.json());
  registerMcpRoutes(app, {
    http: { isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 } },
    paths: { RUNTIME_DATA_DIR: dir, OD_BIN: '', PROJECTS_DIR: '' },
    mcp: { pendingAuth: new Map(), daemonUrlRef: { current: '' } },
    hdwClient: createHdwCloudClient({ fetch: cloudFetch }),
    cloudResourceAccess: { resolveScope: async () => ({ ok: true, scope: {
      principal: { teamId: 'personal', memberId: 'owner', role: 'owner', workspaceType: 'team', lifecycleState: 'active' },
      canShare: true,
    } }) },
  } as unknown as RegisterMcpRoutesDeps);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await writeMcpConfig(dir, { servers: [{
    id: 'existing', templateId: 'review', label: 'Old review', transport: 'http',
    url: 'https://remote.example/old', enabled: true, authMode: 'none',
    headers: { Authorization: 'user-configured-secret' }, workspaceId: 'personal', ownerMemberId: 'owner',
    cloudResourceId: 'cloud-mcp', cloudHomeWorkspaceId: 'personal',
  }] });
});

afterEach(async () => {
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  if (dir) await rm(dir, { recursive: true, force: true });
});

it('refreshes a connected MCP from the remote template and preserves its local ID and credentials', async () => {
  const response = await fetch(`${base}/api/workspace/mcp/cloud/cloud-mcp/install`, { method: 'POST' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ installed: true, serverId: 'existing' });
  expect(String(cloudFetch.mock.calls[0]?.[0])).toBe(
    'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web/hdw/api/workspaces/personal/resources/cloud-mcp',
  );
  expect((await readMcpConfig(dir)).servers).toMatchObject([{
    id: 'existing', url: remoteUrl, label: 'Remote review', headers: { Authorization: 'user-configured-secret' },
  }]);
});

it('fails when the remote MCP is unavailable despite a local connection and preserves the old config', async () => {
  remoteStatus = 503;
  const before = await readMcpConfig(dir);
  const response = await fetch(`${base}/api/workspace/mcp/cloud/cloud-mcp/install`, { method: 'POST' });
  expect(response.status).toBeGreaterThanOrEqual(500);
  expect(cloudFetch).toHaveBeenCalledTimes(1);
  expect(await readMcpConfig(dir)).toEqual(before);
});

it('does not forward stored credentials when the remote template changes its HTTP origin', async () => {
  await setToken(dir, 'existing', { accessToken: 'local-token', tokenType: 'Bearer', savedAt: Date.now() });
  remoteUrl = 'https://other.example/mcp';
  const response = await fetch(`${base}/api/workspace/mcp/cloud/cloud-mcp/install`, { method: 'POST' });
  expect(response.status).toBe(200);
  const config = await readMcpConfig(dir);
  expect(config.servers).toMatchObject([{ id: 'existing', url: remoteUrl }]);
  expect(config.servers[0]?.headers?.Authorization).toBeFalsy();
  expect(await getToken(dir, 'existing')).toBeNull();
});
