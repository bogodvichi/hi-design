import { describe, expect, it, vi } from 'vitest';
import { createTeamResourceShareService } from '../src/collab/team-resource-share.js';
import type { HdwCloudClient } from '../src/integrations/hdw-cloud.js';

describe('HDW team resource reads', () => {
  it('lists through the same HDW identity as publishing without invoking the Vela CLI', async () => {
    const listResources = vi.fn().mockResolvedValue([{
      id: 'skill-team-a-one', kind: 'skill', ownerMemberId: 'member-a',
      metadata: { localId: 'one' }, versionId: 'version-one', version: 3,
    }, { id: 'skill-team-a-pending', kind: 'skill', versionId: null, version: null }]);
    const service = createTeamResourceShareService({
      kind: 'skill', idPrefix: 'skill', resolveDir: () => '/unused', env: {},
      hdwClient: { listResources } as unknown as HdwCloudClient,
    });
    const records = await service.sharedResources({
      principal: { teamId: 'team-a', memberId: 'member-a', role: 'owner', lifecycleState: 'active' },
      canShare: true,
    }, { authoritative: true });
    expect(listResources).toHaveBeenCalledWith('team-a');
    expect(records).toMatchObject([{ id: 'one', hubResourceId: 'skill-team-a-one', versionId: 'version-one', version: 3 }]);
  });
});
