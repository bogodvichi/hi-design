// The ONE read of the shared-space project catalog
// (`GET /api/workspace/projects/shared-with-me`).
//
// The daemon joins `workspace_project_shares` (share metadata) with
// `team_projects` (live project data) so the response always carries the
// current project state. The shared space is workspace-agnostic — the daemon
// resolves the current user from the SSO session, so no workspace headers are
// needed.

import type { SharedWithMeProject, SharedWithMeResponse } from '@open-design/contracts';
import { coalescedGet, forceCoalescedGet } from '../lib/coalesced-get';

const SHARED_WITH_ME_CACHE_KEY = 'shared-with-me-projects';

/**
 * Read the shared-with-me project catalog.
 *
 * Projects shared TO the current user in the shared space. Each project
 * carries an `access` object with `canView: true, canComment: true,
 * canEdit: false` — the shared space grants read + comment only.
 */
export async function fetchSharedWithMeCatalog(options?: {
  force?: boolean;
}): Promise<SharedWithMeProject[]> {
  const run = async (): Promise<SharedWithMeProject[]> => {
    const response = await fetch('/api/workspace/projects/shared-with-me');
    if (!response.ok) throw new Error(`shared-with-me ${response.status}`);
    const body = (await response.json()) as SharedWithMeResponse;
    return body.projects ?? [];
  };
  if (options?.force) {
    return forceCoalescedGet(SHARED_WITH_ME_CACHE_KEY, run);
  }
  return coalescedGet(SHARED_WITH_ME_CACHE_KEY, run);
}

/**
 * Share a project to specific recipients in the shared space.
* Calls the daemon proxy which forwards to the HDW backend.
 */
export async function shareProjectToSharedSpace(input: {
  projectId: string;
  homeWorkspaceId: string;
  recipients: Array<{ username: string; displayname?: string }>;
}): Promise<{ shared: number; skipped: number } | null> {
  const response = await fetch('/api/shared-space/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: input.projectId,
      home_workspace_id: input.homeWorkspaceId,
      recipients: input.recipients,
    }),
  });
  if (!response.ok) return null;
  return await response.json();
}

/**
 * Remove a specific share (unshare from one recipient).
 */
export async function unshareFromSharedSpace(shareId: string): Promise<boolean> {
  const response = await fetch(`/api/shared-space/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) return false;
  const body = await response.json().catch(() => null);
  return body?.ok === true;
}

/**
 * Share an entire folder (including subfolders and all projects) to
 * specific recipients in the shared space. Calls the daemon route which
 * batch-creates cloud folders via HDW /folder/create, then batch-shares
 * all projects via HDW /shared-space/share-batch with folder_id.
 */
export async function shareFolderToSharedSpace(input: {
  folderId: string;
  workspaceId: string;
  homeWorkspaceId: string;
  recipients: Array<{ username: string; displayname?: string }>;
}): Promise<{
  folders_created: number;
  folders_skipped: number;
  projects_shared: number;
  projects_skipped: number;
  total_projects: number;
} | null> {
  const response = await fetch('/api/shared-space/share-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder_id: input.folderId,
      workspace_id: input.workspaceId,
      home_workspace_id: input.homeWorkspaceId,
      recipients: input.recipients,
    }),
  });
  if (!response.ok) return null;
  return await response.json();
}

/**
 * Share a skill or MCP resource to specific recipients in the shared space.
 * Calls the daemon proxy which forwards to the HDW resource-share endpoint.
 */
export async function shareResourceToSharedSpace(input: {
  resourceId: string;
  kind: 'skill' | 'mcp';
  homeWorkspaceId: string;
  recipients: Array<{ username: string; displayname?: string }>;
}): Promise<{ shared: number; skipped: number } | null> {
  const response = await fetch('/api/resource-share/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resource_id: input.resourceId,
      kind: input.kind,
      home_workspace_id: input.homeWorkspaceId,
      recipients: input.recipients,
    }),
  });
  if (!response.ok) return null;
  return await response.json();
}

/**
 * Remove a resource share (unshare from one recipient).
 */
export async function unshareResourceFromSharedSpace(shareId: string): Promise<boolean> {
  const response = await fetch(`/api/resource-share/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) return false;
  const body = await response.json().catch(() => null);
  return body?.ok === true;
}
