import type { TeamProject, WorkspaceDirectoryItem } from '@open-design/contracts';
import type { Project } from '../types';

export interface ProjectFolderNode {
  id: string;
  name: string;
  parentId: string | null;
  subfolderCount: number;
}

async function fetchProjectFolders(
  workspace: WorkspaceDirectoryItem,
  parentId: string | null = null,
): Promise<ProjectFolderNode[]> {
  const basePath = workspace.isDefaultTeam
    ? `/api/folders?workspace_id=${encodeURIComponent(workspace.workspaceId)}`
    : `/api/hdw/api/folder/list?workspace_id=${encodeURIComponent(workspace.workspaceId)}`;
  const url = parentId
    ? `${basePath}&folder_pid=${encodeURIComponent(parentId)}`
    : basePath;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return [];
  const body = await response.json();
  const rows: any[] = body?.data?.folders ?? [];
  return rows.map((folder) => ({
    id: String(folder.folder_id || folder.id || ''),
    name: String(folder.folder_name || folder.name || ''),
    parentId,
    subfolderCount: Number(folder.subfolder_count) || 0,
  })).filter((folder) => folder.id && folder.name);
}

export async function fetchProjectFolderIndex(
  workspace: WorkspaceDirectoryItem,
): Promise<ProjectFolderNode[]> {
  const result: ProjectFolderNode[] = [];
  const pending: Array<string | null> = [null];
  while (pending.length > 0) {
    const parentId = pending.shift() ?? null;
    const children = await fetchProjectFolders(workspace, parentId);
    for (const child of children) {
      result.push(child);
      if (child.subfolderCount > 0) pending.push(child.id);
    }
  }
  return result;
}

function teamProjectToPickerProject(
  project: TeamProject,
  workspace: WorkspaceDirectoryItem,
): Project {
  const sharedAtMs = Date.parse(project.sharedAt);
  const fallback = Number.isFinite(sharedAtMs) ? sharedAtMs : 0;
  return {
    id: project.projectId,
    name: project.name?.trim() || project.projectId,
    skillId: project.skillId ?? null,
    designSystemId: project.designSystemId ?? null,
    createdAt: typeof project.createdAt === 'number' ? project.createdAt : fallback,
    updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : fallback,
    createdByWorkspaceMemberId: project.ownerMemberId ?? null,
    ownerDisplayName: project.ownerDisplayName ?? null,
    ...(project.metadata ? { metadata: project.metadata } : {}),
    coverDigest: project.coverDigest ?? null,
    workspaceId: workspace.workspaceId,
    workspaceVisibility: 'team',
  };
}

function collectDescendantFolderIds(
  folders: ProjectFolderNode[],
  rootFolderId: string,
): string[] {
  const result = [rootFolderId];
  const queue = [rootFolderId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = folders.filter((folder) => folder.parentId === parentId);
    for (const child of children) {
      result.push(child.id);
      queue.push(child.id);
    }
  }
  return result;
}

export async function fetchOwnedProjectsAtLocation(
  workspace: WorkspaceDirectoryItem,
  folderId: string | null,
  folders: ProjectFolderNode[],
): Promise<Project[]> {
  if (workspace.isDefaultTeam === true) {
    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspace.workspaceId)}/projects?view=all`,
      {
        cache: 'no-store',
        headers: {
          'x-od-workspace-id': workspace.workspaceId,
          'x-od-workspace-member-id': workspace.workspaceMemberId,
          'x-od-workspace-type': workspace.workspaceType,
        },
      },
    );
    if (!response.ok) throw new Error('workspace projects load failed');
    const body = await response.json() as { projects?: any[] };
    return (body.projects ?? [])
      .flatMap((summary) => {
        const project = summary?.project ?? {};
        const ownerMemberId = summary?.createdByWorkspaceMemberId ?? project.createdByWorkspaceMemberId;
        const visibility = summary?.visibility ?? project.workspaceVisibility;
        if (ownerMemberId !== workspace.workspaceMemberId || visibility !== 'personal') return [];
        if (!project.id || !project.name) return [];
        return [{
          ...project,
          coverDigest: summary?.coverDigest ?? project.coverDigest ?? null,
          workspaceId: workspace.workspaceId,
          workspaceVisibility: 'personal',
          createdByWorkspaceMemberId: ownerMemberId,
        } as Project];
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  const folderIds = folderId
    ? collectDescendantFolderIds(folders, folderId)
    : [null];
  const batches = await Promise.all(folderIds.map(async (targetFolderId) => {
    const response = await fetch(
      `/api/workspace/projects/team?folder_id=${encodeURIComponent(targetFolderId ?? 'root')}`,
      {
        cache: 'no-store',
        headers: { 'x-od-workspace-id': workspace.workspaceId },
      },
    );
    if (!response.ok) throw new Error('workspace projects load failed');
    const body = await response.json() as { projects?: TeamProject[] };
    return body.projects ?? [];
  }));

  const deduped = new Map<string, TeamProject>();
  for (const project of batches.flat()) {
    if (project.ownerMemberId === workspace.workspaceMemberId) {
      deduped.set(project.projectId, project);
    }
  }
  return Array.from(deduped.values())
    .map((project) => teamProjectToPickerProject(project, workspace))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
