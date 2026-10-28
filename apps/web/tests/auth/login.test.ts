import { afterEach, expect, it, vi } from 'vitest';
import { login } from '../../src/auth/auth';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { status: 401, error: 'invalid-credentials' },
  { status: 502, error: 'unavailable' },
])('maps HTTP $status to the correct login UI error', async ({ status, error }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'unused' } }), { status })));
  await expect(login('synthetic-user', 'synthetic-password', false)).resolves.toEqual({ ok: false, error });
});
