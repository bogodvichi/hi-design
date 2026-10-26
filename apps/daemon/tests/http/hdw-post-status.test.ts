import { afterEach, describe, expect, it, vi } from 'vitest';
import { HdwPostError, hdwPost } from '../../src/http/hdw.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('HDW resource-share upstream rejection', () => {
  const path = '/resource-share/share';
  const body = { resource_id: 'fake-resource', home_workspace_id: 'test-ws', kind: 'mcp' };

  it('preserves upstream NOT_RESOURCE_OWNER for strict share callers without a remote write', async () => {
    const fetchMock = vi.fn(async () => Response.json(
      { code: -1, error: 'NOT_RESOURCE_OWNER' }, { status: 403 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    await expect(hdwPost(path, body, [], { throwOnError: true })).rejects.toMatchObject({
      status: 403, code: 'NOT_RESOURCE_OWNER', name: 'HdwPostError',
    } satisfies Partial<HdwPostError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps legacy callers null-on-failure without changing their contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { code: -1, error: 'NOT_RESOURCE_OWNER' }, { status: 403 },
    )));
    expect(await hdwPost(path, body)).toBeNull();
  });

  it('returns typed success data when the upstream share succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      code: 0, msg: 'SUCCESS', data: { shared: 1, skipped: 0 },
    })));
    expect(await hdwPost<{ shared: number; skipped: number }>(
      path, body, [], { throwOnError: true },
    )).toEqual({ shared: 1, skipped: 0 });
  });

  it('keeps a malformed successful response a failure rather than fabricating success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: -1, error: 'invalid_request' })));
    await expect(hdwPost(path, body, [], { throwOnError: true })).rejects.toMatchObject({
      status: 502, code: 'invalid_request',
    });
  });
});
