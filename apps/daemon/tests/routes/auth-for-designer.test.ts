import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureForDesignerInstalled } from '../../src/http/hik_logins/for-designer.js';
import { hicooLogin, hicooValidate, writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';
import { registerAuthRoutes } from '../../src/routes/auth.js';

vi.mock('../../src/http/hik_logins/for-designer.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/for-designer.js')>(),
  ensureForDesignerInstalled: vi.fn(() => ({
    status: 'unchanged',
    installedVersion: '1.0.2',
    targetDir: 'synthetic-target',
  })),
}));
vi.mock('../../src/http/hik_logins/hicoo.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/hicoo.js')>(),
  hicooLogin: vi.fn(),
  hicooValidate: vi.fn(),
}));

describe('ForDesigner startup integration through authenticated routes', () => {
  let server: Server;
  let dataDir: string;
  let url: string;
  const bundleDir = '/synthetic/packaged/for-designer';

  beforeEach(async () => {
    vi.mocked(ensureForDesignerInstalled).mockClear();
    vi.mocked(hicooLogin).mockReset().mockResolvedValue({
      ok: true,
      username: 'user01',
      cookies: [{ name: 'oa', value: 'opaque', domain: 'example.test' }],
      userInfo: { displayName: '翁文秀', departmentDetail: '旧组织/设计体系管理组' },
    });
    vi.mocked(hicooValidate).mockReset().mockResolvedValue({
      ok: true,
      isValid: true,
      username: 'user01',
      userInfo: { displayName: '翁文秀' },
    });
    dataDir = await mkdtemp(path.join(tmpdir(), 'fordesigner-auth-startup-'));
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app, {
      env: {},
      dataDir,
      FOR_DESIGNER_DIR: bundleDir,
      sendApiError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
      fetchUplusAvatar: async () => ({ ok: false, reason: 'request_error' }),
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dataDir, { force: true, recursive: true });
  });

  it('checks existing OA session once at startup, without requiring re-login', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'user01',
      userInfo: { displayName: '翁文秀', departmentDetail: '已过时/组织' },
      cookies: [{ name: 'oa', value: 'opaque', domain: 'example.test' }],
    });
    expect(ensureForDesignerInstalled).not.toHaveBeenCalled();
    const first = await fetch(url + '/api/auth/valid');
    const second = await fetch(url + '/api/auth/valid');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json() as { ok: boolean }).ok).toBe(true);
    expect(ensureForDesignerInstalled).toHaveBeenCalledTimes(1);
    expect(ensureForDesignerInstalled).toHaveBeenCalledWith(bundleDir, expect.objectContaining({
      username: 'user01',
      userInfo: expect.objectContaining({ displayName: '翁文秀' }),
    }));
  });

  it('uses the same updater on first login and avoids a redundant update on auth validation', async () => {
    const result = await fetch(url + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user01', password: 'test-only-credential' }),
    });
    expect(result.status).toBe(200);
    expect(ensureForDesignerInstalled).toHaveBeenCalledTimes(1);
    expect((await fetch(url + '/api/auth/valid')).status).toBe(200);
    expect(ensureForDesignerInstalled).toHaveBeenCalledTimes(1);
  });
});
