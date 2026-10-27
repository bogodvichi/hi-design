import { randomUUID } from 'node:crypto';
import { HdwCloudError, type HdwCloudClient, type HdwPullResult, type HdwResourceRecord } from '../integrations/hdw-cloud.js';
import {
  TeamResourceShareForbiddenError,
  type TeamResourceRequestScope,
} from './team-resource-share.js';

/** Link a standalone community publication back to its owned source. */
export const COMMUNITY_SOURCE_RESOURCE_ID = 'communitySourceResourceId';
/** A broken source snapshot must fail before a community publication is
 * created. Never forward internal Blob paths or ENOENT details to users. */
export class SourceSkillSnapshotUnavailableError extends Error {
  readonly code = 'SOURCE_SKILL_SNAPSHOT_INCOMPLETE';
  constructor() {
    super('源 Skill 文件不完整，暂时无法发布。请重新同步源文件或联系管理员处理。');
    this.name = 'SourceSkillSnapshotUnavailableError';
  }
}

async function loadValidSkillSourceSnapshot(
  client: HdwCloudClient, workspaceId: string, sourceId: string,
): Promise<HdwPullResult> {
  let snapshot: HdwPullResult | null = null;
  try {
    snapshot = await client.pullResource(workspaceId, sourceId, 'published');
  } catch (error) {
    if ((error instanceof HdwCloudError && error.status === 404)
      || (error instanceof Error && /ENOENT|no such file|missing blob|manifest.*not found/iu.test(error.message))) {
      throw new SourceSkillSnapshotUnavailableError();
    }
    throw error;
  }
  if (!snapshot || !snapshot.manifest || !Array.isArray(snapshot.manifest.entries)
    || (snapshot.missingBlobs?.length ?? 0) > 0) {
    throw new SourceSkillSnapshotUnavailableError();
  }
  return snapshot;
}


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
    publicationSourceType: 'reference',
    communitySourceWorkspaceId: teamId,
    [COMMUNITY_SOURCE_RESOURCE_ID]: original.id,
    publicationVersion: 1,
    publishedAt: new Date().toISOString(),
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

  // Validate the source manifest and its referenced Blobs BEFORE creating
  // any public record. Existing broken Skills remain untouched.
  const snapshot = await loadValidSkillSourceSnapshot(client, teamId, original.id);
  const resourceId = `community-skill-${randomUUID()}`;
  try {
    const version = await publishSkillCommunitySnapshot(client, teamId, resourceId, memberId, original.id, metadata, snapshot);
    return { resourceId, version };
  } catch (error) {
    // A partially committed version is never left as a discoverable card.
    await client.removeResource(teamId, resourceId).catch(() => {});
    throw error;
  }
}
/** A community entry's identity is separate from its source. */
export function communityPublicationSourceType(
  metadata: Record<string, unknown> | null | undefined,
  scope?: string | null,
): 'reference' | 'local_import' | 'legacy' | null {
  if (isCommunityPublicationCopy(metadata)) return 'reference';
  if (metadata?.publicationSourceType === 'local_import') return 'local_import';
  return scope === 'public' ? 'legacy' : null;
}

async function publishSkillCommunitySnapshot(
  client: HdwCloudClient,
  workspaceId: string,
  publicationId: string,
  ownerMemberId: string,
  sourceId: string,
  metadata: Record<string, unknown>,
  validatedSourceSnapshot?: HdwPullResult,
): Promise<number> {
  const snapshot = validatedSourceSnapshot ?? await loadValidSkillSourceSnapshot(client, workspaceId, sourceId);
  const publication = {
    kind: 'skill',
    manifest: snapshot.manifest,
    metadata,
    ref: 'published',
    ownerMemberId,
    scope: 'public',
  } as const;
  let result = await client.publishResource(workspaceId, publicationId, publication);
  for (let attempt = 0; result.missingBlobs.length > 0 && attempt < 3; attempt += 1) {
    for (const digest of new Set(result.missingBlobs)) {
      await client.uploadBlob(workspaceId, digest, await client.downloadBlob(workspaceId, digest));
    }
    result = await client.publishResource(workspaceId, publicationId, publication);
  }
  if (result.missingBlobs.length > 0) throw new Error('community Skill copy has missing blobs');
  return result.version;
}

