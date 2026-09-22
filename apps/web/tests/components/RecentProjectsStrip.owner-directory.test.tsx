// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
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

vi.mock('../../src/auth/auth', () => ({
  getStoredUsername: () => 'viewer',
}));

vi.mock('../../src/utils/deterministicId', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/deterministicId')>();
  return {
    ...actual,
    getTeamMemberId: vi.fn(async (teamId: string, username: string) => `team:${teamId}:${username}`),
    getSharedSpaceMemberId: vi.fn(async (username: string) => `shared:${username}`),
  };
});

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
    displayName: 'Viewer Name',
  } as WorkspaceCollabContext;
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-shared',
    name: 'Shared project',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
    createdByWorkspaceMemberId: 'wm-owner',
    status: { value: 'not_started' },
    ...overrides,
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

  it('keeps the same real owner name across recent and team spaces', () => {
    workspaceState.context = teamContext();
    workspaceState.resolve.mockReturnValue(null);
    const ownerNames = new Map([['project-shared', 'Mapped Owner']]);

    const { container, rerender } = render(
      <RecentProjectsStrip
        projects={[project()]}
        onOpen={() => {}}
        projectOwnerDisplayNames={ownerNames}
      />,
    );
    expect(container.querySelector<HTMLElement>('.recent-projects__card-owner')?.title)
      .toBe('Mapped Owner');

    rerender(
      <RecentProjectsStrip
        projects={[project()]}
        onOpen={() => {}}
        space="team"
        projectOwnerDisplayNames={ownerNames}
      />,
    );
    expect(container.querySelector<HTMLElement>('.recent-projects__card-owner')?.title)
      .toBe('Mapped Owner');
  });

  it('shows Me when the HDW owner id matches the deterministic current-user team member id', async () => {
    workspaceState.context = teamContext();
    workspaceState.resolve.mockReturnValue(null);

    const { container } = render(
      <RecentProjectsStrip
        projects={[project({
          workspaceId: 'ws-team',
          createdByWorkspaceMemberId: 'team:ws-team:viewer',
          ownerDisplayName: 'Viewer Name',
        })]}
        onOpen={() => {}}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector<HTMLElement>('.recent-projects__card-owner')?.textContent)
        .toBe('Me');
    });
  });

  it('does not infer self ownership from a matching display name when the owner id differs', async () => {
    workspaceState.context = teamContext();
    workspaceState.resolve.mockReturnValue(null);

    const { container } = render(
      <RecentProjectsStrip
        projects={[project({
          workspaceId: 'ws-team',
          createdByWorkspaceMemberId: 'team:ws-team:someone-else',
          ownerDisplayName: 'Viewer Name',
        })]}
        onOpen={() => {}}
      />,
    );

    await waitFor(() => {
      const owner = container.querySelector<HTMLElement>('.recent-projects__card-owner');
      expect(owner?.textContent).toBe('Viewer Name');
      expect(owner?.getAttribute('title')).toBe('Viewer Name');
    });
  });
});
