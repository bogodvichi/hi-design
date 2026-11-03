import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rawRequest, type RawResult } from '../../src/http/http.js';
import { hicooValidate, type SsoSession } from '../../src/http/hik_logins/hicoo.js';

vi.mock('../../src/http/http.js', () => ({ rawRequest: vi.fn() }));

const request = vi.mocked(rawRequest);
function session(expiresIn = 3600): SsoSession {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresIn })).toString('base64url');
  return {
    username: 'synthetic-user',
    cookies: [{ name: 'JwtToken', value: `header.${payload}.signature`, domain: 'hicoo.hikvision.com.cn' }],
    userInfo: { username: 'synthetic-user', displayName: 'Cached', avatarUrl: 'https://example.test/avatar.png' },
  };
}
function response(body: unknown, status = 200): RawResult {
  return {
    status, body: JSON.stringify(body), cookies: [],
    finalUrl: 'http://hicoo.hikvision.com.cn/ai/gateway/user/userService/v1/user/casInfo/query',
  };
}
beforeEach(() => request.mockReset());

describe('OA session verification', () => {
  it('rejects an expired JWT even when cached user info exists', async () => {
    await expect(hicooValidate(session(-1), '')).resolves.toMatchObject({ ok: false, isValid: false });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not accept cached user info without OA cookies', async () => {
    await expect(hicooValidate({ username: 'synthetic-user', userInfo: { displayName: 'Cached' } }, '')).resolves.toMatchObject({ ok: false });
  });

  it.each([401, 403])('rejects an upstream HTTP %s despite a locally unexpired JWT', async (status) => {
    request.mockResolvedValueOnce(response({}, status));
    await expect(hicooValidate(session(), '')).resolves.toMatchObject({ ok: false });
    expect(request).toHaveBeenCalledOnce();
  });

  it('verifies the OA identity and uses fresh profile data while retaining the avatar', async () => {
    request.mockResolvedValueOnce(response({ data: { userName: 'synthetic-user', displayName: 'Fresh' } }));
    await expect(hicooValidate(session(), '')).resolves.toMatchObject({
      ok: true, isValid: true, username: 'synthetic-user',
      userInfo: { displayName: 'Fresh', avatarUrl: 'https://example.test/avatar.png' },
    });
    expect(request).toHaveBeenCalledWith('GET', expect.stringContaining('/casInfo/query'), expect.any(Array), expect.any(Object));
  });

  it('rejects a provider identity belonging to another account', async () => {
    request.mockResolvedValueOnce(response({ data: { username: 'another-user' } }));
    await expect(hicooValidate(session(), '')).resolves.toMatchObject({ ok: false });
  });

  it('treats a login-page redirect as an expired session', async () => {
    request.mockResolvedValueOnce({ ...response({}), finalUrl: 'https://sso.hikvision.com.cn/login' });
    await expect(hicooValidate(session(), '')).resolves.toMatchObject({ ok: false });
  });

  it.each([
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve(response({}, 503)),
    () => Promise.resolve(response({})),
    () => Promise.resolve(response({ data: {} })),
    () => Promise.resolve({ ...response({}, 503), finalUrl: 'https://sso.hikvision.com.cn/login' }),
  ])('keeps transport and invalid-response failures distinct from expired credentials', async (upstream) => {
    request.mockImplementationOnce(upstream);
    await expect(hicooValidate(session(), '')).rejects.toThrow();
  });
});
