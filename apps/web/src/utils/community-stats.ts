export type CommunityResourceType = 'project' | 'skill' | 'mcp' | 'tool';
export type CommunityStatMetric = 'preview' | 'action';

export interface CommunityStatSnapshot {
  resourceType: CommunityResourceType;
  resourceId: string;
  previewCount: number;
  previewUserCount: number;
  actionCount: number;
  actionUserCount: number;
}

export async function recordCommunityStat(input: {
  resourceType: CommunityResourceType;
  resourceId: string;
  metric: CommunityStatMetric;
  workspaceId: string | null;
  workspaceMemberId: string | null;
  workspaceType: string | null;
}): Promise<CommunityStatSnapshot | null> {
  const { workspaceId, workspaceMemberId, workspaceType } = input;
  if (!workspaceId || !workspaceMemberId || !workspaceType || !input.resourceId) return null;
  try {
    const res = await fetch('/api/community/stats/record', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-od-workspace-id': workspaceId,
        'x-od-workspace-member-id': workspaceMemberId,
        'x-od-workspace-type': workspaceType,
      },
      body: JSON.stringify({
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metric: input.metric,
      }),
    });
    if (!res.ok) return null;
    const body = await res.json() as { stats?: CommunityStatSnapshot };
    return body.stats ?? null;
  } catch {
    return null;
  }
}
