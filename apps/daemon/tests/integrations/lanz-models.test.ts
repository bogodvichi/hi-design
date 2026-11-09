import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/connectionTest.js', () => ({
  validateUserProviderBaseUrl: vi.fn(async (baseUrl: string) => ({ parsed: new URL(baseUrl) })),
  redactSecrets: (detail: string) => detail,
}));
vi.mock('../../src/integrations/lanz-account.js', async (original) => ({
  ...await original<typeof import('../../src/integrations/lanz-account.js')>(),
  fetchLanzModels: vi.fn(),
}));

import { listProviderModels } from '../../src/integrations/provider-models.js';
import { fetchLanzModels, LanzAccountError } from '../../src/integrations/lanz-account.js';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('Lanz account model discovery', () => {
  const input = {
    protocol: 'openai' as const,
    baseUrl: 'http://lanz.hikvision.com/v3/openai/model',
    apiKey: 'test-key',
    lanzSession: { username: 'alice', cookies: [], loginAt: 1 },
  };

  it('uses the signed-in account catalogue instead of a fixed gateway fallback', async () => {
    const models = [{ id: 'Lanz-Auto', label: 'Lanz-Auto' }, { id: 'EB-G61', label: 'EB-G61' }];
    vi.mocked(fetchLanzModels).mockResolvedValue(models);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await listProviderModels(input)).toMatchObject({ ok: true, kind: 'success', models });
    expect(fetchLanzModels).toHaveBeenCalledWith(input.lanzSession, undefined, expect.any(AbortSignal));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a signed-in account', async () => {
    expect(await listProviderModels({ ...input, lanzSession: null })).toMatchObject({ ok: false, kind: 'auth_failed' });
    expect(fetchLanzModels).not.toHaveBeenCalled();
  });

  it.each(['account_mismatch', 'session_expired', 'unavailable'] as const)('surfaces %s without inventing models', async (kind) => {
    vi.mocked(fetchLanzModels).mockRejectedValue(new LanzAccountError(kind));
    const result = await listProviderModels(input);
    expect(result.ok).toBe(false);
    expect(result.models).toBeUndefined();
  });

  it('reports an empty catalogue', async () => {
    vi.mocked(fetchLanzModels).mockResolvedValue([]);
    expect(await listProviderModels(input)).toMatchObject({ ok: false, kind: 'no_models', models: [] });
  });

  it.each([
    'http://lanz.hikvision.com.example.org/v3/openai/model',
    'http://lanz.hikvision.com/incorrect/path',
  ])('uses ordinary discovery for %s', async (baseUrl) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    expect(await listProviderModels({ ...input, baseUrl })).toMatchObject({ ok: false, kind: 'invalid_base_url', status: 404 });
    expect(fetchLanzModels).not.toHaveBeenCalled();
  });
});
