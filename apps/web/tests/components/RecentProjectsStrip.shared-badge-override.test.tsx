// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
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

function renderSharedWithMeCard() {
  workspaceState.context = teamContext();
  return render(
    <RecentProjectsStrip
      projects={[project()]}
      onOpen={() => {}}
      space="team"
      operator={{ memberId: 'wm-viewer', role: 'member' }}
      badgeOverride="shared"
    />,
  );
}

afterEach(() => {
  cleanup();
  workspaceState.context = null;
  workspaceState.resolve.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RecentProjectsStrip shared-with-me badge override', () => {
  it('shows the shared badge as an always-visible grid overlay', () => {
    const { container } = renderSharedWithMeCard();

    const badge = container.querySelector<HTMLElement>('.recent-projects__card-badge');
    expect(badge?.textContent).toBe('Shared');
    expect(badge?.classList.contains('recent-projects__card-badge--shared-with-me')).toBe(true);
    expect(badge?.classList.contains('recent-projects__card-badge--always')).toBe(true);
    expect(badge?.classList.contains('recent-projects__card-badge--team')).toBe(false);
    expect(badge?.closest('.recent-projects__card-thumb')).not.toBeNull();
  });

  it('shows the shared badge inline in list view', () => {
    const { container, getByRole } = renderSharedWithMeCard();

    fireEvent.click(getByRole('button', { name: 'List view' }));

    const badge = container.querySelector<HTMLElement>('.recent-projects__card-badge');
    expect(badge?.textContent).toBe('Shared');
    expect(badge?.classList.contains('recent-projects__card-badge--inline')).toBe(true);
    expect(badge?.classList.contains('recent-projects__card-badge--shared-with-me')).toBe(true);
  });

  it('keeps the team badge for a team-series view without an override', () => {
    workspaceState.context = teamContext();
    const { container } = render(
      <RecentProjectsStrip
        projects={[project()]}
        onOpen={() => {}}
        space="team"
        operator={{ memberId: 'wm-viewer', role: 'member' }}
      />,
    );

    const badge = container.querySelector<HTMLElement>('.recent-projects__card-badge');
    expect(badge?.textContent).toBe('Team');
    expect(badge?.classList.contains('recent-projects__card-badge--team')).toBe(true);
  });
});
