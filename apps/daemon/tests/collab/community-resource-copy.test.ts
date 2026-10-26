import { describe, expect, it, vi } from 'vitest';
import type { HdwCloudClient, HdwResourceRecord } from '../../src/integrations/hdw-cloud.js';
import type { TeamResourceRequestScope } from '../../src/collab/team-resource-share.js';
import {
  COMMUNITY_SOURCE_RESOURCE_ID,
  isCommunityPublicationCopy,
  publishCommunityResourceCopy,
} from '../../src/collab/community-resource-copy.js';

const scope: TeamResourceRequestScope = {
  principal: {
    teamId: 'personal', memberId: 'owner', role: 'owner',
    workspaceType: 'team', lifecycleState: 'active',
  },
  canShare: true,
};

function original(kind: 'skill' | 'mcp'): HdwResourceRecord {
  return {
    id: `${kind}-original`, kind, ownerMemberId: 'owner', scope: null,
    metadata: { id: 'original-id', title: 'Original', label: 'Original', localId: 'original-local-id' },
    version: 2, versionId: 'source-v2', createdAt: '', updatedAt: '',
  };
}

describe('community Skill/MCP copy isolation', () => {
  it('publishes an independent MCP resource without touching the owner original', async () => {
    const source = original('mcp');
    const resources = new Map([[source.id, source]]);
    const request = vi.fn(async (method: string, path: string, body?: unknown) => {
      if (method !== 'POST' || !path.endsWith('/resources')) throw new Error('unexpected mutation');
      const input = body as { scope: string; metadata: Record<string, unknown>; ownerMemberId: string };
      resources.set('mcp-copy', { ...source, id: 'mcp-copy', scope: input.scope, metadata: input.metadata });
      return { status: 200, payload: { code: 0, data: { resource: { id: 'mcp-copy' } } }, etag: null };
    });
    const removeResource = vi.fn(async (_workspace: string, resourceId: string) => {
      resources.delete(resourceId);
    });
    const client = {
      getResource: vi.fn(async (_workspace: string, id: string) => resources.get(id) ?? null),
      request, removeResource,
    } as unknown as HdwCloudClient;

    const result = await publishCommunityResourceCopy({
      client, kind: 'mcp', sourceResourceId: source.id, scope,
      metadata: (record) => ({ ...(record.metadata ?? {}), description: 'Community version' }),
    });
    expect(result.resourceId).toBe('mcp-copy');
    expect(resources.get('mcp-copy')).toMatchObject({
      scope: 'public', metadata: { [COMMUNITY_SOURCE_RESOURCE_ID]: 'mcp-original', description: 'Community version' },
    });
    expect(resources.get('mcp-original')).toEqual(source);
    expect(request).toHaveBeenCalledTimes(1);
    expect(isCommunityPublicationCopy(resources.get('mcp-copy')?.metadata)).toBe(true);

    await client.removeResource('personal', 'mcp-copy');
    expect(resources.has('mcp-copy')).toBe(false);
    expect(resources.get('mcp-original')).toEqual(source);
  });

  it('clones the Skill snapshot into a fresh public resource and keeps the source untouched', async () => {
    const source = original('skill');
    const manifest = { entries: [{ path: 'SKILL.md', digest: 'abc', size: 4 }] };
    const publishResource = vi.fn(async (_workspace: string, _id: string, input: {
      scope?: string; manifest: typeof manifest; metadata?: Record<string, unknown>;
    }) => {
      expect(input.scope).toBe('public');
      expect(input.manifest).toEqual(manifest);
      expect(input.metadata?.[COMMUNITY_SOURCE_RESOURCE_ID]).toBe(source.id);
      return { version: 1, versionId: 'copy-v1', missingBlobs: [] };
    });
    const removeResource = vi.fn(async () => {});
    const client = {
      getResource: vi.fn(async () => source),
      pullResource: vi.fn(async () => ({ manifest, version: 2, versionId: 'source-v2', missingBlobs: [] })),
      publishResource, removeResource,
    } as unknown as HdwCloudClient;

    const result = await publishCommunityResourceCopy({
      client, kind: 'skill', sourceResourceId: source.id, scope,
      metadata: (record) => ({ ...(record.metadata ?? {}), category: 'design' }),
    });
    expect(result.resourceId).toMatch(/^community-skill-/u);
    expect(result.resourceId).not.toBe(source.id);
    expect(result.version).toBe(1);
    expect(publishResource).toHaveBeenCalledTimes(1);
    expect(publishResource.mock.calls[0]?.[1]).toBe(result.resourceId);
    expect(source.scope).toBeNull();
    expect(source.metadata?.[COMMUNITY_SOURCE_RESOURCE_ID]).toBeUndefined();
    expect(removeResource).not.toHaveBeenCalled();
  });

  it('retries missing Skill blobs and cleans up failed publication without deleting the original', async () => {
    const source = original('skill');
    const removeResource = vi.fn(async (_workspace: string, _resourceId: string) => {});
    const publishResource = vi.fn(async () => ({ version: 1, versionId: 'copy-v1', missingBlobs: ['digest'] }));
    const client = {
      getResource: vi.fn(async () => source),
      pullResource: vi.fn(async () => ({ manifest: { entries: [{ path: 'SKILL.md', digest: 'digest', size: 5 }] } })),
      publishResource, removeResource,
      downloadBlob: vi.fn(async () => Buffer.from('hello')),
      uploadBlob: vi.fn(async () => {}),
    } as unknown as HdwCloudClient;
    await expect(publishCommunityResourceCopy({
      client, kind: 'skill', sourceResourceId: source.id, scope,
      metadata: (record) => ({ ...(record.metadata ?? {}) }),
    })).rejects.toThrow('missing blobs');
    expect(publishResource).toHaveBeenCalledTimes(4);
    expect(client.uploadBlob).toHaveBeenCalledTimes(3);
    expect(removeResource).toHaveBeenCalledTimes(1);
    expect(removeResource.mock.calls[0]?.[1]).toMatch(/^community-skill-/u);
    expect(source.scope).toBeNull();
  });

  it('blocks publishing someone else\'s source and prevents re-publishing a community copy', async () => {
    const source = original('mcp');
    const getResource = vi.fn(async () => ({ ...source, ownerMemberId: 'other' }));
    const client = { getResource, request: vi.fn() } as unknown as HdwCloudClient;
    await expect(publishCommunityResourceCopy({
      client, kind: 'mcp', sourceResourceId: source.id, scope,
      metadata: () => ({}),
    })).rejects.toThrow();
    getResource.mockResolvedValue({
      ...source, ownerMemberId: 'owner',
      metadata: { [COMMUNITY_SOURCE_RESOURCE_ID]: 'prior-original' },
    });
    await expect(publishCommunityResourceCopy({
      client, kind: 'mcp', sourceResourceId: source.id, scope,
      metadata: () => ({}),
    })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });
});