/** Explicit version update; never runs automatically when a source changes. */
export async function updateCommunityPublication(
  client: HdwCloudClient,
  publicationId: string,
  scope: TeamResourceRequestScope,
  sanitizeMcp: (metadata: Record<string, unknown>) => Record<string, unknown> = (metadata) => metadata,
): Promise<{ resourceId: string; version: number | null }> {
  if (!scope.canShare) throw new TeamResourceShareForbiddenError();
  const { teamId, memberId } = scope.principal;
  const published = await client.getResource(teamId, publicationId);
  if (!published || published.ownerMemberId !== memberId || published.scope !== 'public'
      || !isCommunityPublicationCopy(published.metadata)) {
    throw new TeamResourceShareForbiddenError();
  }
  const sourceId = String(published.metadata![COMMUNITY_SOURCE_RESOURCE_ID]);
  const sourceWorkspace = String(published.metadata?.communitySourceWorkspaceId || teamId);
  const source = await client.getResource(sourceWorkspace, sourceId);
  if (!source || source.kind !== published.kind || source.ownerMemberId !== memberId) {
    throw new Error('Source resource not available; cannot update publication');
  }
  const metadata = {
    ...(published.kind === 'mcp' ? sanitizeMcp(source.metadata ?? {}) : (source.metadata ?? {})),
    // Keep the original community description, category and cover chosen by publisher.
    ...Object.fromEntries(['description', 'category', 'logoKey'].filter(
      key => published.metadata?.[key] !== undefined,
    ).map(key => [key, published.metadata![key]])),
    publicationSourceType: 'reference',
    communitySourceWorkspaceId: sourceWorkspace,
    [COMMUNITY_SOURCE_RESOURCE_ID]: sourceId,
    publishedAt: published.metadata?.publishedAt ?? published.createdAt,
    publicationVersion: Number(published.metadata?.publicationVersion || 1) + 1,
  };
  if (published.kind === 'skill') {
    const version = await publishSkillCommunitySnapshot(
      client, teamId, publicationId, memberId, sourceId, metadata,
    );
    return { resourceId: publicationId, version };
  }
  const { payload } = await client.request<{ code: number; msg?: string }>(
    'PUT',
    `/api/workspaces/${encodeURIComponent(teamId)}/resources/${encodeURIComponent(publicationId)}`,
    { metadata, scope: 'public' },
    { 'x-hdw-workspace-id': teamId },
  );
  if (payload.code !== 0) throw new Error(payload.msg || 'community MCP update failed');
  return { resourceId: publicationId, version: Number(metadata.publicationVersion) };
}
/** Community cancellation deletes only the publication. The owner's source
 * and every already installed local copy remain intact. Unknown legacy public
 * records are conservatively retracted rather than destroyed. */
export async function unpublishCommunityResource(
  client: HdwCloudClient,
  resource: HdwResourceRecord,
  workspaceId: string,
  retractLegacy: (metadata: Record<string, unknown>) => Promise<void>,
): Promise<'reference' | 'local_import' | 'legacy'> {
  const type = communityPublicationSourceType(resource.metadata, resource.scope);
  if (!type || resource.scope !== 'public') {
    throw new Error('Resource is not an active community publication');
  }
  if (type === 'legacy') {
    await retractLegacy({
      ...(resource.metadata ?? {}),
      legacyCommunityUnpublishedAt: new Date().toISOString(),
    });
  } else {
    await client.removeResource(workspaceId, resource.id);
  }
  return type;
}

/** HDW has already authenticated and authorized getResource against
 * ownership, same-workspace membership, or an explicit recipient grant.
 * This second guard must only block cancelled community publications:
 * rejecting every cross-workspace private resource also blocks legitimate
 * "Shared with me" installations.
 */
export function canInstallCloudResource(
  resource: HdwResourceRecord,
  _requester: { workspaceId: string; memberId: string },
  _homeWorkspaceId: string,
): boolean {
  // Historical direct publications share identity with the logical source.
  // After unpublish their scope becomes private; HDW then allows only its
  // owner, team members or individually granted recipients to read it.
  if (resource.metadata?.legacyCommunityUnpublishedAt && resource.scope === 'public') return false;
  if (resource.metadata?.publicationSourceType === 'local_import') return resource.scope === 'public';
  if (isCommunityPublicationCopy(resource.metadata)) return resource.scope === 'public';
  // A regular logical source may be private and explicitly shared with the
  // authenticated recipient; permission was verified by HDW's getResource.
  return true;
}
