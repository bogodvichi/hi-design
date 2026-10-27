import { describe, expect, it, vi } from 'vitest';
import type { HdwCloudClient, HdwResourceRecord } from '../../src/integrations/hdw-cloud.js';
import type { TeamResourceRequestScope } from '../../src/collab/team-resource-share.js';
import {
  canInstallCloudResource, communityPublicationSourceType,
  unpublishCommunityResource, updateCommunityPublication,
} from '../../src/collab/community-resource-copy.js';

const scope: TeamResourceRequestScope = {
  principal: { teamId: 'team-1', memberId: 'owner-1', role: 'owner',
    workspaceType: 'team', lifecycleState: 'active' }, canShare: true,
};
const resource = (id: string, kind: 'skill' | 'mcp', options: Partial<HdwResourceRecord> = {}): HdwResourceRecord => ({
  id, kind, ownerMemberId: 'owner-1', scope: 'public',
  metadata: { title: 'Source', label: 'Source' },
  version: kind === 'skill' ? 2 : null, versionId: kind === 'skill' ? 'v2' : null,
  createdAt: '2026-10-01', updatedAt: '2026-10-01',
  ...options,
});

describe('community publication lifecycle semantics', () => {
  it.each(['reference', 'local_import'] as const)('cancels %s publications without changing sources or installed MCPs', async (sourceType) => {
    const source = resource('original', 'mcp', { scope: null });
    const published = resource('pub-1', 'mcp', { metadata: {
      label: 'Source', publicationSourceType: sourceType,
      ...(sourceType === 'reference' ? { communitySourceResourceId: 'original' } : {}),
    } });
    const records = new Map([[source.id, source], [published.id, published]]);
    const client = {
      removeResource: vi.fn(async (_workspace: string, id: string) => { records.delete(id); }),
    } as unknown as HdwCloudClient;
    const legacy = vi.fn(async () => {});
    const result = await unpublishCommunityResource(client, published, 'team-1', legacy);
    expect(result).toBe(sourceType);
    expect(client.removeResource).toHaveBeenCalledWith('team-1', 'pub-1');
    expect(records.get('original')).toEqual(source);
    expect(records.has('pub-1')).toBe(false);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('safely retracts an unknown legacy publication rather than deleting the original record', async () => {
    const published = resource('legacy', 'mcp');
    const client = { removeResource: vi.fn() } as unknown as HdwCloudClient;
    const legacy = vi.fn(async (_metadata: Record<string, unknown>) => {});
    expect(communityPublicationSourceType(published.metadata, published.scope)).toBe('legacy');
    expect(await unpublishCommunityResource(client, published, 'team-1', legacy)).toBe('legacy');
    expect(legacy).toHaveBeenCalledWith(expect.objectContaining({ legacyCommunityUnpublishedAt: expect.any(String) }));
    expect(client.removeResource).not.toHaveBeenCalled();
  });

  it('blocks new community installs after cancellation while preserving an existing owner source', () => {
    const owner = { workspaceId: 'team-1', memberId: 'owner-1' };
    const visitor = { workspaceId: 'other-team', memberId: 'visitor' };
    const original = resource('original', 'mcp', { scope: null });
    expect(canInstallCloudResource(original, owner, 'team-1')).toBe(true);
    // Team members may still install private sources inside their team workspace.
    expect(canInstallCloudResource(original, { workspaceId: 'team-1', memberId: 'member-2' }, 'team-1')).toBe(true);
    // HDW has already verified this user's private share grant before getResource succeeds.
    expect(canInstallCloudResource(original, visitor, 'team-1')).toBe(true);

    const available = resource('published', 'mcp', {
      metadata: { label: 'Published', publicationSourceType: 'reference', communitySourceResourceId: 'original' },
    });
    expect(canInstallCloudResource(available, visitor, 'team-1')).toBe(true);

    const cancelledLegacy = resource('legacy', 'mcp', { scope: null,
      metadata: { label: 'Published', legacyCommunityUnpublishedAt: '2026-10-27' },
    });
    // A private legacy source stays usable by its owner or existing explicit
    // private-share recipients; HDW forbids anonymous community reads first.
    expect(canInstallCloudResource(cancelledLegacy, owner, 'team-1')).toBe(true);
    expect(canInstallCloudResource(cancelledLegacy, visitor, 'team-1')).toBe(true);
    expect(canInstallCloudResource({ ...cancelledLegacy, scope: 'public' }, visitor, 'team-1')).toBe(false);
    const unpublishedImport = resource('import', 'mcp', { scope: null,
      metadata: { label: 'Import', publicationSourceType: 'local_import' },
    });
    expect(canInstallCloudResource(unpublishedImport, owner, 'team-1')).toBe(false);
  });

  it('updates a reference MCP only by explicit call and retains the publication identity', async () => {
    const source = resource('source', 'mcp', { scope: null, metadata: {
      id: 'source', label: 'New version', description: 'Source changed', transport: 'http', url: 'https://mcp.example',
    } });
    const published = resource('community-mcp', 'mcp', { metadata: {
      id: 'source', label: 'Old version', publicationSourceType: 'reference',
      communitySourceResourceId: 'source', communitySourceWorkspaceId: 'team-1',
      description: 'Publisher chosen', publicationVersion: 3,
    } });
    const request = vi.fn(async () => ({ status: 200, payload: { code: 0 }, etag: null }));
    const client = {
      getResource: vi.fn(async (_ws: string, id: string) => id === 'source' ? source : published),
      request,
    } as unknown as HdwCloudClient;
    const result = await updateCommunityPublication(client, 'community-mcp', scope);
    expect(result).toMatchObject({ resourceId: 'community-mcp', version: 4 });
    const body = (request.mock.calls as unknown[][])[0]?.[2] as { metadata: Record<string, unknown> };
    expect(body.metadata).toMatchObject({
      label: 'New version', description: 'Publisher chosen', publicationVersion: 4,
      communitySourceResourceId: 'source',
    });
    expect(source.metadata?.description).toBe('Source changed');
  });

  it('updates a Skill reference using source snapshot under the existing published ID', async () => {
    const source = resource('source', 'skill', { scope: null,
      metadata: { title: 'Updated Source', localId: 'source' },
    });
    const published = resource('community-skill', 'skill', { metadata: {
      title: 'Old Title', communitySourceResourceId: 'source',
      communitySourceWorkspaceId: 'team-1', publicationSourceType: 'reference',
      publicationVersion: 1,
    } });
    const manifest = { entries: [{ path: 'SKILL.md', digest: 'abc123', size: 10 }] };
    const publishResource = vi.fn(async () => ({ version: 2, versionId: 'published-v2', missingBlobs: [] }));
    const client = {
      getResource: vi.fn(async (_ws: string, id: string) => id === 'source' ? source : published),
      pullResource: vi.fn(async () => ({ manifest, version: 3 })),
      publishResource,
    } as unknown as HdwCloudClient;
    const result = await updateCommunityPublication(client, 'community-skill', scope);
    expect(result).toEqual({ resourceId: 'community-skill', version: 2 });
    const call = publishResource.mock.calls[0] as unknown as [string, string, { metadata: Record<string, unknown>; manifest: unknown }];
    expect(call[1]).toBe('community-skill');
    expect(call[2].manifest).toEqual(manifest);
    expect(call[2].metadata.publicationVersion).toBe(2);
  });
});
