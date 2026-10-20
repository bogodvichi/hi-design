import { describe, expect, it, vi } from 'vitest';
import {
  fetchLanzAccount, LanzAccountService,
  type LanzHttpResponse, type LanzRequest,
} from '../../src/integrations/lanz-account.js';
import type { SsoSession } from '../../src/http/hik_logins/hicoo.js';

const session = (username = 'alice'): SsoSession => ({
  username, loginAt: 1,
  cookies: [{ name: 'sso', value: 'test-session', domain: 'sso.hikvision.com' }],
});
const credentials = (username = 'alice') => ({
  ok: true as const, username, apiKey: 'test-account-key',
  baseUrl: 'http://lanz.hikvision.com/v3/openai/model', defaultModel: 'EB-DeepSeek-Flash',
});
const response = (data: unknown): LanzHttpResponse => ({
  status: 200, setCookies: [], body: JSON.stringify({ code: 2001, data }),
});
function portalRequest(profile = 'alice', key: unknown = 'test-account-key') {
  const request = vi.fn<LanzRequest>(async (url) => {
    if (url.endsWith('/v1/user/m')) return response({ pinyin: profile });
    if (url.endsWith('/v1/openai/token/create')) return response(key);
    return { status: 200, setCookies: [], body: '<html>portal</html>' };
  });
  return request;
}

describe('Lanz account bootstrap', () => {
  it('follows SSO and reads the stable account Key without model-specific credentials', async () => {
    const api = portalRequest();
    let visits = 0;
    const request = vi.fn<LanzRequest>(async (url, jar, signal, signed) => {
      if (url === 'https://lanz.hikvision.com/' && visits++ === 0) {
        return { status: 302, location: 'https://sso.hikvision.com/302', setCookies: [], body: '' };
      }
      if (url === 'https://sso.hikvision.com/302') {
        return { status: 302, location: 'https://lanz.hikvision.com/', setCookies: [], body: '' };
      }
      return api(url, jar, signal, signed);
    });
    await expect(fetchLanzAccount(session(), request)).resolves.toEqual(credentials());
    expect(api.mock.calls.filter((call) => call[3]).map((call) => call[0])).toEqual([
      'https://lanz.hikvision.com/v1/user/m',
      'https://lanz.hikvision.com/v1/openai/token/create',
    ]);
  });

  it('rejects a different portal account before reading its Key', async () => {
    const request = portalRequest('bob');
    await expect(fetchLanzAccount(session(), request)).rejects.toMatchObject({ kind: 'account_mismatch' });
    expect(request.mock.calls.some(([url]) => url.includes('/token/'))).toBe(false);
  });

  it('rejects an expired session and an empty Key', async () => {
    const expired: LanzRequest = async () => ({
      status: 200, setCookies: [], body: '<html>login</html>', location: undefined,
    });
    // A login page cannot satisfy the signed profile request.
    await expect(fetchLanzAccount(session(), expired)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(fetchLanzAccount(session(), portalRequest('alice', ' ')))
      .rejects.toMatchObject({ kind: 'key_unavailable' });
  });

  it('never follows an untrusted redirect with the OA cookies', async () => {
    const request = vi.fn<LanzRequest>(async () => ({
      status: 302, location: 'https://untrusted.example/login', setCookies: [], body: '',
    }));
    await expect(fetchLanzAccount(session(), request)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('LanzAccountService', () => {
  it('deduplicates login bootstrap and caches only the current session', async () => {
    let current: SsoSession | null = session();
    let now = 100;
    const fetchAccount = vi.fn(async (value: SsoSession) => credentials(value.username));
    const service = new LanzAccountService('/unused', { readSession: () => current, fetchAccount, now: () => now });
    await Promise.all([service.load('alice'), service.load('alice')]);
    await service.load('alice');
    expect(fetchAccount).toHaveBeenCalledTimes(1);
    now += 5 * 60 * 1000 + 1;
    await service.load('alice');
    expect(fetchAccount).toHaveBeenCalledTimes(2);
    current = session('bob');
    await expect(service.load('alice')).resolves.toEqual({ ok: false, kind: 'account_mismatch' });
    await expect(service.load('bob')).resolves.toEqual(credentials('bob'));
    current = null;
    await expect(service.load()).resolves.toEqual({ ok: false, kind: 'not_signed_in' });
  });

  it.each(['logout', 'account change'])('discards a late Key after %s', async (transition) => {
    let current: SsoSession | null = session();
    let finish!: (value: ReturnType<typeof credentials>) => void;
    const fetchAccount = vi.fn(() => new Promise<ReturnType<typeof credentials>>((resolve) => { finish = resolve; }));
    const service = new LanzAccountService('/unused', { readSession: () => current, fetchAccount });
    const pending = service.load('alice');
    current = transition === 'logout' ? null : session('bob');
    finish(credentials());
    await expect(pending).resolves.toEqual({ ok: false, kind: 'account_mismatch' });
  });

  it('returns a bounded error without upstream diagnostics or credential values', async () => {
    const service = new LanzAccountService('/unused', {
      readSession: () => session(),
      fetchAccount: async () => { throw new Error('upstream secret test-account-key'); },
    });
    await expect(service.load('alice')).resolves.toEqual({ ok: false, kind: 'unavailable' });
  });
});
