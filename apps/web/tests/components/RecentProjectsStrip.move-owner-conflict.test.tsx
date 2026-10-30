// @vitest-environment jsdom
//
// Card moves keep their destination open on failure and show actionable feedback.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { Project } from '../../src/types';
import type { WorkspaceProjectSummary } from '@open-design/contracts';
import { workspaceContextFixture } from '../helpers/workspace-context';

const movedTeamProject: WorkspaceProjectSummary = {
  id: 'project-1',
  name: 'Draft',
  workspaceId: 'ws-1',
  visibility: 'team',
  resourceState: 'active',
  createdByWorkspaceMemberId: 'wm-1',
  updatedByWorkspaceMemberId: 'wm-1',
  resourceHubResourceId: 'resource-project-1',
  currentUserAccess: {
    canOpen: true,
    canRename: true,
    canDelete: true,
    canDuplicate: true,
    canMoveToTeam: false,
    canMoveToPersonal: true,
    canExport: true,
    canSendTo: true,
    canRestoreVersion: true,
  },
  createdAt: 1,
  updatedAt: 2,
  project: {
    id: 'project-1',
    name: 'Draft',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
  createdByWorkspaceMemberId: 'wm-1',
  },
};

const moveWorkspaceProject = vi.fn(async (_input: { projectId: string; visibility: string }) => movedTeamProject);

vi.mock('../../src/state/projects', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  moveWorkspaceProject: (...args: unknown[]) =>
    moveWorkspaceProject(args[0] as { projectId: string; visibility: string }),
}));

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFileText: vi.fn(async () => null),
  fetchProjectFiles: vi.fn(async () => []),
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifyTeamProjectsChanged: vi.fn(),
  useWorkspaceBilling: () => null,
  useSharedSpaceTeamId: () => null,
  readWorkspaceDirectoryForCurrentGeneration: async () => ({
    items: [
      {
        workspaceId: 'ws-team-2',
        workspaceName: 'Team Two',
        workspaceType: 'team',
        workspaceMemberId: 'wm-2',
        role: 'owner',
        memberStatus: 'active',
        lifecycleState: 'active',
        isDefaultTeam: false,
      },
      {
        workspaceId: 'ws-personal',
        workspaceName: 'Personal',
        workspaceType: 'personal',
        workspaceMemberId: 'wm-personal',
        role: 'owner',
        memberStatus: 'active',
        lifecycleState: 'active',
        isDefaultTeam: true,
      },
    ],
  }),
  useWorkspaceContext: () => ({
    context: {
      workspaceId: 'ws-personal',
      workspaceType: 'personal',
      isDefaultTeam: true,
      workspaceMemberId: 'wm-1',
      role: 'member',
      memberStatus: 'active',
      lifecycleState: 'active',
      billingState: 'active',
      providerMode: 'platform_credits',
      planId: null,
      seatSummary: { seatLimit: 5, usedSeats: 2, availableSeats: 3 },
      permissions: {},
      teamId: 'team-1',
    },
    loading: false,
    failure: null,
    refresh: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { folders: [] } }),
  })));
});

afterEach(() => {
  cleanup();
  moveWorkspaceProject.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function project(overrides: Partial<Project>): Project {
  return {
    id: 'project-1',
    name: 'Draft',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
    createdByWorkspaceMemberId: 'wm-1',
    status: { value: 'not_started' },
    ...overrides,
  };
}

async function attemptMove(
  destination: 'Team Two' | 'All mine',
  props: Partial<React.ComponentProps<typeof RecentProjectsStrip>> = {},
) {
  render(
    <RecentProjectsStrip
      projects={[project({ id: 'project-1', name: 'Draft' })]}
      onOpen={() => {}}
      collaborationEnabled
      homeWorkspaceId="ws-personal"
      space="drafts"
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Move project/i }));
  await waitFor(() => {
    expect(screen.getByText(destination)).toBeTruthy();
  });
  fireEvent.click(screen.getByText(destination));
  fireEvent.click(screen.getByText('Confirm'));
  return waitFor(() => {
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.className).toContain('placement-top');
    return alert;
  });
}

describe('project move failure toast', () => {
  it('hands the exact successful move response to the optimistic owner layer', async () => {
    const onProjectShared = vi.fn();
    render(
      <RecentProjectsStrip
        projects={[project({ id: 'project-1', name: 'Draft' })]}
        onOpen={() => {}}
        collaborationEnabled
        homeWorkspaceId="ws-personal"
        space="drafts"
        onProjectShared={onProjectShared}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Move project/i }));
    await waitFor(() => {
      expect(screen.getByText('Team Two')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Team Two'));
    fireEvent.click(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(onProjectShared).toHaveBeenCalledWith(movedTeamProject);
    });
  });

  it('shows a move failure for an owner conflict', async () => {
    moveWorkspaceProject.mockRejectedValueOnce(
      Object.assign(new Error('… 403: {"error":"team_project_owner_conflict"}'), {
        code: 'TEAM_PROJECT_OWNER_CONFLICT',
      }),
    );

    const alert = await attemptMove('Team Two');
    expect(alert.textContent).toContain('Could not move');
    expect(screen.queryByText(/another member already shares/i)).toBeNull();
  });

  it('does not mislabel a code-less failure as a permission denial', async () => {
    moveWorkspaceProject.mockRejectedValueOnce(new Error('network wobble'));
    const onProjectShared = vi.fn();
    const onProjectShareFailed = vi.fn();

    const alert = await attemptMove('Team Two', { onProjectShared, onProjectShareFailed });
    expect(alert.textContent).toContain('Could not move');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onProjectShared).not.toHaveBeenCalled();
    expect(onProjectShareFailed).toHaveBeenCalledWith('project-1');
  });

  it('excludes personal and other teams when organizing a team project', async () => {
    render(<RecentProjectsStrip
      projects={[project({ workspaceId: 'ws-1', workspaceVisibility: 'team' })]}
      space="team" homeWorkspaceId="ws-1" currentWorkspaceId="ws-1" collaborationEnabled onOpen={() => {}}
      workspaceContextOverride={workspaceContextFixture({ workspaceId: 'ws-1', workspaceMemberId: 'wm-1' })}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Move project/i }));
    expect(await screen.findByText('No workspaces available')).toBeTruthy();
    expect(screen.queryByText('All mine')).toBeNull();
    expect(screen.queryByText('Team Two')).toBeNull();
    expect(moveWorkspaceProject).not.toHaveBeenCalled();
  });
});
