import type { WorkspaceCollabContext } from '@open-design/contracts';
import type { Project } from '../types';
import type { ProjectTitleHint } from './EntryShell';

/** Preserve the exact collection identity across a card-to-project route change.
 * The shell's ambient Workspace context may still describe the previously
 * visited collection while the new team/personal route is already visible. */
export function projectCollectionTitleHint(
  project: Project,
  workspaceContext: WorkspaceCollabContext,
): ProjectTitleHint {
  const ownerMemberId = project.createdByWorkspaceMemberId?.trim() || null;
  return {
    name: project.name,
    workspaceId: workspaceContext.workspaceId,
    workspaceMemberId: workspaceContext.workspaceMemberId,
    authoritative: Boolean(
      workspaceContext.workspaceType === 'team'
      && ownerMemberId
      && ownerMemberId !== workspaceContext.workspaceMemberId,
    ),
    workspaceContext,
  };
}
