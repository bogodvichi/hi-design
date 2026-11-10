import { describe, expect, it, vi } from 'vitest';
import { createHdwHttpResourceAdapter } from '../../src/collab/hdw-http-resource-adapter.js';
import type { HdwCloudClient } from '../../src/integrations/hdw-cloud.js';

describe('HDW project removal', () => {
  it('removes the project, resource and access grants atomically on the first attempt', async () => {
    const removeTeamProject = vi.fn(async () => {});
    const removeResource = vi.fn(async () => { throw new Error('split removal must not run'); });
    const adapter = createHdwHttpResourceAdapter({
      resolveProjectDir: () => '/unused', hasTeamIdentity: () => true,
      client: { removeTeamProject, removeResource } as unknown as HdwCloudClient,
    });
    await adapter.unpublish!({ projectId: 'project', principal: {
      teamId: 'team', memberId: 'creator', role: 'member', lifecycleState: 'active',
    } });
    expect(removeTeamProject).toHaveBeenCalledExactlyOnceWith('team', 'project', true);
    expect(removeResource).not.toHaveBeenCalled();
  });
});
