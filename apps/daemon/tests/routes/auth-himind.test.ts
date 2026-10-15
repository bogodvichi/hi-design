import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';
import { registerAuthRoutes } from '../../src/routes/auth.js';

describe('POST /api/auth/himind/launch', () => {
  let server: Server | null = null;
  let dataDir = '';
  let baseUrl = '';
  const createHiMindLaunch = vi.fn();
  const env: NodeJS.ProcessEnv = {};

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-himind-auth-'));
    createHiMindLaunch.mockReset();
    delete env.OD_WEB_PORT;
    delete env.OD_ALLOWED_ORIGINS;
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app, {
      env,
      dataDir,
      sendApiError: (res, status, code, message) =>
        res.status(status).json({ error: { code, message } }),
      createHiMindLaunch,
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server!.once('listening', resolve); server!.once('error', reject); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
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

  function signedIn() {
    writeSsoConfigFile(dataDir, { username: 'alice', cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.example' }] });
    createHiMindLaunch.mockResolvedValue({ launchUrl: 'https://himind.example/callback?ticket=opaque', expiresIn: 60 });
  }
  function launch(parent_origin: unknown, origin?: string) {
    return fetch(`${baseUrl}/api/auth/himind/launch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify({ parent_origin }),
    });
  }

  it('binds the actual browser origin and rejects a stale port after a restart', async () => {
    signedIn();
    env.OD_WEB_PORT = '50023';
    expect((await launch('http://127.0.0.1:50023', 'http://127.0.0.1:50023')).status).toBe(200);
    expect(createHiMindLaunch).toHaveBeenLastCalledWith('http://127.0.0.1:50023');
    env.OD_WEB_PORT = '50123';
    expect((await launch('http://127.0.0.1:50023')).status).toBe(403);
    expect((await launch('http://127.0.0.1:50123', 'http://127.0.0.1:50123')).status).toBe(200);
    expect(createHiMindLaunch).toHaveBeenLastCalledWith('http://127.0.0.1:50123');
    expect(createHiMindLaunch).toHaveBeenCalledTimes(2);
  });

  it('supports an explicitly allowed hosted UI origin', async () => {
    signedIn();
    env.OD_ALLOWED_ORIGINS = 'https://design.example';
    expect((await launch('https://design.example', 'https://design.example')).status).toBe(200);
    expect(createHiMindLaunch).toHaveBeenCalledWith('https://design.example');
  });

  it('binds legacy browser callers from their Origin header', async () => {
    signedIn();
    const response = await fetch(`${baseUrl}/api/auth/himind/launch`, { method: 'POST', headers: { Origin: baseUrl } });
    expect(response.status).toBe(200);
    expect(createHiMindLaunch).toHaveBeenCalledWith(baseUrl);
  });

  it('rejects a parent origin that differs from the browser Origin header', async () => {
    signedIn();
    expect((await launch(baseUrl, 'https://foreign.example')).status).toBe(403);
    expect(createHiMindLaunch).not.toHaveBeenCalled();
  });

  it.each(['null', '*', 'file:///tmp/page.html', 'https://user:pass@design.example', 'https://design.example/path', 'https://design.example?x=1', 'https://design.example#fragment', null, 123])('rejects malformed origin %j', async (origin) => {
    signedIn();
    expect((await launch(origin)).status).toBe(400);
    expect(createHiMindLaunch).not.toHaveBeenCalled();
  });

  it('rejects unconfigured remote and lookalike loopback origins', async () => {
    signedIn();
    for (const origin of ['https://foreign.example', 'http://localhost.attacker.example:50023']) {
      expect((await launch(origin)).status).toBe(403);
    }
    expect(createHiMindLaunch).not.toHaveBeenCalled();
  });

  it('supports the same binding through od auth himind --parent-origin --json', async () => {
    signedIn();
    const cli = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [
      '--import', 'tsx', cli, 'auth', 'himind', '--parent-origin', baseUrl, '--daemon-url', baseUrl, '--json',
    ], { cwd: path.dirname(cli) });
    expect(JSON.parse(stdout).ok).toBe(true);
    expect(createHiMindLaunch).toHaveBeenCalledWith(baseUrl);
  });
});
