import type { Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hikkeLogin, hikkeValidate } from '../../src/http/hik_logins/hikke.js';
import {
  hicooLogin,
  hicooValidate,
  readSsoConfigFile,
  writeSsoConfigFile,
} from '../../src/http/hik_logins/hicoo.js';
import { createUedroLaunchUrl, uedroLogin, uedroValidate } from '../../src/http/hik_logins/uedro.js';
import { PlatformLoginError } from '../../src/http/hik_logins/login-error.js';
import { registerAuthRoutes } from '../../src/routes/auth.js';
import { encryptPassword } from '../../src/http/hik_logins/session-guard.js';
import { hdwPost } from '../../src/http/hdw.js';

vi.mock('../../src/http/hik_logins/hikke.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/hikke.js')>(),
  hikkeLogin: vi.fn(),
  hikkeValidate: vi.fn(),
}));
vi.mock('../../src/http/hik_logins/hicoo.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/hicoo.js')>(),
  hicooLogin: vi.fn(),
  hicooValidate: vi.fn(),
}));
vi.mock('../../src/http/hik_logins/uedro.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/uedro.js')>(),
  createUedroLaunchUrl: vi.fn(),
  uedroLogin: vi.fn(),
  uedroValidate: vi.fn(),
}));
vi.mock('../../src/http/hdw.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hdw.js')>(),
  hdwPost: vi.fn(),
}));

