import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCollabContextHideSignRoutes } from '../../src/routes/collab-context-hidesign.js';
import { HdwPostError } from '../../src/http/hdw.js';

const mocks = vi.hoisted(() => ({ share: vi.fn(), session: vi.fn() }));
vi.mock('../../src/http/hdw.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/http/hdw.js')>()),
  shareResourceToSharedSpace: mocks.share,
}));
vi.mock('../../src/http/hik_logins/hicoo.js', () => ({
  readSsoConfigFile: mocks.session,
  readSsoUsername: () => 'authorized-owner',
}));

let server: Server | null = null;
let origin = '';

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue({ username: 'authorized-owner', userInfo: { displayName: 'Owner' } });
  const app = express();
  app.use(express.json());
  registerCollabContextHideSignRoutes(app, { serveWorkspaceContext: false, dataDir: '/test-only' });
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

function submit() {
  return fetch(`${origin}/api/resource-share/share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resource_id: 'test-resource',
      kind: 'mcp',
      home_workspace_id: 'test-workspace',
      recipients: [{ username: 'recipient' }],
    }),
  });
}

describe('HDW resource share owner failure mapping', () => {
  it('returns an explicit 403 without allowing resource sharing after an owner mismatch', async () => {
    mocks.share.mockRejectedValue(new HdwPostError(403, 'NOT_RESOURCE_OWNER'));
    const result = await submit();
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ error: 'NOT_RESOURCE_OWNER' });
    expect(mocks.share).toHaveBeenCalledOnce();
    expect(mocks.share.mock.calls[0]?.[1]).toMatchObject({ createdByUsername: 'authorized-owner', resourceId: 'test-resource' });
  });

  it('keeps temporary failures distinct from forbidden ownership', async () => {
    mocks.share.mockResolvedValue(null);
    const result = await submit();
    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({ error: 'UPSTREAM_UNAVAILABLE' });
  });

  it('keeps a successful share response unchanged', async () => {
    mocks.share.mockResolvedValue({ shared: 1, skipped: 0 });
    const result = await submit();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ shared: 1, skipped: 0 });
  });
});
