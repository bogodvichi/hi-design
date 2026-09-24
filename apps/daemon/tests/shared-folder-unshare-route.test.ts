import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { registerCollabContextHideSignRoutes } from '../src/routes/collab-context-hidesign.js';

vi.mock('../src/http/hik_logins/hicoo.js', () => ({
  readSsoConfigFile: () => ({ username: 'viewer-user', cookies: [] }),
  readSsoUsername: () => 'viewer-user',
}));

const localFetch = globalThis.fetch;
let server: Server | undefined;
let origin = '';
let upstreamCalls: Array<{ url: string; init: Parameters<typeof fetch>[1] }> = [];

beforeEach(async () => {
  upstreamCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    upstreamCalls.push({ url: String(input), init });
    return Response.json({ code: 0, msg: 'SUCCESS', data: { folder_shares_deleted: 1 } });
  }));

  const app = express();
  app.use(express.json());
  registerCollabContextHideSignRoutes(app, { dataDir: '/tmp/od-shared-folder-unshare-test' });
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

describe('shared folder unshare route', () => {
  it('routes the static unshare-folder path to HDW folder/unshare instead of project share deletion', async () => {
    const response = await localFetch(`${origin}/api/shared-space/unshare-folder`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: 'owner-workspace',
        folder_id: 'folder-1',
        recipient_member_id: 'viewer-member',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0]?.url).toMatch(/\/folder\/unshare$/);
    expect(upstreamCalls[0]?.url).not.toMatch(/\/shared-space\/unshare-folder$/);
    expect(upstreamCalls[0]?.init?.method).toBe('DELETE');
    expect(JSON.parse(String(upstreamCalls[0]?.init?.body))).toEqual({
      workspace_id: 'owner-workspace',
      folder_id: 'folder-1',
      recipient_member_id: 'viewer-member',
    });
  });
});