describe('auth routes', () => {
  let server: Server;
  let baseUrl: string;
  let dataDir: string;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  afterAll(() => { warn.mockRestore(); });

  beforeEach(async () => {
    vi.mocked(hikkeLogin).mockReset().mockResolvedValue({
      ok: true, username: 'synthetic-user', cookies: [],
      hikkeToken: 'synthetic-token', testToken: 'synthetic-test',
      userInfo: { displayName: 'Synthetic' }, loginAt: 1,
    });
    vi.mocked(hicooLogin).mockReset().mockResolvedValue({
      ok: true,
      username: 'synthetic-user',
      cookies: [{ name: 'oa', value: 'opaque', domain: 'hicoo.hikvision.com.cn' }],
      userInfo: { displayName: 'Synthetic' },
    });
    vi.mocked(uedroLogin).mockReset().mockResolvedValue({ ok: true, username: 'synthetic-user', cookies: [] });
    vi.mocked(createUedroLaunchUrl).mockReset();
    vi.mocked(hicooValidate).mockReset().mockResolvedValue({
      ok: true,
      isValid: true,
      username: 'synthetic-user',
      userInfo: { displayName: 'Synthetic' },
    });
    vi.mocked(hikkeValidate).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(uedroValidate).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(hdwPost).mockReset().mockResolvedValue({ password: 'synthetic-password' });
    warn.mockClear();
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-login-errors-'));
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app, {
      env: {}, dataDir,
      sendApiError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
      fetchUplusAvatar: async () => ({ ok: false, reason: 'request_error' }),
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  function submit() {
    return fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'synthetic-user', password: 'synthetic-password' }),
    });
  }

  it.each([401, 502] as const)('returns hicoo failure status %s unchanged', async (status) => {
    const failure = new PlatformLoginError('hicoo', status);
    vi.mocked(hicooLogin).mockRejectedValueOnce(failure);
    const response = await submit();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code: failure.code, message: failure.message } });
    expect(hikkeLogin).not.toHaveBeenCalled();
    expect(uedroLogin).not.toHaveBeenCalled();
    expect(readSsoConfigFile(dataDir)).toBeNull();
  });

  it('maps unclassified hicoo exceptions to 502 without leaking details', async () => {
    vi.mocked(hicooLogin).mockRejectedValueOnce(new Error('upstream included synthetic-password'));
    const response = await submit();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'BAD_GATEWAY', message: 'hicoo login unavailable' } });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-password');
  });

  it('does not replace the saved session when hicoo credentials are rejected', async () => {
    writeSsoConfigFile(dataDir, { username: 'previous-user', cookies: [], loginAt: 1 });
    vi.mocked(hicooLogin).mockRejectedValueOnce(new PlatformLoginError('hicoo', 401));
    expect((await submit()).status).toBe(401);
    expect(readSsoConfigFile(dataDir)?.username).toBe('previous-user');
  });

  it('stores only deferred encrypted credentials for hikke and uedro', async () => {
    const response = await submit();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok?: boolean; username?: string; uedro?: unknown };
    expect(payload).toMatchObject({ ok: true, username: 'synthetic-user' });
    expect(payload.uedro).toBeUndefined();
    expect(hikkeLogin).not.toHaveBeenCalled();
    expect(uedroLogin).not.toHaveBeenCalled();

    const session = readSsoConfigFile(dataDir);
    expect(session?.username).toBe('synthetic-user');
    expect(session?.hikke?.password).toMatch(/^v2:hidesign-sso-01:/);
    expect(session?.uedro?.password).toMatch(/^v2:hidesign-sso-01:/);
    expect(session?.hikke?.hikkeToken).toBeUndefined();
    expect(session?.uedro?.cookies).toBeUndefined();

    const raw = await readFile(path.join(dataDir, 'config.sso.json'), 'utf8');
    expect(raw).not.toContain('synthetic-password');
  });

  it('validates only hicoo and clears the session when hicoo expires', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'previous-user',
      cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }],
      hikke: { hikkeToken: 'stale-token' },
      uedro: { cookies: [{ name: 'uedro', value: 'stale', domain: 'uedro.hikvision.com.cn' }] },
    });
    vi.mocked(hicooValidate).mockResolvedValueOnce({ ok: false, isValid: false, username: 'previous-user' });

    const response = await fetch(`${baseUrl}/api/auth/valid`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, username: 'previous-user' });
    expect(hikkeValidate).not.toHaveBeenCalled();
    expect(uedroValidate).not.toHaveBeenCalled();
    expect(readSsoConfigFile(dataDir)).toBeNull();
  });

  it('clears an expired OA session even when a cached profile exists', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'previous-user', cookies: [], userInfo: { displayName: 'Cached' },
    });
    vi.mocked(hicooValidate).mockResolvedValueOnce({ ok: false, isValid: false, username: 'previous-user' });
    const response = await fetch(`${baseUrl}/api/auth/valid`);
    expect(await response.json()).toEqual({ ok: false, username: 'previous-user' });
    expect(readSsoConfigFile(dataDir)).toBeNull();
    expect(hikkeValidate).not.toHaveBeenCalled();
    expect(uedroValidate).not.toHaveBeenCalled();
  });

  it('does not clear a replacement login when an old verification finishes', async () => {
    writeSsoConfigFile(dataDir, { username: 'previous-user', cookies: [{ name: 'oa', value: 'old', domain: 'hicoo.hikvision.com.cn' }] });
    vi.mocked(hicooValidate).mockImplementationOnce(async () => {
      writeSsoConfigFile(dataDir, { username: 'new-user', cookies: [{ name: 'oa', value: 'new', domain: 'hicoo.hikvision.com.cn' }] });
      return { ok: false, isValid: false, username: 'previous-user' };
    });
    const response = await fetch(`${baseUrl}/api/auth/valid`);
    expect(response.status).toBe(503);
    expect(readSsoConfigFile(dataDir)?.username).toBe('new-user');
  });

  it('preserves saved credentials when OA verification is unavailable', async () => {
    writeSsoConfigFile(dataDir, { username: 'previous-user', cookies: [], userInfo: { displayName: 'Cached' } });
    vi.mocked(hicooValidate).mockRejectedValueOnce(new Error('offline'));
    const response = await fetch(`${baseUrl}/api/auth/valid`);
    expect(response.status).toBe(503);
    expect(readSsoConfigFile(dataDir)?.username).toBe('previous-user');
    expect(hikkeValidate).not.toHaveBeenCalled();
    expect(uedroValidate).not.toHaveBeenCalled();
  });

  it('reuses valid UEDRO cookies to mint a launch URL', async () => {
    const cookies = [{ name: 'EPORTAL_JSESSIONID', value: 'current', domain: 'uedro.hikvision.com.cn' }];
    writeSsoConfigFile(dataDir, {
      username: 'synthetic-user',
      cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }],
      uedro: { cookies, password: encryptPassword('synthetic-password') },
    });
    vi.mocked(createUedroLaunchUrl).mockResolvedValueOnce(
      'https://uedro.hikvision.com.cn/uedro/home?ticket=ST-current',
    );

    const response = await fetch(`${baseUrl}/api/auth/uedro/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: 'https://uedro.hikvision.com.cn/uedro/home' }),
    });
    const payload = await response.json() as { ok?: boolean; launchUrl?: string };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, launchUrl: 'https://uedro.hikvision.com.cn/uedro/home?ticket=ST-current' });
    expect(uedroValidate).toHaveBeenCalledWith(cookies);
    expect(uedroLogin).not.toHaveBeenCalled();
    expect(createUedroLaunchUrl).toHaveBeenCalledWith(cookies, 'https://uedro.hikvision.com.cn/uedro/home');
  });

  it('relogs into UEDRO before minting a launch URL when cookies expire', async () => {
    const freshCookies = [{ name: 'EPORTAL_JSESSIONID', value: 'fresh', domain: 'uedro.hikvision.com.cn' }];
    writeSsoConfigFile(dataDir, {
      username: 'synthetic-user',
      // Deferred decryption needs an OA session, independently of the stale UEDRO cookies.
      cookies: [{ name: 'oa', value: 'opaque', domain: 'hicoo.hikvision.com.cn' }],
      uedro: {
        cookies: [{ name: 'EPORTAL_JSESSIONID', value: 'stale', domain: 'uedro.hikvision.com.cn' }],
        password: encryptPassword('synthetic-password'),
      },
    });
    vi.mocked(uedroValidate).mockResolvedValueOnce({ ok: false });
    vi.mocked(uedroLogin).mockResolvedValueOnce({
      ok: true,
      username: 'synthetic-user',
      cookies: freshCookies,
    });
    vi.mocked(createUedroLaunchUrl).mockResolvedValueOnce(
      'https://uedro.hikvision.com.cn/uedro/home?ticket=ST-fresh',
    );

    const response = await fetch(`${baseUrl}/api/auth/uedro/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: 'https://uedro.hikvision.com.cn/uedro/home' }),
    });

    expect(response.status).toBe(200);
    expect(uedroLogin).toHaveBeenCalledWith('synthetic-user', 'synthetic-password');
    expect(createUedroLaunchUrl).toHaveBeenCalledWith(freshCookies, 'https://uedro.hikvision.com.cn/uedro/home');
    expect(readSsoConfigFile(dataDir)?.uedro).toMatchObject({ cookies: freshCookies });
  });
});
