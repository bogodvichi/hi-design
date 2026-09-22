import { describe, expect, it } from 'vitest';

import {
  buildWorkspacePermissions,
  buildWorkspaceSeatSummary,
} from '@open-design/contracts';
import {
  workspaceContextFromDirectoryItem,
  workspaceDirectoryItemFromContext,
} from '../../src/collab/useWorkspaceContext';

describe('workspaceContextFromDirectoryItem', () => {
  it('carries default-team and shared-space flags from a directory item', () => {
    const context = workspaceContextFromDirectoryItem({
      workspaceId: 'ws-shared',
      workspaceName: '共享空间',
      workspaceType: 'team',
      workspaceMemberId: 'wm-shared',
      isDefaultTeam: true,
      isSharedSpace: true,
      role: 'admin',
      memberStatus: 'active',
      lifecycleState: 'active',
    });
    expect(context.isDefaultTeam).toBe(true);
    expect(context.isSharedSpace).toBe(true);
  });
});

describe('workspaceDirectoryItemFromContext', () => {
  it('preserves default-team and shared-space flags for exact-scope revalidation', () => {
    const item = workspaceDirectoryItemFromContext({
      workspaceId: 'ws-shared',
      workspaceType: 'team',
      workspaceMemberId: 'wm-shared',
      role: 'admin',
      memberStatus: 'active',
      lifecycleState: 'active',
      billingState: 'active',
      planId: null,
      providerMode: 'platform_credits',
      seatSummary: buildWorkspaceSeatSummary({ seatLimit: 0, usedSeats: 0 }),
      permissions: buildWorkspacePermissions({
        role: 'admin',
        lifecycleState: 'active',
        memberStatus: 'active',
      }),
      workspaceName: '共享空间',
      isDefaultTeam: true,
      isSharedSpace: true,
    });
    expect(item.isDefaultTeam).toBe(true);
    expect(item.isSharedSpace).toBe(true);
  });
});
