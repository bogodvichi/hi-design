import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCollabContextHideSignRoutes } from '../../src/routes/collab-context-hidesign.js';

const mocks = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn(), session: vi.fn() }));
vi.mock('../../src/http/hdw.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/http/hdw.js')>()),
  fetchResourcesSharedWithMe: mocks.list, unshareResourceFromSharedSpace: mocks.remove,
}));
vi.mock('../../src/http/hik_logins/hicoo.js', () => ({ readSsoConfigFile: mocks.session, readSsoUsername: () => 'me' }));
let server: Server;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue({ username: 'me' });
  mocks.list.mockImplementation(async (_dir: unknown, kind: string) => [{ shareId: `${kind}-mine`, resourceId: 'original' }]);
  mocks.remove.mockResolvedValue(true);
});
afterEach(async () => { if (server?.listening) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } });

async function request(kind: string, shareId: string) {
  const app = express(); registerCollabContextHideSignRoutes(app, { dataDir: '/test-data' });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  return fetch(`http://127.0.0.1:${address.port}/api/resource-share/shared-with-me/${encodeURIComponent(shareId)}?kind=${kind}`, { method: 'DELETE' });
}

describe('recipient resource-share removal', () => {
  it.each(['skill', 'mcp'])('removes only the signed-in recipient %s share', async (kind) => {
    const response = await request(kind, `${kind}-mine`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('/test-data', `${kind}-mine`);
  });
  it('refuses another recipient share even when its resource is shared with me', async () => {
    expect((await request('skill', 'another-share-of-original')).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('requires a signed-in recipient', async () => {
    mocks.session.mockReturnValue(null);
    expect((await request('mcp', 'mcp-mine')).status).toBe(401);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('rejects invalid kinds', async () => {
    expect((await request('project', 'skill-mine')).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('returns a failure when the upstream did not remove the share', async () => {
    mocks.remove.mockResolvedValue(false);
    const response = await request('skill', 'skill-mine');
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false });
  });
});
