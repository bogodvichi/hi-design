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
  it('carries current-user identity and workspace flags from a directory item', () => {
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
      displayName: 'Current User',
      avatarUrl: 'https://example.test/current-user.jpg',
    });
    expect(context.isDefaultTeam).toBe(true);
    expect(context.isSharedSpace).toBe(true);
    expect(context.displayName).toBe('Current User');
    expect(context.avatarUrl).toBe('https://example.test/current-user.jpg');
  });
});

describe('workspaceDirectoryItemFromContext', () => {
  it('preserves current-user identity and workspace flags for exact-scope revalidation', () => {
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
      displayName: 'Current User',
      avatarUrl: 'https://example.test/current-user.jpg',
    });
    expect(item.isDefaultTeam).toBe(true);
    expect(item.isSharedSpace).toBe(true);
    expect(item.displayName).toBe('Current User');
    expect(item.avatarUrl).toBe('https://example.test/current-user.jpg');
  });
});
