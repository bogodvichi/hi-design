import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';
import { registerAuthRoutes } from '../../src/routes/auth.js';

describe('POST /api/auth/uedro/launch', () => {
  let server: Server | null = null;
  let dataDir = '';
  let baseUrl = '';
  const createUedroLaunch = vi.fn();
  const requireLocalDaemonRequest = vi.fn((_req, _res, next) => next());

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-uedro-auth-'));
    createUedroLaunch.mockReset();
    requireLocalDaemonRequest.mockClear();
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app, {
      env: {},
      dataDir,
      sendApiError: (res, status, code, message) =>
        res.status(status).json({ error: { code, message } }),
      createUedroLaunch,
      requireLocalDaemonRequest,
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

  it('rejects launch without a saved UEDRO session', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [{ name: 'oa_session', value: 'opaque-cookie', domain: 'sso.example' }],
      loginAt: Date.now(),
    });

    const response = await fetch(`${baseUrl}/api/auth/uedro/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(401);
    expect(createUedroLaunch).not.toHaveBeenCalled();
    expect(requireLocalDaemonRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects targets outside the official UEDRO page allowlist', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [],
      uedro: {
        cookies: [
          { name: 'EPORTAL_JSESSIONID', value: 'opaque-uedro', domain: 'uedro.hikvision.com.cn' },
        ],
      },
    });

    const response = await fetch(`${baseUrl}/api/auth/uedro/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: 'https://uedro.hikvision.com.cn.evil.example/uedro/home' }),
    });

    expect(response.status).toBe(400);
    expect(createUedroLaunch).not.toHaveBeenCalled();
  });

  it('mints a one-time URL for the default historical review page', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [],
      uedro: {
        cookies: [
          { name: 'EPORTAL_JSESSIONID', value: 'opaque-uedro', domain: 'uedro.hikvision.com.cn' },
        ],
      },
    });
    createUedroLaunch.mockResolvedValue({
      launchUrl: 'https://uedro.hikvision.com.cn/uedro/home?ticket=ST-123456',
      expiresIn: 60,
    });

    const response = await fetch(`${baseUrl}/api/auth/uedro/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(text)).toEqual({
      ok: true,
      launchUrl: 'https://uedro.hikvision.com.cn/uedro/home?ticket=ST-123456',
      expiresIn: 60,
    });
    expect(text).not.toContain('opaque-uedro');
    expect(createUedroLaunch).toHaveBeenCalledWith('https://uedro.hikvision.com.cn/uedro/home');
  });

  it('forwards a requested review page to the ticket issuer', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [],
      uedro: {
        cookies: [
          { name: 'EPORTAL_JSESSIONID', value: 'opaque-uedro', domain: 'uedro.hikvision.com.cn' },
        ],
      },
    });
    createUedroLaunch.mockResolvedValue({
      launchUrl: 'https://uedro.hikvision.com.cn/uedro/ux?id=abc&ticket=ST-123456',
      expiresIn: 60,
    });
    const targetUrl = 'https://uedro.hikvision.com.cn/uedro/ux?id=abc';

    const response = await fetch(`${baseUrl}/api/auth/uedro/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl }),
    });

    expect(response.status).toBe(200);
    expect(createUedroLaunch).toHaveBeenCalledWith(targetUrl);
  });
});
