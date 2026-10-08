import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';
import { registerAuthRoutes } from '../../src/routes/auth.js';

describe('GET /api/auth/avatar', () => {
  let server: Server | null = null;
  let dataDir = '';
  let baseUrl = '';
  const fetchUplusAvatar = vi.fn();
  const syncCommunityAvatar = vi.fn(async () => true);

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-uplus-avatar-'));
    fetchUplusAvatar.mockReset();
    syncCommunityAvatar.mockClear();
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app, {
      env: {},
      dataDir,
      sendApiError: (res, status, code, message) =>
        res.status(status).json({ error: { code, message } }),
      fetchUplusAvatar,
      syncCommunityAvatar,
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    await rm(dataDir, { recursive: true, force: true });
  });

  it('rejects reads without the device-bound OA session', async () => {
    const response = await fetch(`${baseUrl}/api/auth/avatar`);
    expect(response.status).toBe(401);
    expect(fetchUplusAvatar).not.toHaveBeenCalled();
    expect(syncCommunityAvatar).not.toHaveBeenCalled();
  });

  it('returns only the avatar cached during OA login', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [{ name: 'oa_session', value: 'opaque-cookie', domain: 'sso.hikvision.com' }],
      userInfo: {
        displayName: 'Alice',
        avatarUrl: 'https://assets.example/alice.jpg',
      },
      loginAt: Date.now(),
    });

    const first = await fetch(`${baseUrl}/api/auth/avatar`);
    const second = await fetch(`${baseUrl}/api/auth/avatar`);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      avatarUrl: 'https://assets.example/alice.jpg',
    });
    expect(await second.json()).toEqual({
      ok: true,
      avatarUrl: 'https://assets.example/alice.jpg',
    });
    expect(fetchUplusAvatar).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(syncCommunityAvatar).toHaveBeenCalledTimes(1);
    });
    expect(syncCommunityAvatar).toHaveBeenCalledWith(
      dataDir,
      'alice',
      'https://assets.example/alice.jpg',
    );
  });
});
