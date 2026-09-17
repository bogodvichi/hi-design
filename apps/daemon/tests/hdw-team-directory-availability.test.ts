import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { fetchHdwTeams } from '../src/http/hdw.js';
import { registerCollabContextHideSignRoutes } from '../src/routes/collab-context-hidesign.js';

vi.mock('../src/http/hik_logins/hicoo.js', () => ({
  readSsoConfigFile: () => ({ username: 'test-user', cookies: [] }),
  readSsoUsername: () => 'test-user',
}));

const localFetch = globalThis.fetch;
let server: Server | undefined;
let origin: string;
let upstream: () => Response;

beforeEach(async () => {
  upstream = () => new Response('Bad Gateway', { status: 502 });
  vi.stubGlobal('fetch', vi.fn(async () => upstream()));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  registerCollabContextHideSignRoutes(app, { dataDir: process.env.OD_DATA_DIR! });
  server = await new Promise<Server>((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  const closing = server;
  server = undefined;
  if (closing) {
    closing.closeAllConnections();
    await new Promise<void>((resolve, reject) => closing.close(error => error ? reject(error) : resolve()));
  }
});

describe('HDW team directory availability', () => {
  it('reports upstream failures without returning a successful empty directory or missing workspace', async () => {
    for (const [method, route] of [
      ['GET', '/api/workspace/directory'],
      ['GET', '/api/workspace/context'],
      ['GET', '/api/workspace/billing?workspaceId=team-1'],
      ['PUT', '/api/workspace/active'],
    ] as const) {
      const response = await localFetch(origin + route, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-od-workspace-id': 'team-1' },
        ...(method === 'PUT' ? { body: JSON.stringify({ workspaceId: 'team-1' }) } : {}),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'UPSTREAM_UNAVAILABLE', retryable: true });
    }
  });

  it('distinguishes a valid empty membership list from an API error or malformed payload', async () => {
    upstream = () => Response.json({ code: 0, data: { teams: [] } });
    await expect(fetchHdwTeams(process.env.OD_DATA_DIR)).resolves.toEqual([]);
    for (const payload of [{ code: -1, msg: 'FAIL' }, { code: 0, data: {} }]) {
      upstream = () => Response.json(payload);
      await expect(fetchHdwTeams(process.env.OD_DATA_DIR)).rejects.toThrow();
    }
  });

  it('returns teams again on the next read after the upstream recovers', async () => {
    expect((await localFetch(origin + '/api/workspace/directory')).status).toBe(503);
    upstream = () => Response.json({ code: 0, data: { teams: [{
      workspace_id: 'team-1', workspace_name: 'Recovered team',
      workspace_member_id: 'member-1', role: 'owner',
    }] } });
    const response = await localFetch(origin + '/api/workspace/directory');
    expect(response.status).toBe(200);
    const body = await response.json() as { items: unknown[] };
    expect(body.items).toContainEqual(expect.objectContaining({ workspaceId: 'team-1', workspaceName: 'Recovered team' }));
  });
});
