import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hikkeLogin, hikkeValidate } from '../../src/http/hik_logins/hikke.js';
import { readSsoConfigFile, writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';
import { hdwPost } from '../../src/http/hdw.js';
import {
  encryptPassword,
  ensureHikkeSession,
  ensureUedroSession,
} from '../../src/http/hik_logins/session-guard.js';
import { uedroLogin, uedroValidate } from '../../src/http/hik_logins/uedro.js';

vi.mock('../../src/http/hik_logins/hikke.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/hikke.js')>(),
  hikkeLogin: vi.fn(),
  hikkeValidate: vi.fn(),
}));
vi.mock('../../src/http/hik_logins/uedro.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hik_logins/uedro.js')>(),
  uedroLogin: vi.fn(),
  uedroValidate: vi.fn(),
}));
vi.mock('../../src/http/hdw.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/http/hdw.js')>(),
  hdwPost: vi.fn(),
}));

describe('deferred Hikke and UEDRO sessions', () => {
  let dataDir: string;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(async () => {
    vi.mocked(hikkeLogin).mockReset();
    vi.mocked(hikkeValidate).mockReset();
    vi.mocked(uedroLogin).mockReset();
    vi.mocked(uedroValidate).mockReset();
    vi.mocked(hdwPost).mockReset();
    warn.mockClear();
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-session-guard-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('uses a valid Hikke token without logging in again', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }],
      hikke: {
        hikkeToken: 'current-token',
        cookies: [{ name: 'session', value: 'current', domain: 'hikke.hikvision.com.cn' }],
        userInfo: { displayName: 'Alice' },
        password: encryptPassword('secret'),
      },
    });
    vi.mocked(hikkeValidate).mockResolvedValue({ ok: true });

    await expect(ensureHikkeSession(dataDir)).resolves.toEqual({
      hikkeToken: 'current-token',
      cookies: [{ name: 'session', value: 'current', domain: 'hikke.hikvision.com.cn' }],
      userInfo: { displayName: 'Alice' },
    });
    expect(hikkeValidate).toHaveBeenCalledTimes(1);
    expect(hikkeLogin).not.toHaveBeenCalled();
  });

  it('relogs into Hikke and refreshes the stored session after validation fails', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }],
      hikke: {
        hikkeToken: 'stale-token',
        cookies: [{ name: 'session', value: 'stale', domain: 'hikke.hikvision.com.cn' }],
        userInfo: {},
        password: encryptPassword('secret'),
      },
    });
    vi.mocked(hikkeValidate).mockResolvedValue({ ok: false });
    vi.mocked(hdwPost).mockResolvedValue({ password: 'secret' });
    vi.mocked(hikkeLogin).mockResolvedValue({
      ok: true,
      username: 'alice',
      hikkeToken: 'fresh-token',
      testToken: 'fresh-test-token',
      userInfo: { displayName: 'Alice' },
      cookies: [{ name: 'session', value: 'fresh', domain: 'hikke.hikvision.com.cn' }],
      loginAt: 2,
    });

    await expect(ensureHikkeSession(dataDir)).resolves.toMatchObject({ hikkeToken: 'fresh-token' });
    expect(hdwPost).toHaveBeenCalledWith(
      '/auth/sso-credential/decrypt',
      {
        username: 'alice',
        ciphertext: expect.any(String),
        oa_cookies: [{ name: 'oa', value: 'opaque' }],
      },
      undefined,
      { throwOnError: true },
    );
    expect(hikkeLogin).toHaveBeenCalledWith('alice', 'secret');
    expect(readSsoConfigFile(dataDir)?.hikke).toMatchObject({
      hikkeToken: 'fresh-token',
      testToken: 'fresh-test-token',
      cookies: [{ name: 'session', value: 'fresh' }],
    });
  });

  it('does not attempt Hikke login without a deferred password', async () => {
    writeSsoConfigFile(dataDir, { username: 'alice', cookies: [] });
    vi.mocked(hikkeValidate).mockResolvedValue({ ok: false });

    await expect(ensureHikkeSession(dataDir)).resolves.toBeNull();
    expect(hikkeLogin).not.toHaveBeenCalled();
  });

  it('uses valid UEDRO cookies without logging in again', async () => {
    const cookies = [{ name: 'EPORTAL_JSESSIONID', value: 'current', domain: 'uedro.hikvision.com.cn' }];
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }],
      uedro: { cookies, password: encryptPassword('secret') },
    });
    vi.mocked(uedroValidate).mockResolvedValue({ ok: true });

    await expect(ensureUedroSession(dataDir)).resolves.toEqual(cookies);
    expect(uedroValidate).toHaveBeenCalledTimes(1);
    expect(uedroLogin).not.toHaveBeenCalled();
  });

  it('relogs into UEDRO and refreshes the stored session after validation fails', async () => {
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [],
      uedro: {
        cookies: [{ name: 'EPORTAL_JSESSIONID', value: 'stale', domain: 'uedro.hikvision.com.cn' }],
        password: encryptPassword('secret'),
      },
    });
    vi.mocked(uedroValidate).mockResolvedValue({ ok: false });
    vi.mocked(hdwPost).mockResolvedValue({ password: 'secret' });
    vi.mocked(uedroLogin).mockResolvedValue({
      ok: true,
      username: 'alice',
      userInfo: { displayName: 'Alice' },
      cookies: [{ name: 'EPORTAL_JSESSIONID', value: 'fresh', domain: 'uedro.hikvision.com.cn' }],
    });

    await expect(ensureUedroSession(dataDir)).resolves.toEqual([
      { name: 'EPORTAL_JSESSIONID', value: 'fresh' },
    ]);
    expect(uedroLogin).toHaveBeenCalledWith('alice', 'secret');
    expect(readSsoConfigFile(dataDir)?.uedro).toMatchObject({
      cookies: [{ name: 'EPORTAL_JSESSIONID', value: 'fresh' }],
    });
  });

  it('does not attempt UEDRO login without a deferred password', async () => {
    writeSsoConfigFile(dataDir, { username: 'alice', cookies: [] });

    await expect(ensureUedroSession(dataDir)).resolves.toBeNull();
    expect(uedroValidate).not.toHaveBeenCalled();
    expect(uedroLogin).not.toHaveBeenCalled();
  });
});
