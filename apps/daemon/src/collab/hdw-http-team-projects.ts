// hdw HTTP team project catalog — replaces the vela CLI catalog with direct
// HTTP calls to the hdw REST API. Implements the same VelaTeamProjectCatalog
// and VelaTeamProjectCatalogClient interfaces so the runtime can swap it in
// without touching any caller.

import type { ProjectMetadata, TeamProject } from '@open-design/contracts';
import type {
  UpsertVelaTeamProjectInput,
  VelaTeamProjectCatalogClient,
  VelaTeamProjectRecord,
} from '../integrations/vela-team-projects.js';
import type { HdwCloudClient, HdwTeamProjectRecord } from '../integrations/hdw-cloud.js';
import type { ResourceHubPrincipal } from './resource-principal.js';
import type { VelaTeamProjectCatalog } from './vela-cli-team-projects.js';
import { projectResourceId } from './vela-cli-team-projects.js';

function toTeamProject(record: HdwTeamProjectRecord): TeamProject | null {
  // Hide non-synced rows so teammates never open empty project shells.
  if (record.syncState !== 'synced') return null;
  const project: TeamProject = {
    projectId: record.projectId,
    ownerMemberId: record.ownerMemberId,
    sharedAt: record.createdAt,
  };
  // folder_id is now on team_projects itself (replaces folder_projects).
  // The HDW backend may return it as either camelCase or snake_case.
  const folderId = record.folderId ?? record.folder_id ?? null;
  project.folderId = folderId;
  if (record.ownerDisplayName?.trim()) {
    project.ownerDisplayName = record.ownerDisplayName.trim();
  }
  if (record.coverDigest) {
    project.coverDigest = record.coverDigest;
  }
  if (record.displayName?.trim()) {
    project.name = record.displayName.trim();
  }
  const metadata = record.metadata;
  if (metadata && typeof metadata === 'object') {
    const meta = metadata as Record<string, unknown>;
    if (typeof meta.skillId === 'string') project.skillId = meta.skillId;
    if (typeof meta.designSystemId === 'string') project.designSystemId = meta.designSystemId;
    const projectMetadata = meta.metadata;
    if (projectMetadata && typeof projectMetadata === 'object') {
      project.metadata = projectMetadata as unknown as ProjectMetadata;
    }
    if (typeof meta.createdAt === 'number') project.createdAt = meta.createdAt;
    if (typeof meta.updatedAt === 'number') project.updatedAt = meta.updatedAt;
  }
  const updatedAt = Date.parse(record.updatedAt);
  if (Number.isFinite(updatedAt) && project.updatedAt === undefined) {
    project.updatedAt = updatedAt;
  }
  const createdAt = Date.parse(record.createdAt);
  if (Number.isFinite(createdAt) && project.createdAt === undefined) {
    project.createdAt = createdAt;
  }
  return project;
}

function toVelaTeamProjectRecord(
  record: HdwTeamProjectRecord,
): VelaTeamProjectRecord | null {
  if (
    typeof record.id !== 'string' ||
    typeof record.workspaceId !== 'string' ||
    typeof record.projectId !== 'string' ||
    typeof record.resourceId !== 'string' ||
    typeof record.ownerMemberId !== 'string' ||
    typeof record.syncState !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null;
  }
  const access = record.access ?? {
    canView: true,
    canComment: true,
    canEdit: false,
    frozen: false,
  };
  const metadata = record.metadata ?? {};
  const originProjectUpdatedAt =
    typeof (metadata as Record<string, unknown>)?.updatedAt === 'number' &&
    Number.isFinite((metadata as Record<string, unknown>).updatedAt as number)
      ? (metadata as Record<string, unknown>).updatedAt as number
      : null;
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    resourceId: record.resourceId,
    ownerMemberId: record.ownerMemberId,
    displayName: record.displayName,
    syncState: toVelaSyncState(record.syncState),
    lastSyncedVersionId: record.lastSyncedVersionId,
    coverDigest: record.coverDigest ?? null,
    createdAt: record.createdAt,
    originProjectUpdatedAt,
    updatedAt: record.updatedAt,
    access: {
      canView: access.canView ?? true,
      canComment: access.canComment ?? true,
      canEdit: access.canEdit ?? false,
      frozen: access.frozen ?? false,
    },
  };
}

function toVelaSyncState(value: string): VelaTeamProjectRecord['syncState'] {
  if (value === 'syncing' || value === 'synced' || value === 'failed') return value;
  return 'pending_upload';
}

