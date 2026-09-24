// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../src/types';
import {
  buildWorkspacePermissions,
  buildWorkspaceSeatSummary,
  type WorkspaceCollabContext,
  type WorkspaceDirectoryItem,
} from '@open-design/contracts';
import {
  ProjectReferenceModal,
  type ProjectReferenceSelection,
} from '../../src/components/ProjectReferenceModal';
import { I18nProvider } from '../../src/i18n';
import type { Locale } from '../../src/i18n/types';
import { getProjectDetail, listProjects } from '../../src/state/projects';

vi.mock('../../src/state/projects', () => ({
  getProjectDetail: vi.fn(),
  listProjects: vi.fn(),
}));

const project: Project = {
  id: 'project-ref',
  name: 'Reference Project',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
  metadata: { kind: 'prototype' },
};

const importedProject: Project = {
  ...project,
  id: 'imported-project',
  name: 'Imported Project',
  metadata: { kind: 'prototype', baseDir: '/Users/me/imported' },
};

type ProjectSelectHandler = (items: ProjectReferenceSelection[]) => void;

function renderModal(options: {
  onSelect?: ProjectSelectHandler;
  projects?: Project[];
  listError?: Error;
  workspaceContext?: WorkspaceCollabContext | null;
} = {}) {
  const onSelect = options.onSelect ?? vi.fn<ProjectSelectHandler>();
  if (options.listError) {
    vi.mocked(listProjects).mockRejectedValue(options.listError);
  } else {
    vi.mocked(listProjects).mockResolvedValue(options.projects ?? [project]);
  }
  render(
    <I18nProvider initial={'en' as Locale}>
      <ProjectReferenceModal
        workspaceContext={options.workspaceContext}
        onClose={vi.fn()}
        onSelect={onSelect}
      />
    </I18nProvider>,
  );
  return { onSelect };
}

function teamContext(): WorkspaceCollabContext {
  return {
    workspaceId: 'workspace-ref',
    workspaceType: 'team',
    workspaceMemberId: 'member-ref',
    role: 'member',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: 'team_plus',
    providerMode: 'platform_credits',
    teamId: 'team-ref',
    seatSummary: buildWorkspaceSeatSummary({ seatLimit: 3, usedSeats: 2 }),
    permissions: buildWorkspacePermissions({
      role: 'member',
      lifecycleState: 'active',
    }),
  };
}

