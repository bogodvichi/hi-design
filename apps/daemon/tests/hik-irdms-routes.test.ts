import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { Cookie } from '../src/http/http.js';
import { registerHikIrdmsRoutes } from '../src/routes/hik/_routes/irdms.js';

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  writeSession: vi.fn(),
  rawRequest: vi.fn(),
}));

vi.mock('../src/http/hik_logins/hicoo.js', async (original) => ({
  ...await original<object>(),
  readSsoConfigFile: mocks.readSession,
  writeSsoConfigFile: mocks.writeSession,
}));
vi.mock('../src/http/http.js', async (original) => ({
  ...await original<object>(),
  rawRequest: mocks.rawRequest,
}));

const dataDir = '/tmp/hik-irdms-test';
const ssoCookie: Cookie = { name: 'CASTGC', value: 'ticket-granting-ticket', domain: 'sso.hikvision.com' };
const irdmsCookie: Cookie = { name: 'linkserver_session', value: 'session-1', domain: 'irdmspro.hikvision.com.cn' };
const refreshedCookie: Cookie = { name: 'linkserver_session', value: 'session-2', domain: 'irdmspro.hikvision.com.cn' };

const ssoSession = (cookies: Cookie[] = [ssoCookie], irdms?: Cookie[]) => ({
  username: 'alice',
  cookies,
  ...(irdms ? { irdms: { cookies: irdms, loginAt: 1 } } : {}),
});

const casResult = (cookies: Cookie[]) => ({
  status: 200,
  body: '',
  finalUrl: 'https://irdmspro.hikvision.com.cn/webApi/irdms-basic-web/user/getCurrentUserInfo',
  headers: { 'content-type': 'text/html' },
  cookies,
});

const upstreamResult = (body: string, contentType = 'application/json') => ({
  status: 200,
  body,
  finalUrl: 'https://irdmspro.hikvision.com.cn/webApi/irdms-basic-web/user/getCurrentUserInfo',
  headers: { 'content-type': contentType },
  cookies: [],
});

let server: Server;
let base: string;