export function createHdwHttpTeamProjectCatalog(
  client: HdwCloudClient,
): VelaTeamProjectCatalog {
  return {
    async list(workspaceId: string, folderId?: string | null): Promise<TeamProject[]> {
      const records = await client.listTeamProjects(workspaceId, folderId);
      return records
        .map(toTeamProject)
        .filter((p): p is TeamProject => p != null);
    },

    async get(projectId: string, workspaceId: string): Promise<TeamProject | null> {
      const record = await client.getTeamProject(workspaceId, projectId);
      if (!record) return null;
      return toTeamProject(record);
    },

    async upsert(input, principal): Promise<void> {
      const workspaceId = principal?.teamId?.trim();
      if (!workspaceId) throw new Error('explicit workspace scope is required');
    await client.upsertTeamProject(workspaceId, input.projectId, {
      resourceId: input.resourceId ?? projectResourceId(input.projectId),
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      ...(input.syncState ? { syncState: input.syncState } : {}),
      ...(input.lastSyncedVersionId?.trim()
        ? { lastSyncedVersionId: input.lastSyncedVersionId.trim() }
        : {}),
      ...(input.metadata && Object.keys(input.metadata).length > 0
        ? { metadata: input.metadata }
        : {}),
      ...(principal?.memberId ? { ownerMemberId: principal.memberId } : {}),
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.coverDigest !== undefined ? { coverDigest: input.coverDigest } : {}),
    });
    },

    async remove(projectId: string, principal?: ResourceHubPrincipal | null): Promise<void> {
      const workspaceId = principal?.teamId?.trim();
      if (!workspaceId) throw new Error('explicit workspace scope is required');
      await client.removeTeamProject(workspaceId, projectId);
    },
  };
}

export function createHdwHttpTeamProjectCatalogClient(
  client: HdwCloudClient,
): VelaTeamProjectCatalogClient {
  return {
    async list(principal: ResourceHubPrincipal): Promise<VelaTeamProjectRecord[]> {
      const workspaceId = principal.teamId.trim();
      if (!workspaceId) throw new Error('explicit workspace scope is required');
      const records = await client.listTeamProjects(workspaceId);
      const mapped = records.map(toVelaTeamProjectRecord);
      if (mapped.some((r) => r == null)) {
        throw new Error('incomplete team project catalog: invalid project row');
      }
      return mapped as VelaTeamProjectRecord[];
    },

    async upsert(
      input: UpsertVelaTeamProjectInput,
      principal: ResourceHubPrincipal,
    ): Promise<VelaTeamProjectRecord | null> {
      const workspaceId = principal.teamId.trim();
      if (!workspaceId) throw new Error('explicit workspace scope is required');
    const record = await client.upsertTeamProject(workspaceId, input.projectId, {
      resourceId: input.resourceId,
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      ...(input.syncState ? { syncState: input.syncState } : {}),
      ...(input.lastSyncedVersionId?.trim()
        ? { lastSyncedVersionId: input.lastSyncedVersionId.trim() }
        : {}),
      ...(principal.memberId ? { ownerMemberId: principal.memberId } : {}),
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.coverDigest !== undefined ? { coverDigest: input.coverDigest } : {}),
    });
      if (!record) return null;
      return toVelaTeamProjectRecord(record);
    },
  };
}

export function createHdwHttpTeamProjectCatalogFromEnv(
  client: HdwCloudClient,
): VelaTeamProjectCatalog | null {
  return shouldUseHdwHttpTeamProjectCatalog() ? createHdwHttpTeamProjectCatalog(client) : null;
}

export function createHdwHttpTeamProjectCatalogClientFromEnv(
  client: HdwCloudClient,
): VelaTeamProjectCatalogClient | null {
  return shouldUseHdwHttpTeamProjectCatalog()
    ? createHdwHttpTeamProjectCatalogClient(client)
    : null;
}

/**
 * Whether this run should drive team project catalog through the hdw HTTP
 * transport. Mirrors the vela CLI gate's precedence: an explicit
* OD_TEAM_PROJECTS_TRANSPORT wins; otherwise OD_RESOURCE_TRANSPORT=hdw-http
 * implies the same catalog transport. Defaults to true (hdw is the default
 * transport, replacing vela) when neither is set explicitly.
*/
export function shouldUseHdwHttpTeamProjectCatalog(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicitTransport = env.OD_TEAM_PROJECTS_TRANSPORT?.trim();
  if (explicitTransport) return explicitTransport === 'hdw-http';
  const resourceTransport = env.OD_RESOURCE_TRANSPORT?.trim();
  if (resourceTransport) return resourceTransport === 'hdw-http';
  return true;
}

/**
 * Whether this run should drive resource publishing through the hdw HTTP
 * transport instead of the vela CLI or local stub.
 * Defaults to true (hdw is the default transport, replacing vela) when
 * OD_RESOURCE_TRANSPORT is unset.
 */
export function shouldUseHdwHttpResourceTransport(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicitTransport = env.OD_RESOURCE_TRANSPORT?.trim();
  if (explicitTransport) return explicitTransport === 'hdw-http';
  return true;
}
