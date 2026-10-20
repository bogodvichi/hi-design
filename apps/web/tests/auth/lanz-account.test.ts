import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLanzAccount } from '../../src/auth/lanz-account';

afterEach(() => vi.unstubAllGlobals());
const data = { ok: true, username: 'alice', apiKey: 'test-key' };
describe('loadLanzAccount', () => {
  it('requests only the signed-in account after login', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(data)));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    expect(await loadLanzAccount('alice', controller.signal)).toMatchObject(data);
    expect(fetch).toHaveBeenCalledWith('/api/auth/lanz', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ expectedUsername: 'alice' }), cache: 'no-store',
    }));
  });
  it.each([
    { ...data, username: 'bob' },
    { ...data, apiKey: '' },
    { ok: false, kind: 'session_expired' },
  ])('does not accept a missing or mismatched credential', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))));
    expect(await loadLanzAccount('alice', new AbortController().signal)).toBeNull();
  });
  it('ignores a response that arrives after logout or account replacement', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      return new Response(JSON.stringify(data));
    }));
    expect(await loadLanzAccount('alice', controller.signal)).toBeNull();
  });
  it('keeps manual setup usable when Lanz is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await loadLanzAccount('alice', new AbortController().signal)).toBeNull();
  });
});
