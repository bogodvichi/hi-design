import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/connectionTest.js', () => ({
  validateUserProviderBaseUrl: vi.fn(async (baseUrl: string) => ({ parsed: new URL(baseUrl) })),
  redactSecrets: (detail: string) => detail,
}));

import { listProviderModels } from '../../src/integrations/provider-models.js';

afterEach(() => vi.unstubAllGlobals());

describe('Lanz model catalogue fallback', () => {
  const input = {
    protocol: 'openai' as const,
    baseUrl: 'http://lanz.hikvision.com/v3/openai/model',
    apiKey: 'test-key',
  };

  it('offers the configured default when the official gateway has no models route', async () => {
    const fetchMock = vi.fn(async () => new Response('404 page not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listProviderModels(input);

    expect(result).toMatchObject({
      ok: true,
      kind: 'success',
      models: [{ id: 'EB-DeepSeek-Flash', label: 'EB-DeepSeek-Flash' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://lanz.hikvision.com/v3/openai/model/models',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });

  it.each([401, 403])('preserves authentication or permission failures (HTTP %i)', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Access denied', { status })));

    const result = await listProviderModels(input);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(status);
    expect(result.models).toBeUndefined();
  });

  it.each([
    'http://lanz.hikvision.com.example.org/v3/openai/model',
    'http://lanz.hikvision.com/incorrect/path',
  ])('does not hide a missing endpoint on %s', async (baseUrl) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));

    expect(await listProviderModels({ ...input, baseUrl })).toMatchObject({
      ok: false,
      kind: 'invalid_base_url',
      status: 404,
    });
  });
});
