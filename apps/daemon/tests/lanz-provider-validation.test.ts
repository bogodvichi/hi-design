import { promises as dnsPromises } from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANZ_OPENAI_BASE_URL } from '@open-design/contracts';
import {
  assertExternalAssetUrl,
  testProviderConnection,
  validateUserProviderBaseUrl,
} from '../src/connectionTest.js';
import { listProviderModels } from '../src/integrations/provider-models.js';

describe('built-in Lanz provider network policy', () => {
  beforeEach(() => {
    vi.stubEnv('OD_ALLOWED_INTERNAL_HOSTS', undefined);
    vi.spyOn(dnsPromises, 'lookup').mockImplementation((async () => [
      { address: '10.1.67.77', family: 4 },
    ]) as unknown as typeof dnsPromises.lookup);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([undefined, ''])('allows Lanz with an unset or empty allowlist (%s)', async (value) => {
    vi.stubEnv('OD_ALLOWED_INTERNAL_HOSTS', value);
    expect(await validateUserProviderBaseUrl(LANZ_OPENAI_BASE_URL)).toMatchObject({
      parsed: { hostname: 'lanz.hikvision.com' },
    });
  });

  it('preserves the built-in provider when operators add another internal host', async () => {
    vi.stubEnv('OD_ALLOWED_INTERNAL_HOSTS', 'other.internal');
    expect((await validateUserProviderBaseUrl(LANZ_OPENAI_BASE_URL)).error).toBeUndefined();
    expect((await validateUserProviderBaseUrl('https://other.internal/v1')).error).toBeUndefined();
  });

  it.each([
    'http://10.1.67.77/v1',
    'https://other.internal/v1',
    'https://lanz.hikvision.com.example.org/v1',
    'https://sub.lanz.hikvision.com/v1',
  ])('still rejects untrusted private endpoints: %s', async (baseUrl) => {
    expect(await validateUserProviderBaseUrl(baseUrl)).toMatchObject({
      error: 'Internal IPs blocked', forbidden: true,
    });
  });

  it('keeps upstream asset URLs subject to the strict internal-address policy', async () => {
    expect(await assertExternalAssetUrl('http://lanz.hikvision.com/image.png')).toMatchObject({
      ok: false,
    });
  });

  it('lets model discovery reach Lanz without a local allowlist', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'EB-DeepSeek-Flash' }] }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await listProviderModels({
      protocol: 'openai', baseUrl: LANZ_OPENAI_BASE_URL, apiKey: 'test-key',
    })).toMatchObject({ ok: true, models: [{ id: 'EB-DeepSeek-Flash' }] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('lets connection testing reach Lanz without a local allowlist', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      choices: [{ message: { content: 'ok' } }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await testProviderConnection({
      protocol: 'openai', baseUrl: LANZ_OPENAI_BASE_URL,
      apiKey: 'test-key', model: 'EB-DeepSeek-Flash',
    })).toMatchObject({ ok: true, kind: 'success' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
