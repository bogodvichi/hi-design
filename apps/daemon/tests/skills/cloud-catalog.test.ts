import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import type { HdwResourceRecord } from '../../src/integrations/hdw-cloud.js';
import { listCloudSkillResources } from '../../src/skills/cloud-catalog.js';

const workspace = { workspaceId: 'personal', workspaceMemberId: 'personal-member', workspaceType: 'team' as const };
const directory: WorkspaceDirectoryItem[] = [
  { ...workspace, workspaceName: 'Personal', role: 'owner', memberStatus: 'active', lifecycleState: 'active', isDefaultTeam: true },
  { workspaceId: 'team-a', workspaceMemberId: 'team-member', workspaceType: 'team', workspaceName: 'Team', role: 'owner', memberStatus: 'active', lifecycleState: 'active' },
  { workspaceId: 'removed', workspaceMemberId: 'removed-member', workspaceType: 'team', workspaceName: 'Removed', role: 'member', memberStatus: 'removed', lifecycleState: 'active' },
];

function fixture() {
  const listResources = vi.fn(async (workspaceId: string, _kind?: string, owner?: string, scope?: string): Promise<HdwResourceRecord[]> => {
    const ownerMemberId = workspaceId === 'team-a' ? 'team-member' : 'personal-member';
    if (owner && owner !== ownerMemberId) return [];
    return [{ id: `skill-${workspaceId}`, kind: 'skill', ownerMemberId, metadata: { title: workspaceId === 'team-a' ? 'ued-requirement-analysis' : 'design-review' },
      version: 1, versionId: 'v1', createdAt: '', updatedAt: '', scope } as HdwResourceRecord];
  });
  return { listResources, input: { client: { listResources }, workspace,
    readDirectory: async () => ({ ok: true, items: directory }) } };
}

describe('cloud Skill catalog workspace aggregation', () => {
  it('includes published team Skills in the community while querying public resources only', async () => {
    const f = fixture();
    const resources = await listCloudSkillResources({ ...f.input, scope: 'public' });
    expect(resources.map((r) => r.id)).toEqual(['skill-personal', 'skill-team-a']);
    expect(f.listResources).toHaveBeenCalledWith('team-a', 'skill', undefined, 'public');
    expect(f.listResources).not.toHaveBeenCalledWith('removed', expect.anything(), expect.anything(), expect.anything());
    expect(resources[1]).toMatchObject({ homeWorkspaceId: 'team-a', homeWorkspaceMemberId: 'team-member', canManage: true });
  });

  it('uses the account member identity in each source workspace for My publishes', async () => {
    const f = fixture();
    const resources = await listCloudSkillResources({ ...f.input, scope: 'public', ownerMemberId: 'personal-member' });
    expect(resources.map((r) => r.id)).toEqual(['skill-personal', 'skill-team-a']);
    expect(f.listResources).toHaveBeenCalledWith('team-a', 'skill', 'team-member', 'public');
  });

  it('does not broaden private listings', async () => {
    const f = fixture();
    const readDirectory = vi.fn(f.input.readDirectory);
    expect(await listCloudSkillResources({ ...f.input, readDirectory, ownerMemberId: 'personal-member' })).toHaveLength(1);
    expect(readDirectory).not.toHaveBeenCalled();
    expect(f.listResources).toHaveBeenCalledOnce();
  });

  it('does not reinterpret another member filter as the current account', async () => {
    const f = fixture();
    await listCloudSkillResources({ ...f.input, scope: 'public', ownerMemberId: 'someone-else' });
    expect(f.listResources).toHaveBeenCalledOnce();
    expect(f.listResources).toHaveBeenCalledWith('personal', 'skill', 'someone-else', 'public');
  });

  it('does not present a partial community catalog when account authority is unavailable', async () => {
    const f = fixture();
    await expect(listCloudSkillResources({ ...f.input, scope: 'public', readDirectory: async () => ({ ok: false, items: [] }) })).rejects.toThrow();
  });
});
