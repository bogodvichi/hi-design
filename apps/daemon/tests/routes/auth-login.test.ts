import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hikkeLogin } from '../../src/http/hik_logins/hikke.js';
import { hicooLogin, readSsoConfigFile, writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';
import { uedroLogin } from '../../src/http/hik_logins/uedro.js';
import { PlatformLoginError } from '../../src/http/hik_logins/login-error.js';
import { registerAuthRoutes } from '../../src/routes/auth.js';

vi.mock('../../src/http/hik_logins/hikke.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/hikke.js')>(),
  hikkeLogin: vi.fn(),
}));
vi.mock('../../src/http/hik_logins/hicoo.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/hicoo.js')>(),
  hicooLogin: vi.fn(),
}));
vi.mock('../../src/http/hik_logins/uedro.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/uedro.js')>(),
  uedroLogin: vi.fn(),
}));

describe('POST /api/auth/login', () => {
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
    vi.mocked(hicooLogin).mockReset().mockResolvedValue({ ok: true, username: 'synthetic-user', cookies: [] });
    vi.mocked(uedroLogin).mockReset().mockResolvedValue({ ok: true, username: 'synthetic-user', cookies: [] });
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

  it.each([401, 502] as const)('returns the required platform failure status %s unchanged', async (status) => {
    const failure = new PlatformLoginError('hikke', status);
    vi.mocked(hikkeLogin).mockRejectedValueOnce(failure);
    const response = await submit();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code: failure.code, message: failure.message } });
    expect(hicooLogin).not.toHaveBeenCalled();
    expect(uedroLogin).not.toHaveBeenCalled();
    expect(readSsoConfigFile(dataDir)).toBeNull();
  });

  it('maps unclassified exceptions to 502 without leaking details', async () => {
    vi.mocked(hikkeLogin).mockRejectedValueOnce(new Error('upstream included synthetic-password'));
    const response = await submit();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'BAD_GATEWAY', message: 'hikke login unavailable' } });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-password');
  });

  describe.each([
    { platform: 'hicoo', login: hicooLogin, label: 'SSO login failed:' },
    { platform: 'uedro', login: uedroLogin, label: 'uedro login failed:' },
  ] as const)('$platform secondary login', ({ platform, login, label }) => {
    it.each([401, 502] as const)('classifies %s without blocking primary login', async (status) => {
      const failure = new PlatformLoginError(platform, status);
      vi.mocked(login).mockRejectedValueOnce(failure);
      const response = await submit();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true });
      expect(warn).toHaveBeenCalledWith(label, { status, code: failure.code });
      expect(readSsoConfigFile(dataDir)?.hikke?.hikkeToken).toBe('synthetic-token');
    });
  });

  it('does not replace the saved session when credentials are rejected', async () => {
    writeSsoConfigFile(dataDir, { username: 'previous-user', cookies: [], loginAt: 1 });
    vi.mocked(hikkeLogin).mockRejectedValueOnce(new PlatformLoginError('hikke', 401));
    expect((await submit()).status).toBe(401);
    expect(readSsoConfigFile(dataDir)?.username).toBe('previous-user');
  });

  it('still saves sessions after all three platforms succeed', async () => {
    const response = await submit();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, username: 'synthetic-user' });
    expect(hicooLogin).toHaveBeenCalledTimes(1);
    expect(uedroLogin).toHaveBeenCalledTimes(1);
    expect(readSsoConfigFile(dataDir)).toMatchObject({ username: 'synthetic-user', uedro: { cookies: [] } });
  });
});
