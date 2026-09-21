import type {
  CollabCloudMemberDirectoryEntry,
  TeamProject,
  WorkspaceCollabContext,
} from '@open-design/contracts';

export async function withTeamProjectOwnerDisplayNames(
  projects: TeamProject[],
  context: WorkspaceCollabContext | null,
  fetchMembers: (
    context: WorkspaceCollabContext,
  ) => Promise<CollabCloudMemberDirectoryEntry[]>,
): Promise<TeamProject[]> {
  if (projects.length === 0 || !context) return projects;
  if (!projects.some((project) => !project.ownerDisplayName?.trim())) {
    return projects;
  }

  const members = await fetchMembers(context).catch(() => []);
  if (members.length === 0) return projects;

  const memberNames = new Map(
    members
      .filter((member) => member.memberId && member.displayName?.trim())
      .map((member) => [member.memberId, member.displayName.trim()]),
  );
  if (memberNames.size === 0) return projects;

  return projects.map((project) => {
    if (project.ownerDisplayName?.trim()) return project;
    const ownerDisplayName = memberNames.get(project.ownerMemberId);
    return ownerDisplayName ? { ...project, ownerDisplayName } : project;
  });
}
