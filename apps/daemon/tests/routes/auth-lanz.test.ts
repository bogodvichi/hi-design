import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerLanzAccountRoutes } from '../../src/routes/auth-lanz.js';
import type { LanzAccountResponse } from '@open-design/contracts';

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});
async function serve(result: LanzAccountResponse, allowed = true) {
  const load = vi.fn(async () => result);
  const app = express();
  app.use(express.json());
  registerLanzAccountRoutes(app, {
    paths: { RUNTIME_DATA_DIR: '/unused' },
    http: { requireLocalDaemonRequest: (_req, res, next) =>
      allowed ? next() : res.status(403).end() },
    lanzAccountService: { load },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const response = await fetch('http://127.0.0.1:' + address.port + '/api/auth/lanz', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedUsername: 'alice' }),
  });
  return { response, load };
}
describe('POST /api/auth/lanz', () => {
  it('requires the local-daemon guard before attempting credential retrieval', async () => {
    const { response, load } = await serve({ ok: false, kind: 'unavailable' }, false);
    expect(response.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });
  it('binds the request to the expected account and disables response caching', async () => {
    const result = { ok: true as const, username: 'alice', apiKey: 'test-key',
      baseUrl: 'http://lanz.hikvision.com/v3/openai/model', defaultModel: 'EB-DeepSeek-Flash' };
    const { response, load } = await serve(result);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(load).toHaveBeenCalledWith('alice');
    expect(await response.json()).toEqual(result);
  });
  it.each([
    ['not_signed_in', 401], ['session_expired', 401],
    ['account_mismatch', 409], ['key_unavailable', 502], ['unavailable', 502],
  ] as const)('reports %s without a credential payload', async (kind, status) => {
    const { response } = await serve({ ok: false, kind });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, kind });
  });
});
