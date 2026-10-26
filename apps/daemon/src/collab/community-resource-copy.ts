import { randomUUID } from 'node:crypto';
import type { HdwCloudClient, HdwResourceRecord } from '../integrations/hdw-cloud.js';
import {
  TeamResourceShareForbiddenError,
  type TeamResourceRequestScope,
} from './team-resource-share.js';

/** Link a standalone community publication back to its owned source. */
export const COMMUNITY_SOURCE_RESOURCE_ID = 'communitySourceResourceId';

export function isCommunityPublicationCopy(metadata: Record<string, unknown> | null | undefined): boolean {
  return typeof metadata?.[COMMUNITY_SOURCE_RESOURCE_ID] === 'string'
    && (metadata[COMMUNITY_SOURCE_RESOURCE_ID] as string).trim().length > 0;
}

/**
 * Publishing never changes the source resource's scope, bytes, or identity.
 * A community publication is a new HDW resource, so its deletion cannot
 * tombstone the owner's original Skill/MCP.
 */
export async function publishCommunityResourceCopy(input: {
  client: HdwCloudClient;
  sourceResourceId: string;
  scope: TeamResourceRequestScope;
  kind: 'skill' | 'mcp';
  metadata: (source: HdwResourceRecord) => Record<string, unknown>;
}): Promise<{ resourceId: string; version: number | null }> {
  const { client, sourceResourceId, scope, kind } = input;
  if (!scope.canShare) throw new TeamResourceShareForbiddenError();
  const { teamId, memberId } = scope.principal;
  const original = await client.getResource(teamId, sourceResourceId);
  if (!original) throw new Error('cloud resource not found');
  if (original.kind !== kind || original.ownerMemberId !== memberId || isCommunityPublicationCopy(original.metadata)) {
    throw new TeamResourceShareForbiddenError();
  }

  const metadata = {
    ...input.metadata(original),
    [COMMUNITY_SOURCE_RESOURCE_ID]: original.id,
  };

  if (kind === 'mcp') {
    // Metadata-only MCP templates use the HDW create endpoint; do not use
    // the version API or modify the original MCP's scope.
    const { payload } = await client.request<{
      code: number;
      msg?: string;
      data?: { resource?: { id?: string } };
    }>('POST', `/api/workspaces/${encodeURIComponent(teamId)}/resources`, {
      kind, ownerMemberId: memberId, metadata, scope: 'public',
    }, { 'x-hdw-workspace-id': teamId });
    if (payload.code !== 0 || !payload.data?.resource?.id) {
      throw new Error(payload.msg || 'community MCP copy creation failed');
    }
    return { resourceId: payload.data.resource.id, version: null };
  }

  // Copy the *published snapshot*, not the mutable local installation.
  const sourceVersion = await client.pullResource(teamId, original.id, 'published');
  if (!sourceVersion) throw new Error('cloud Skill has no published snapshot');
  const resourceId = `community-skill-${randomUUID()}`;
  const publication = {
    kind,
    manifest: sourceVersion.manifest,
    metadata,
    ref: 'published',
    ownerMemberId: memberId,
    scope: 'public',
  } as const;
  let created = false;
  try {
    created = true;
    let result = await client.publishResource(teamId, resourceId, publication);
    for (let attempt = 0; result.missingBlobs.length > 0 && attempt < 3; attempt += 1) {
      // A second resource in the same HDW workspace normally reuses the
      // existing blobs. Handle missing blobs without touching the source.
      for (const digest of new Set(result.missingBlobs)) {
        const data = await client.downloadBlob(teamId, digest);
        await client.uploadBlob(teamId, digest, data);
      }
      result = await client.publishResource(teamId, resourceId, publication);
    }
    if (result.missingBlobs.length > 0) throw new Error('community Skill copy has missing blobs');
    return { resourceId, version: result.version };
  } catch (error) {
    if (created) await client.removeResource(teamId, resourceId).catch(() => {});
    throw error;
  }
}
