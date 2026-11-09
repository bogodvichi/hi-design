import type {
  ProjectVisibility,
  ProjectWorkspaceScope,
  WorkspaceType,
} from '@open-design/contracts';
import {
  workspaceContextFromDirectoryItem,
} from './vela-workspace-context.js';

interface ProjectWorkspaceBinding {
  workspaceId?: unknown;
  visibility?: unknown;
  workspaceVisibility?: unknown;
  resourceState?: unknown;
  createdByWorkspaceMemberId?: unknown;
}

/**
 * Resolve the browser/runtime scope of a local project without consulting the
 * membership directory. Persisted binding is authoritative for the Workspace
 * id; a complete request or the daemon's already-learned type supplies the
 * Personal/Team presentation hint. Unknown historical private bindings fall
 * back to Personal until the account directory catches up.
 */
export function resolveLocalProjectWorkspaceScope(input: {
  projectId: string;
  binding: ProjectWorkspaceBinding | null | undefined;
  requestWorkspaceMemberId?: string | null;
  requestWorkspaceType?: WorkspaceType | null;
  knownWorkspaceType?: WorkspaceType | null;
  configuredEnv?: Record<string, string>;
  /** A freshly verified resource grant, not membership in the home workspace. */
  shareAccess?: { workspaceId: string; viewerMemberId: string } | null;
}): ProjectWorkspaceScope {
  const projectId = input.projectId.trim();
  const workspaceId = typeof input.binding?.workspaceId === 'string'
    ? input.binding.workspaceId.trim()
    : '';
  if (!workspaceId) {
    return {
      kind: 'unbound',
      projectId,
      workspaceId: null,
      context: null,
    };
  }
  const visibility: ProjectVisibility = (
    input.binding?.visibility === 'team'
    || input.binding?.workspaceVisibility === 'team'
  )
    ? 'team'
    : 'personal';
  const shareAccess = input.shareAccess;
  if (shareAccess && (
    shareAccess.workspaceId !== workspaceId || !shareAccess.viewerMemberId.trim()
  )) {
    return { kind: 'unavailable', projectId, workspaceId, visibility, context: null };
  }
  const workspaceType = shareAccess ? 'team' : input.requestWorkspaceType
    ?? input.knownWorkspaceType
    ?? (visibility === 'team' ? 'team' : 'personal');
  const persistedMemberId = typeof input.binding?.createdByWorkspaceMemberId === 'string'
    ? input.binding.createdByWorkspaceMemberId.trim()
    : '';
  const workspaceMemberId = shareAccess?.viewerMemberId.trim()
    || input.requestWorkspaceMemberId?.trim()
    || persistedMemberId
    || 'local-user';
  const context = workspaceContextFromDirectoryItem({
    workspaceId,
    workspaceName: workspaceId,
    workspaceType,
    workspaceMemberId,
    role: shareAccess ? 'guest' : 'member',
    memberStatus: 'active',
    lifecycleState: input.binding?.resourceState === 'frozen'
      ? 'locked'
      : 'active',
  }, input.configuredEnv);
  if (shareAccess) {
    // A project share permits reading/commenting on this resource only. It
    // never grants membership, writing, or management of its home workspace.
    context.permissions = {
      canManageMembers: false,
      canManageBilling: false,
      canInviteMembers: false,
      canManageAutoRecharge: false,
      canShareProjects: false,
      canWriteSyncedFiles: false,
      canViewWorkspaceSettings: false,
      canManageSharedResources: false,
    };
  }
  if (workspaceType === 'team') {
    return {
      kind: 'team',
      projectId,
      workspaceId,
      visibility,
      context: { ...context, workspaceType: 'team' },
    };
  }
  return {
    kind: 'personal',
    projectId,
    workspaceId,
    visibility,
    context: { ...context, workspaceType: 'personal' },
  };
}
