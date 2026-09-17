import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';
import { registerAuthRoutes } from '../../src/routes/auth.js';

describe('POST /api/auth/himind/launch', () => {
  let server: Server | null = null;
  let dataDir = '';
  let baseUrl = '';
  const createHiMindLaunch = vi.fn();

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-himind-auth-'));
    createHiMindLaunch.mockReset();
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app, {
      env: {},
      dataDir,
      sendApiError: (res, status, code, message) =>
        res.status(status).json({ error: { code, message } }),
      createHiMindLaunch,
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

  it('rejects launch when there is no device-bound OA session', async () => {
    const response = await fetch(`${baseUrl}/api/auth/himind/launch`, { method: 'POST' });

    expect(response.status).toBe(401);
    expect(createHiMindLaunch).not.toHaveBeenCalled();
  });

  it('returns the server-issued HiMind callback URL for an OA session', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [{ name: 'oa_session', value: 'opaque-cookie', domain: 'oa.example' }],
      loginAt: Date.now(),
    });
    createHiMindLaunch.mockResolvedValue({
      launchUrl: 'http://himind.example/api/v1/auth/hidesign/callback?ticket=opaque',
      expiresIn: 60,
    });

    const response = await fetch(`${baseUrl}/api/auth/himind/launch`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      launchUrl: 'http://himind.example/api/v1/auth/hidesign/callback?ticket=opaque',
      expiresIn: 60,
    });
    expect(createHiMindLaunch).toHaveBeenCalledTimes(1);
  });
});
