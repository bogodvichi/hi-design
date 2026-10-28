import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rawRequest, type RawResult } from '../../src/http/http.js';
import { hikkeLogin } from '../../src/http/hik_logins/hikke.js';
import { hicooLogin } from '../../src/http/hik_logins/hicoo.js';
import { uedroLogin } from '../../src/http/hik_logins/uedro.js';

vi.mock('../../src/http/http.js', () => ({ rawRequest: vi.fn() }));

const request = vi.mocked(rawRequest);
const publicKey = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey
  .export({ type: 'spki', format: 'der' }).toString('base64');
const loginPage = '<input name="lt" value="test"><input name="execution" value="test">';

function response(body: unknown, status = 200): RawResult {
  return {
    status,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    cookies: [],
    finalUrl: 'https://sso.hikvision.com.cn/login',
  };
}

const platforms = [
  {
    name: 'hikke', login: hikkeLogin,
    prepare: () => {},
    rejection: { errcode: 40020, errmsg: '用户名或密码错误' },
  },
  {
    name: 'hicoo', login: hicooLogin,
    prepare: () => { request.mockResolvedValueOnce(response(loginPage)); },
    rejection: `${loginPage}<span id="msg">用户名或密码不正确，输错超过3次账号将被锁定</span>`,
  },
  {
    name: 'uedro', login: uedroLogin,
    prepare: () => { request.mockResolvedValueOnce(response({ code: '0', data: { publicKey } })); },
    rejection: { code: '0xb5e15000', msg: '登录失败' },
  },
];

beforeEach(() => { request.mockReset(); });

describe.each(platforms)('$name login error classification', ({ name, login, prepare, rejection }) => {
  it('classifies the observed credential rejection as 401', async () => {
    prepare();
    request.mockResolvedValueOnce(response(rejection));
    await expect(login('synthetic-user', 'synthetic-password')).rejects.toMatchObject({
      platform: name, status: 401, code: 'UNAUTHORIZED',
    });
  });

  it('classifies HTTP 401 during credential submission as 401', async () => {
    prepare();
    request.mockResolvedValueOnce(response('', 401));
    await expect(login('synthetic-user', 'synthetic-password')).rejects.toMatchObject({
      status: 401, code: 'UNAUTHORIZED',
    });
  });

  it.each([503, 429])('classifies HTTP %s as an upstream failure', async (status) => {
    prepare();
    request.mockResolvedValueOnce(response(rejection, status));
    await expect(login('synthetic-user', 'synthetic-password')).rejects.toMatchObject({
      status: 502, code: 'BAD_GATEWAY',
    });
  });

  it('does not mistake a malformed successful response for invalid credentials', async () => {
    prepare();
    request.mockResolvedValueOnce(response('<html>upstream maintenance</html>'));
    await expect(login('synthetic-user', 'synthetic-password')).rejects.toMatchObject({
      status: 502, code: 'BAD_GATEWAY',
    });
  });

  it('normalizes connection errors without exposing upstream details', async () => {
    request.mockRejectedValueOnce(new Error('connection failed: synthetic-password'));
    await expect(login('synthetic-user', 'synthetic-password')).rejects.toMatchObject({
      platform: name, status: 502, code: 'BAD_GATEWAY', message: `${name} login unavailable`,
    });
  });
});

it.each([hicooLogin, uedroLogin])('treats an unavailable login bootstrap as 502', async (login) => {
  request.mockResolvedValueOnce(response('', 401));
  await expect(login('synthetic-user', 'synthetic-password')).rejects.toMatchObject({ status: 502 });
});

it('treats missing SSO form fields as 502', async () => {
  request.mockResolvedValueOnce(response('<html>maintenance</html>'));
  await expect(hicooLogin('synthetic-user', 'synthetic-password')).rejects.toMatchObject({ status: 502 });
});

it.each([
  { errcode: 500, errmsg: '系统异常' },
  { code: 500, msg: '系统异常' },
  { success: false, message: '系统异常' },
])('does not classify unknown Hikke business failures as bad credentials', async (body) => {
  request.mockResolvedValueOnce(response(body));
  await expect(hikkeLogin('synthetic-user', 'synthetic-password')).rejects.toMatchObject({ status: 502 });
});

it('recognizes a Hikke credential code even with a failure flag', async () => {
  request.mockResolvedValueOnce(response({ success: false, code: 401, message: 'rejected' }));
  await expect(hikkeLogin('synthetic-user', 'synthetic-password')).rejects.toMatchObject({ status: 401 });
});

it('does not classify unknown Uedro business failures as bad credentials', async () => {
  platforms[2]!.prepare();
  request.mockResolvedValueOnce(response({ code: 'unknown', msg: '系统异常' }));
  await expect(uedroLogin('synthetic-user', 'synthetic-password')).rejects.toMatchObject({ status: 502 });
});

it('keeps Hikke token/profile failures distinct from credential rejection', async () => {
  request.mockResolvedValueOnce(response({ errcode: 0, data: { hikkeToken: 'synthetic-token' } }));
  request.mockResolvedValueOnce(response('', 401));
  await expect(hikkeLogin('synthetic-user', 'synthetic-password')).rejects.toMatchObject({ status: 502 });
});

it('keeps successful Hikke login and profile initialization working', async () => {
  request.mockResolvedValueOnce(response({ errcode: 0, data: { hikkeToken: 'synthetic-token', testToken: 'synthetic-test' } }));
  request.mockResolvedValueOnce(response({ code: 0, data: { loginName: 'synthetic-user', name: 'Synthetic' } }));
  await expect(hikkeLogin('synthetic-user', 'synthetic-password')).resolves.toMatchObject({
    ok: true, username: 'synthetic-user', userInfo: { displayName: 'Synthetic' },
  });
});

it('keeps successful SSO login working', async () => {
  platforms[1]!.prepare();
  request.mockResolvedValueOnce({ ...response(''), cookies: [
    { name: 'JwtToken', value: 'synthetic-jwt', domain: 'sso.hikvision.com.cn' },
    { name: 'LtpaToken', value: 'synthetic-ltpa', domain: 'sso.hikvision.com.cn' },
  ] });
  request.mockResolvedValueOnce(response({ data: { displayName: 'Synthetic' } }));
  await expect(hicooLogin('synthetic-user', 'synthetic-password')).resolves.toMatchObject({ ok: true });
});

it('keeps successful Uedro login working', async () => {
  platforms[2]!.prepare();
  request.mockResolvedValueOnce(response({ code: '0', data: 'https://uedro.hikvision.com.cn/bic/ssoService/v1/tokenLogin' }));
  request.mockResolvedValueOnce(response(''));
  request.mockResolvedValueOnce(response({ code: '0', data: { name: 'Synthetic' } }));
  await expect(uedroLogin('synthetic-user', 'synthetic-password')).resolves.toMatchObject({
    ok: true, userInfo: { displayName: 'Synthetic' },
  });
});
