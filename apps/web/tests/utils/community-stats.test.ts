// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordCommunityStat } from '../../src/utils/community-stats';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recordCommunityStat', () => {
  it('sends the resource event with explicit workspace identity', async () => {
    // Type the mock as `typeof fetch` so `mock.calls` carries the
    // [input, init] tuple instead of inferring an empty parameter list.
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      stats: {
        resourceType: 'mcp',
        resourceId: 'himind',
        previewCount: 0,
        previewUserCount: 0,
        actionCount: 3,
        actionUserCount: 2,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await recordCommunityStat({
      resourceType: 'mcp',
      resourceId: 'himind',
      metric: 'action',
      workspaceId: 'workspace-1',
      workspaceMemberId: 'member-1',
      workspaceType: 'team',
    });

    expect(result?.actionCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/community/stats/record');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'x-od-workspace-id': 'workspace-1',
      'x-od-workspace-member-id': 'member-1',
      'x-od-workspace-type': 'team',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      resourceType: 'mcp',
      resourceId: 'himind',
      metric: 'action',
    });
  });

  it('does not record without a complete workspace identity', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await recordCommunityStat({
      resourceType: 'tool',
      resourceId: 'tool-1',
      metric: 'action',
      workspaceId: null,
      workspaceMemberId: null,
      workspaceType: null,
    })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
