import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { registerHikUedroRoutes } from '../src/routes/hik/_routes/uedro.js';

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), rawRequest: vi.fn() }));
vi.mock('../src/http/hik_logins/hicoo.js', async (original) => ({ ...await original<object>(), readSsoConfigFile: mocks.readSession }));
vi.mock('../src/http/http.js', async (original) => ({ ...await original<object>(), rawRequest: mocks.rawRequest }));
const session = (username = 'alice') => ({ username, cookies: [{ name: 'oa', value: 'secret' }], uedro: { cookies: [{ name: 'session', value: 'secret' }] } });
let server: Server;
let base: string;
beforeEach(async () => {
  mocks.readSession.mockReset().mockReturnValue(session());
  mocks.rawRequest.mockReset().mockResolvedValue({ body: JSON.stringify({ code: '0', data: { list: [] } }) });
  const app = express();
  app.use(express.json());
  registerHikUedroRoutes(app, { dataDir: '/unused', sendApiError: (res, status, code, message) => res.status(status).json({ error: { code, message } }) });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((done, reject) => { server.once('listening', done); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { if (server?.listening) await new Promise<void>((done) => server.close(() => done())); });
const search = (extra: object = { expectedUsername: 'alice' }) => fetch(`${base}/api/hik/uedro/userList`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: '张三', pageNo: 1, pageSize: 30, ...extra }),
});

describe('identity-bound directory lookup', () => {
  it('uses daemon cookies and does not forward the identity guard upstream', async () => {
    const response = await search();
    expect(await response.json()).toEqual({ ok: true, data: { list: [] } });
    expect(mocks.rawRequest).toHaveBeenCalledWith('POST', expect.any(String), session().uedro.cookies, expect.objectContaining({ body: JSON.stringify({ userName: '张三', pageNo: 1, pageSize: 30 }) }));
  });
  it('preserves existing callers without an identity guard', async () => { expect((await search({})).status).toBe(200); });
  it('rejects a different OA user before contacting upstream', async () => {
    mocks.readSession.mockReturnValue(session('bob'));
    expect((await search()).status).toBe(401);
    expect(mocks.rawRequest).not.toHaveBeenCalled();
  });
  it('rejects a session with no OA cookies', async () => {
    mocks.readSession.mockReturnValue({ ...session(), cookies: [] });
    expect((await search()).status).toBe(401);
    expect(mocks.rawRequest).not.toHaveBeenCalled();
  });
  it.each(['', 123, null])('rejects an invalid identity guard %j', async (expectedUsername) => {
    expect((await search({ expectedUsername })).status).toBe(400);
    expect(mocks.rawRequest).not.toHaveBeenCalled();
  });
  it.each([null, session('bob'), { username: 'alice', uedro: { cookies: [] } }])('discards results after the session changes or expires', async (next) => {
    mocks.rawRequest.mockImplementation(async () => {
      mocks.readSession.mockReturnValue(next);
      return { body: JSON.stringify({ code: '0', data: { list: [{ email: 'private@hikvision.com' }] } }) };
    });
    const response = await search();
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain('private@hikvision.com');
  });
});