async function confirmSelection(projectName = 'Reference Project') {
  await screen.findByText(projectName);
  fireEvent.click(screen.getByRole('button', { name: 'Reference project' }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ProjectReferenceModal', () => {
  it('loads projects with a required error surface', async () => {
    renderModal();

    await screen.findByText('Reference Project');

    expect(listProjects).toHaveBeenCalledWith({ throwOnError: true, workspaceContext: null });
  });

  it('shows a checkbox selection state and allows the row to be deselected', async () => {
    renderModal();

    const option = await screen.findByTestId('project-reference-option-project-ref');
    const check = screen.getByTestId('project-reference-check-project-ref');
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(check.querySelector('svg')).not.toBeNull();

    fireEvent.click(option);

    expect(option.getAttribute('aria-selected')).toBe('false');
    expect(check.querySelector('svg')).toBeNull();
  });

  it('uses the publish-picker project summary treatment', async () => {
    const coveredProject: Project = {
      ...project,
      coverDigest: 'cover-digest',
      workspaceVisibility: 'personal',
      updatedAt: Date.now() - 2 * 60 * 60 * 1000,
    };
    renderModal({ projects: [coveredProject] });

    const option = await screen.findByTestId('project-reference-option-project-ref');
    expect(option.querySelector('img')?.getAttribute('src')).toBe(
      '/api/projects/project-ref/cover?digest=cover-digest',
    );
    expect(option.textContent).toContain('2h ago');
    expect(option.textContent).not.toContain('prototype');
  });

  it('shows a load error instead of an empty state when project loading fails', async () => {
    renderModal({ listError: new Error('daemon unavailable') });

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load projects');
    expect(screen.queryByText('No other projects yet')).toBeNull();
  });

  it('does not select a project when detail loading fails', async () => {
    const { onSelect } = renderModal();
    vi.mocked(getProjectDetail).mockResolvedValue(null);

    await confirmSelection();

    await screen.findByRole('alert');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not synthesize a project id as a filesystem path', async () => {
    const { onSelect } = renderModal();
    vi.mocked(getProjectDetail).mockResolvedValue({ project, resolvedDir: '' });

    await confirmSelection();

    await screen.findByRole('alert');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects a project only when the daemon returns a resolved directory', async () => {
    const { onSelect } = renderModal();
    vi.mocked(getProjectDetail).mockResolvedValue({
      project,
      resolvedDir: '/tmp/open-design/project-ref',
    });

    await confirmSelection();

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith([
        { project, resolvedDir: '/tmp/open-design/project-ref' },
      ]);
    });
  });

  it('reads a bound reference project with its matching caller identity', async () => {
    const boundProject: Project = {
      ...project,
      workspaceId: 'workspace-ref',
    };
    const context = teamContext();
    renderModal({ projects: [boundProject], workspaceContext: context });
    vi.mocked(getProjectDetail).mockResolvedValue({
      project: boundProject,
      resolvedDir: '/tmp/open-design/project-ref',
    });

    await confirmSelection();

    await waitFor(() => {
      expect(getProjectDetail).toHaveBeenCalledWith(
        'project-ref',
        { ensureDir: true },
        context,
      );
    });
  });

  it('falls back to imported project metadata when older daemons omit resolvedDir', async () => {
    const { onSelect } = renderModal({ projects: [importedProject] });
    vi.mocked(getProjectDetail).mockResolvedValue({
      project: importedProject,
      resolvedDir: null,
    });

    await confirmSelection('Imported Project');

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith([
        { project: importedProject, resolvedDir: '/Users/me/imported' },
      ]);
    });
  });

  it('selects multiple referenced projects in one confirmation', async () => {
    const secondProject: Project = {
      ...project,
      id: 'second-project',
      name: 'Second Project',
    };
    const { onSelect } = renderModal({ projects: [project, secondProject] });
    vi.mocked(getProjectDetail).mockImplementation(async (id: string) => {
      if (id === project.id) {
        return { project, resolvedDir: '/tmp/open-design/project-ref' };
      }
      if (id === secondProject.id) {
        return { project: secondProject, resolvedDir: '/tmp/open-design/second-project' };
      }
      return null;
    });

    await screen.findByText('Reference Project');
    fireEvent.click(screen.getByText('Second Project'));
    fireEvent.click(screen.getByRole('button', { name: 'Reference project' }));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith([
        { project, resolvedDir: '/tmp/open-design/project-ref' },
        { project: secondProject, resolvedDir: '/tmp/open-design/second-project' },
      ]);
    });
  });

  it('browses the same workspace and folder tree as the publish project picker', async () => {
    const personalProject: Project = {
      ...project,
      id: 'personal-project',
      name: 'Personal Project',
    };
    const folderProject: Project = {
      ...project,
      id: 'folder-project',
      name: 'Folder Project',
    };
    const workspaces: WorkspaceDirectoryItem[] = [
      {
        workspaceId: 'personal-workspace',
        workspaceName: 'Personal',
        workspaceType: 'team',
        workspaceMemberId: 'personal-member',
        role: 'owner',
        memberStatus: 'active',
        lifecycleState: 'active',
        isDefaultTeam: true,
      },
      {
        workspaceId: 'team-workspace',
        workspaceName: 'Team Space',
        workspaceType: 'team',
        workspaceMemberId: 'team-member',
        role: 'member',
        memberStatus: 'active',
        lifecycleState: 'active',
      },
    ];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/workspace/directory') {
        return new Response(JSON.stringify({ items: workspaces }), { status: 200 });
      }
      if (url === '/api/folders?workspace_id=personal-workspace') {
        return new Response(JSON.stringify({ data: { folders: [] } }), { status: 200 });
      }
      if (url === '/api/hdw/api/folder/list?workspace_id=team-workspace') {
        return new Response(JSON.stringify({
          data: {
            folders: [{
              folder_id: 'members-folder',
              folder_name: 'Members Folder',
              subfolder_count: 0,
            }],
          },
        }), { status: 200 });
      }
      if (url === '/api/workspaces/personal-workspace/projects?view=all') {
        return new Response(JSON.stringify({
          projects: [{
            workspaceId: 'personal-workspace',
            visibility: 'personal',
            createdByWorkspaceMemberId: 'personal-member',
            project: personalProject,
          }],
        }), { status: 200 });
      }
      if (url === '/api/workspace/projects/team?folder_id=root') {
        return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      }
      if (url === '/api/workspace/projects/team?folder_id=members-folder') {
        return new Response(JSON.stringify({
          projects: [{
            projectId: folderProject.id,
            name: folderProject.name,
            ownerMemberId: 'team-member',
            sharedAt: new Date().toISOString(),
            createdAt: folderProject.createdAt,
            updatedAt: folderProject.updatedAt,
            folderId: 'members-folder',
          }],
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
    const { onSelect } = renderModal();
    vi.mocked(getProjectDetail).mockImplementation(async (id: string) => {
      if (id === personalProject.id) {
        return { project: personalProject, resolvedDir: '/tmp/personal-project' };
      }
      if (id === folderProject.id) {
        return { project: folderProject, resolvedDir: '/tmp/folder-project' };
      }
      return null;
    });

    await screen.findByText('Personal Project');
    expect(screen.getByRole('button', { name: /Team Space/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Members Folder' }));
    fireEvent.click(await screen.findByText('Folder Project'));
    fireEvent.click(screen.getByRole('button', { name: 'Reference project' }));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith([
        { project: personalProject, resolvedDir: '/tmp/personal-project' },
        { project: folderProject, resolvedDir: '/tmp/folder-project' },
      ]);
    });
  });
});
