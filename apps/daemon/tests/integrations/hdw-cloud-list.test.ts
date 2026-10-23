import { describe, expect, it, vi } from 'vitest';
import { createHdwCloudClient } from '../../src/integrations/hdw-cloud.js';

function fixture(cloudFetch: typeof fetch) {
  return createHdwCloudClient({ config: { baseUrl: 'https://cloud.example', pathPrefix: '/hdw', token: null }, fetch: cloudFetch });
}

describe('HDW resource list transient errors', () => {
  it('retries an internal 500 once and returns the successful catalog', async () => {
    const cloudFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: 'internal_error', message: 'database query failed' }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ resources: [{ id: 'design-review' }] }));
    expect(await fixture(cloudFetch).listResources('workspace', 'skill', 'me', 'public')).toEqual([{ id: 'design-review' }]);
    expect(cloudFetch).toHaveBeenCalledTimes(2);
    expect(cloudFetch.mock.calls[1]?.[0]).toEqual(cloudFetch.mock.calls[0]?.[0]);
    expect(cloudFetch.mock.calls[1]?.[1]).toMatchObject({ method: 'GET', headers: cloudFetch.mock.calls[0]?.[1]?.headers });
  });

  it('surfaces persistent internal errors after one retry', async () => {
    const cloudFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ error: 'internal_error' }, { status: 500 }));
    await expect(fixture(cloudFetch).listResources('workspace', 'skill')).rejects.toMatchObject({ status: 500, code: 'internal_error' });
    expect(cloudFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry permission failures', async () => {
    const cloudFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'forbidden' }, { status: 403 }));
    await expect(fixture(cloudFetch).listResources('workspace', 'skill')).rejects.toMatchObject({ status: 403 });
    expect(cloudFetch).toHaveBeenCalledOnce();
  });

  it('does not retry resource deletion', async () => {
    const cloudFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'internal_error' }, { status: 500 }));
    await expect(fixture(cloudFetch).removeResource('workspace', 'skill')).rejects.toMatchObject({ status: 500 });
    expect(cloudFetch).toHaveBeenCalledOnce();
  });
});
