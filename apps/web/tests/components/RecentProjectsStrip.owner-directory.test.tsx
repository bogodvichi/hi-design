// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CollabCloudMemberDirectoryEntry,
  WorkspaceCollabContext,
} from '@open-design/contracts';
import type { Project } from '../../src/types';

const workspaceState = vi.hoisted(() => ({
  context: null as WorkspaceCollabContext | null,
  resolve: vi.fn<
    (memberId: string | null | undefined) => CollabCloudMemberDirectoryEntry | null
  >(),
}));

vi.mock('../../src/collab/useTeamMembers', () => ({
  currentUserDirectoryEntry: () => null,
  useTeamMembers: () => ({ resolve: workspaceState.resolve }),
}));

vi.mock('../../src/collab/useWorkspaceContext', () => ({
  notifyTeamProjectsChanged: vi.fn(),
  useSharedSpaceTeamId: () => null,
  useWorkspaceBilling: () => null,
  useWorkspaceContext: () => ({ context: workspaceState.context }),
}));

vi.mock('../../src/collab/workspace-events', () => ({
  useWorkspaceInvalidation: vi.fn(),
}));

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFiles: vi.fn(async () => []),
  fetchProjectFileText: vi.fn(async () => null),
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';

function teamContext(): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-team',
    workspaceType: 'team',
    workspaceMemberId: 'wm-viewer',
    role: 'member',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: null,
    providerMode: 'platform_credits',
    seatSummary: { seatLimit: 5, usedSeats: 2, availableSeats: 3 },
    permissions: {},
    teamId: 'team-1',
  } as WorkspaceCollabContext;
}

function project(): Project {
  return {
    id: 'project-shared',
    name: 'Shared project',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
    createdByWorkspaceMemberId: 'wm-owner',
    status: { value: 'not_started' },
  };
}

afterEach(() => {
  cleanup();
  workspaceState.context = null;
  workspaceState.resolve.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RecentProjectsStrip owner directory fallback', () => {
  it('resolves a team project owner from the member directory', () => {
    workspaceState.context = teamContext();
    workspaceState.resolve.mockImplementation((memberId) =>
      memberId === 'wm-owner'
        ? { memberId: 'wm-owner', displayName: 'Ally Zhang', role: 'member' }
        : null,
    );

    const { container } = render(
      <RecentProjectsStrip
        projects={[project()]}
        onOpen={() => {}}
        space="team"
      />,
    );

    const owner = container.querySelector<HTMLElement>(
      '.recent-projects__card-owner',
    );
    expect(owner?.getAttribute('title')).toBe('Ally Zhang');
  });
});
