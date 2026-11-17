import { normalizeSkillCategory, type TeamSkillCatalogResponse, type WorkspaceDirectoryItem } from '@open-design/contracts';
import { listCloudResourceRecords } from '../collab/cloud-resource-catalog.js';
import type { TeamResourceRequestScope, TeamResourceShareService } from '../collab/team-resource-share.js';
import type { TeamResourceVersionStore } from '../collab/team-resource-version-store.js';
import type { HdwCloudClient, HdwResourceRecord } from '../integrations/hdw-cloud.js';

/** One remote directory, enriched only by locally verified installed Skills. */
export async function listTeamSkillCatalog(input: {
  scope: TeamResourceRequestScope;
  useHdw: boolean;
  client: HdwCloudClient | null;
  share: TeamResourceShareService;
  readDirectory: () => Promise<{ ok: boolean; items: WorkspaceDirectoryItem[] }>;
  listInstalled: () => Promise<Array<{ id: string; cloudResourceId?: unknown; parentSkillId?: unknown }>>;
  versions: TeamResourceVersionStore;
}): Promise<TeamSkillCatalogResponse> {
  const { principal } = input.scope;
  const workspace = { workspaceId: principal.teamId, workspaceMemberId: principal.memberId,
    workspaceType: principal.workspaceType ?? 'team' };
  let records: HdwResourceRecord[];
  if (input.useHdw) {
    if (!input.client) throw new Error('HDW resource transport is unavailable');
    records = await listCloudResourceRecords({ kind: 'skill', client: input.client, workspace,
      readDirectory: input.readDirectory });
  } else {
    const shared = await input.share.sharedResources(input.scope, { authoritative: true });
    records = shared.map((record) => ({
      id: record.hubResourceId ?? record.id, kind: 'skill', ownerMemberId: record.ownerMemberId ?? '',
      metadata: { localId: record.id, title: record.title, description: record.description },
      version: record.version ?? null, versionId: record.versionId ?? null, createdAt: '', updatedAt: '',
    }));
  }
  const installed = new Map((await input.listInstalled()).flatMap((skill) =>
    !skill.parentSkillId && typeof skill.cloudResourceId === 'string'
      ? [[skill.cloudResourceId, skill.id] as const] : []));
  const resources = [...new Map(records.map((record) => [record.id, record])).values()].map((record) => {
    const metadata = record.metadata ?? {};
    const localId = typeof metadata.localId === 'string' ? metadata.localId : record.id;
    const installedId = installed.get(record.id);
    const owned = record.ownerMemberId === principal.memberId;
    return {
      id: owned ? localId : record.id,
      resourceId: record.id, hubResourceId: record.id, localId,
      title: typeof metadata.title === 'string' ? metadata.title : localId,
      description: typeof metadata.description === 'string' ? metadata.description : null,
      ownerMemberId: record.ownerMemberId, canUnshare: owned, canManage: owned,
      version: record.version ?? null, versionId: record.versionId ?? null,
      createdAt: record.createdAt ?? '', updatedAt: record.updatedAt ?? '',
      publisherName: typeof metadata.publisherName === 'string' ? metadata.publisherName
        : record.ownerDisplayName ?? record.ownerMemberId ?? null,
      category: normalizeSkillCategory(metadata.category),
      logoKey: typeof metadata.logoKey === 'string' ? metadata.logoKey : null,
      provider: input.useHdw ? 'hdw' as const : 'vela' as const,
      homeWorkspaceId: principal.teamId, homeWorkspaceMemberId: principal.memberId,
      homeWorkspaceType: principal.workspaceType ?? 'team',
      installation: {
        status: installedId ? 'installed' as const : 'not_installed' as const,
        versionId: installedId ? input.versions.get(principal.teamId, 'skill', installedId) : null,
      },
    };
  });
  return { ids: resources.map((resource) => resource.id), resources };
}