beforeEach(async () => {
  mocks.readSession.mockReset().mockReturnValue(ssoSession());
  mocks.writeSession.mockReset();
  mocks.rawRequest.mockReset();

  const app = express();
  app.use(express.json());
  registerHikIrdmsRoutes(app, {
    dataDir,
    sendApiError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((done, reject) => {
    server.once('listening', done);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

describe('IRDMS routes use the shared CAS-backed session', () => {
  it('establishes a cold-start session through hicoo SSO before calling the probe', async () => {
    mocks.rawRequest
      .mockResolvedValueOnce(casResult([irdmsCookie]))
      .mockResolvedValueOnce(upstreamResult(JSON.stringify({ username: 'alice', empid: 'HZ00000001' })))
      .mockResolvedValueOnce(upstreamResult(JSON.stringify({ success: true, data: { username: 'alice' } })));

    const response = await fetch(`${base}/api/hik/irdms/test`);
    const payload = await response.json() as any;

    expect(payload.ok).toBe(true);
    expect(payload.status).toBe(200);
    expect(payload.body).toEqual({ success: true, data: { username: 'alice' } });
    expect(mocks.rawRequest).toHaveBeenCalledTimes(3);
    expect(mocks.rawRequest.mock.calls[0]![0]).toBe('GET');
    expect(mocks.rawRequest.mock.calls[0]![1]).toContain('https://sso.hikvision.com/login?service=');
    expect(mocks.rawRequest.mock.calls[0]![2]).toEqual([ssoCookie]);
    expect(mocks.rawRequest.mock.calls[2]).toEqual([
      'GET',
      expect.stringContaining('/webApi/irdms-basic-web/user/getCurrentUserInfo?_t='),
      [],
      { extraHeaders: expect.objectContaining({ Cookie: 'linkserver_session=session-1' }) },
    ]);
    expect(mocks.writeSession).toHaveBeenCalledWith(
      dataDir,
      expect.objectContaining({
        irdms: {
          cookies: [irdmsCookie],
          useInfo: { username: 'alice', empid: 'HZ00000001' },
          loginAt: expect.any(Number),
        },
      }),
    );
  });

  it('reuses cached IRDMS cookies without contacting CAS again', async () => {
    mocks.readSession.mockReturnValue(ssoSession([ssoCookie], [irdmsCookie]));
    mocks.rawRequest.mockResolvedValueOnce(upstreamResult(JSON.stringify({ success: true })));

    const response = await fetch(`${base}/api/hik/irdms/test`);
    const payload = await response.json() as any;

    expect(payload.ok).toBe(true);
    expect(mocks.rawRequest).toHaveBeenCalledTimes(1);
    expect(mocks.writeSession).not.toHaveBeenCalled();
  });

  it('returns non-JSON bodies verbatim when the upstream did not redirect to SSO', async () => {
    mocks.readSession.mockReturnValue(ssoSession([ssoCookie], [irdmsCookie]));
    mocks.rawRequest.mockResolvedValueOnce(upstreamResult('<html>gateway error</html>', 'text/html'));

    const response = await fetch(`${base}/api/hik/irdms/test`);
    const payload = await response.json() as any;

    expect(payload.ok).toBe(true);
    expect(payload.isJson).toBe(false);
    expect(payload.body).toBe('<html>gateway error</html>');
  });

  it('rejects the probe with 401 when the hicoo session has no cookies', async () => {
    mocks.readSession.mockReturnValue(ssoSession([]));
    const response = await fetch(`${base}/api/hik/irdms/test`);

    expect(response.status).toBe(401);
    expect(mocks.rawRequest).not.toHaveBeenCalled();
    expect(mocks.writeSession).not.toHaveBeenCalled();
  });

  it('forwards projectList with defaults derived from the caller body', async () => {
    mocks.rawRequest
      .mockResolvedValueOnce(casResult([irdmsCookie]))
      .mockResolvedValueOnce(upstreamResult(JSON.stringify({ username: 'alice' })))
      .mockResolvedValueOnce(upstreamResult(JSON.stringify({
        code: '0',
        msg: '调用成功',
        data: { rows: [{ projNum: 'PJ03TD20261009299' }], total: 1 },
      })));

    const response = await fetch(`${base}/api/hik/irdms/projectList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depts: '038546', page: 2, rows: 10 }),
    });
    const payload = await response.json() as any;
    const call = mocks.rawRequest.mock.calls[2]!;
    const sent = JSON.parse(call[3]!.body as string) as Record<string, unknown>;

    expect(payload.ok).toBe(true);
    expect(payload.msg).toBe('调用成功');
    expect(payload.data.rows).toEqual([{ projNum: 'PJ03TD20261009299' }]);
    expect(call[0]).toBe('POST');
    expect(call[3]!.extraHeaders).toEqual(expect.objectContaining({ Cookie: 'linkserver_session=session-1' }));
    expect(sent.depts).toBe('038546');
    expect(sent.page).toBe(2);
    expect(sent.rows).toBe(10);
    expect(sent.belongTo).toBe('pm_proList');
    expect(sent.projType).toBe('PD,TD,PM,TM,PC,PI,PO,PR,PB,SD,SC,BT_PROJECT,IT_PROJECT,PZ,BI_PROJECT,PJ,PL,MR,SP');
    expect(sent.status).toBe('INP');
    expect(sent.projScope).toBe('');
    expect(sent.detailStatus).toBe('NORMAL,RISK,DELAY');
    expect(typeof sent.week).toBe('number');
    expect(sent.time).toMatch(/^\d{4}-\d{1,2}$/);
  });

  it('refreshes the session and retries projectList once when upstream returns an SSO redirect', async () => {
    mocks.readSession.mockReturnValue(ssoSession([ssoCookie], [irdmsCookie]));
    mocks.rawRequest
      .mockResolvedValueOnce(upstreamResult(
        '<script>window.location.href = "https://sso.hikvision.com/login?service=x"</script>',
        'text/html',
      ))
      .mockResolvedValueOnce(casResult([refreshedCookie]))
      .mockResolvedValueOnce(upstreamResult(JSON.stringify({ username: 'alice' })))
      .mockResolvedValueOnce(upstreamResult(JSON.stringify({ code: '0', msg: '调用成功', data: { total: 25 } })));

    const response = await fetch(`${base}/api/hik/irdms/projectList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const payload = await response.json() as any;

    expect(payload.ok).toBe(true);
    expect(payload.data.total).toBe(25);
    expect(mocks.rawRequest).toHaveBeenCalledTimes(4);
    expect(mocks.rawRequest.mock.calls[1]![0]).toBe('GET');
    expect(mocks.rawRequest.mock.calls[3]![3]!.extraHeaders).toEqual(
      expect.objectContaining({ Cookie: 'linkserver_session=session-2' }),
    );
    expect(mocks.writeSession).toHaveBeenCalledWith(
      dataDir,
      expect.objectContaining({
        irdms: {
          cookies: [refreshedCookie],
          useInfo: { username: 'alice' },
          loginAt: expect.any(Number),
        },
      }),
    );
  });

  it('passes through upstream rejections from projectList', async () => {
    mocks.readSession.mockReturnValue(ssoSession([ssoCookie], [irdmsCookie]));
    mocks.rawRequest.mockResolvedValueOnce(upstreamResult(JSON.stringify({ code: '1', msg: '系统异常' })));

    const response = await fetch(`${base}/api/hik/irdms/projectList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const payload = await response.json() as any;

    expect(payload.ok).toBe(false);
    expect(payload.msg).toBe('系统异常');
  });

  it('rejects projectList with 401 when the hicoo session has no cookies', async () => {
    mocks.readSession.mockReturnValue(ssoSession([]));
    const response = await fetch(`${base}/api/hik/irdms/projectList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(401);
    expect(mocks.rawRequest).not.toHaveBeenCalled();
    expect(mocks.writeSession).not.toHaveBeenCalled();
  });
});
