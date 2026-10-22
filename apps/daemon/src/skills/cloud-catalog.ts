import type { CloudSkillWorkspaceContext, WorkspaceCollabContext, WorkspaceDirectoryItem } from '@open-design/contracts';
import type { HdwCloudClient, HdwResourceRecord } from '../integrations/hdw-cloud.js';

export async function listCloudSkillResources(input: {
  client: Pick<HdwCloudClient, 'listResources'>;
  workspace: Pick<WorkspaceCollabContext, 'workspaceId' | 'workspaceMemberId' | 'workspaceType'>;
  ownerMemberId?: string;
  scope?: string;
  readDirectory: () => Promise<{ ok: boolean; items: WorkspaceDirectoryItem[] }>;
}): Promise<Array<HdwResourceRecord & CloudSkillWorkspaceContext>> {
  const mine = input.ownerMemberId === input.workspace.workspaceMemberId;
  let workspaces = [input.workspace];
  if (input.scope === 'public' && (!input.ownerMemberId || mine)) {
    const directory = await input.readDirectory();
    if (!directory.ok) throw new Error('workspace directory unavailable for community Skill listing');
    workspaces = [...new Map([
      input.workspace,
      ...directory.items.filter((item) => item.memberStatus === 'active' && item.lifecycleState !== 'deleted'),
    ].map((item) => [item.workspaceId, item])).values()];
  }
  const groups = await Promise.all(workspaces.map(async (workspace) => {
    const ownerMemberId = mine ? workspace.workspaceMemberId : input.ownerMemberId;
    const resources = await input.client.listResources(workspace.workspaceId, 'skill', ownerMemberId, input.scope);
    return resources.map((resource) => ({
      ...resource,
      homeWorkspaceId: workspace.workspaceId,
      homeWorkspaceMemberId: workspace.workspaceMemberId,
      homeWorkspaceType: workspace.workspaceType,
      canManage: resource.ownerMemberId === workspace.workspaceMemberId,
    }));
  }));
  return groups.flat();
}
