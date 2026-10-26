import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getSharedSpaceMemberId, getSharedSpaceTeamId, getTeamMemberId } from '../src/ids.js';
import { registerCollabContextHideSignRoutes, type RegisterCollabContextHideSignRoutesDeps } from '../src/routes/collab-context-hidesign.js';
import {
  closeDatabase, createWorkspaceFolder, ensureWorkspaceProject,
  getWorkspaceProjectByProjectId, insertProject, listProjectsInFolder,
  openDatabase,
} from '../src/db.js';
import { planWorkspaceProjectReconciliation } from '../src/collab/workspace-projects-reconciler.js';

const hdwMocks = vi.hoisted(() => ({
  shareToSharedSpace: vi.fn(),
  fetchSharedSpaceInfo: vi.fn(),
  fetchHdwTeams: vi.fn(),
  createHdwFolders: vi.fn(),
  createHdwFolderShares: vi.fn(),
  shareFolderProjectsToSharedSpace: vi.fn(),
  ssoConfig: {
    value: {
      username: 'project-owner',
      cookies: [] as string[],
      userInfo: { displayName: '项目所有者' },
    },
  },
}));

vi.mock('../src/http/hdw.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/http/hdw.js')>()),
  shareToSharedSpace: hdwMocks.shareToSharedSpace,
  fetchSharedSpaceInfo: hdwMocks.fetchSharedSpaceInfo,
  fetchHdwTeams: hdwMocks.fetchHdwTeams,
  createHdwFolders: hdwMocks.createHdwFolders,
  createHdwFolderShares: hdwMocks.createHdwFolderShares,
  shareFolderProjectsToSharedSpace: hdwMocks.shareFolderProjectsToSharedSpace,
}));

vi.mock('../src/http/hik_logins/hicoo.js', () => ({
  readSsoConfigFile: () => hdwMocks.ssoConfig.value,
  readSsoUsername: () => hdwMocks.ssoConfig.value.username,
}));

const localFetch = globalThis.fetch;
let server: Server | undefined;
let origin = '';
let tempDir: string;
let db: ReturnType<typeof openDatabase>;

async function startRoutes(requestTeamShare: NonNullable<RegisterCollabContextHideSignRoutesDeps['requestTeamShare']>) {
  const app = express();
  app.use(express.json());
  registerCollabContextHideSignRoutes(app, { dataDir: '/test-data', db, requestTeamShare });
  server = await new Promise<Server>((resolve) => {
    const running = createServer(app);
    running.listen(0, '127.0.0.1', () => resolve(running));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  origin = `http://127.0.0.1:${address.port}`;
}

function seedProject(workspaceId: string, memberId: string, folderId?: string) {
  insertProject(db, { id: 'project-1', name: 'Owner project', createdAt: 1, updatedAt: 1 });
  ensureWorkspaceProject(db, {
    projectId: 'project-1', workspaceId, folderId,
    createdByWorkspaceMemberId: memberId,
  });
}

function share(body: Record<string, unknown>, route = '/api/shared-space/share') {
  return localFetch(`${origin}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients: [{ username: 'recipient' }], ...body }),
  });
}

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'od-share-owner-'));
  db = openDatabase(tempDir, { dataDir: tempDir });
  vi.clearAllMocks();
  hdwMocks.shareToSharedSpace.mockReset();
  hdwMocks.shareToSharedSpace.mockResolvedValue({ shared: 1, skipped: 0 });
  hdwMocks.fetchSharedSpaceInfo.mockReset();
  hdwMocks.fetchSharedSpaceInfo.mockResolvedValue({
    workspace_id: getSharedSpaceTeamId(),
    workspace_member_id: getSharedSpaceMemberId('project-owner'),
  });
  hdwMocks.fetchHdwTeams.mockReset();
  hdwMocks.fetchHdwTeams.mockResolvedValue([{
    workspace_id: 'team-1',
    workspace_member_id: getTeamMemberId('team-1', 'project-owner'),
    role: 'owner',
  }]);
  hdwMocks.createHdwFolders.mockReset();
  hdwMocks.createHdwFolders.mockResolvedValue({ created: 1, skipped: 0 });
  hdwMocks.createHdwFolderShares.mockReset();
  hdwMocks.createHdwFolderShares.mockResolvedValue({ created: 1, skipped: 0 });
  hdwMocks.shareFolderProjectsToSharedSpace.mockReset();
  hdwMocks.shareFolderProjectsToSharedSpace.mockResolvedValue({ shared: 1, skipped: 0 });
  hdwMocks.ssoConfig.value = {
    username: 'project-owner',
    cookies: [],
    userInfo: { displayName: '项目所有者' },
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  const closing = server;
  server = undefined;
  if (closing?.listening) {
    closing.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      closing.close((error) => error ? reject(error) : resolve());
    });
  }
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('shared-space project owner preservation', () => {
  it.each([
    { workspaceId: getSharedSpaceTeamId(), memberId: getSharedSpaceMemberId('project-owner') },
    { workspaceId: 'team-1', memberId: 'directory-issued-owner-id' },
  ])('keeps the authenticated workspace identity when sharing from $workspaceId', async ({ workspaceId, memberId }) => {
    if (workspaceId === 'team-1') {
      hdwMocks.fetchHdwTeams.mockResolvedValue([{
        workspace_id: workspaceId, workspace_member_id: memberId, role: 'owner',
      }]);
    }
    seedProject(workspaceId, memberId);
    let publishedOwner = '';
    const requestTeamShare = vi.fn(async (_id: string, principal: unknown) => {
      publishedOwner = (principal as { memberId: string }).memberId;
      return { version: 1 };
    });
    await startRoutes(requestTeamShare);
    const response = await share({ project_id: 'project-1', home_workspace_id: workspaceId });
    expect(response.status).toBe(200);
    expect(requestTeamShare).toHaveBeenCalledWith('project-1', expect.objectContaining({
      memberId, teamId: workspaceId,
    }), null);
    const binding = getWorkspaceProjectByProjectId(db, 'project-1')!;
    // Exercise the next catalog reconciliation: the old published identity
    // cleared the creator here and removed the project from its owner's list.
    expect(planWorkspaceProjectReconciliation({
      workspaceId, workspaceMemberId: memberId,
      remoteProjects: [{ projectId: 'project-1', ownerMemberId: publishedOwner }],
      localBindings: new Map([['project-1', {
        projectId: 'project-1', workspaceId: binding.workspaceId,
        visibility: binding.visibility, createdByWorkspaceMemberId: binding.createdByWorkspaceMemberId,
        resourceHubResourceId: binding.resourceHubResourceId,
      }]]),
    })).toEqual([]);
    expect(binding.createdByWorkspaceMemberId).toBe(memberId);
    expect(listProjectsInFolder(db, workspaceId, null, memberId)).toHaveLength(1);
    expect(listProjectsInFolder(db, workspaceId, null, 'recipient-member')).toHaveLength(0);
  });

  it('shares a folder with the same owner identity as its personal projects', async () => {
    const workspaceId = getSharedSpaceTeamId();
    const memberId = getSharedSpaceMemberId('project-owner');
    const folderId = createWorkspaceFolder(db, { workspaceId, folderPid: null, folderName: 'My folder', ownerMemberId: memberId });
    seedProject(workspaceId, memberId, folderId);
    const requestTeamShare = vi.fn(async () => ({ version: 1 }));
    await startRoutes(requestTeamShare);
    const response = await share({
      folder_id: folderId, workspace_id: workspaceId, home_workspace_id: workspaceId,
    }, '/api/shared-space/share-folder');
    expect(response.status).toBe(200);
    expect(requestTeamShare).toHaveBeenCalledWith('project-1', expect.objectContaining({ memberId }), null, folderId);
    expect(listProjectsInFolder(db, workspaceId, folderId, memberId)).toHaveLength(1);
  });

  it('rejects sharing through another workspace without moving the original', async () => {
    seedProject('team-1', getTeamMemberId('team-1', 'project-owner'));
    const original = getWorkspaceProjectByProjectId(db, 'project-1');
    const requestTeamShare = vi.fn(async () => ({ version: 1 }));
    await startRoutes(requestTeamShare);
    const response = await share({ project_id: 'project-1', home_workspace_id: getSharedSpaceTeamId() });
    expect(response.status).toBe(409);
    expect(requestTeamShare).not.toHaveBeenCalled();
    expect(hdwMocks.shareToSharedSpace).not.toHaveBeenCalled();
    expect(getWorkspaceProjectByProjectId(db, 'project-1')).toEqual(original);
  });

  it('does not publish another member\'s project as the sharing caller', async () => {
    seedProject('team-1', 'another-owner');
    const requestTeamShare = vi.fn(async () => ({ version: 1 }));
    await startRoutes(requestTeamShare);
    const response = await share({ project_id: 'project-1', home_workspace_id: 'team-1' });
    expect(response.status).toBe(403);
    expect(requestTeamShare).not.toHaveBeenCalled();
    expect(hdwMocks.shareToSharedSpace).not.toHaveBeenCalled();
    expect(getWorkspaceProjectByProjectId(db, 'project-1')?.createdByWorkspaceMemberId).toBe('another-owner');
  });

  it('publishes with the home-team owner while creating recipient-scoped share records', async () => {
    const requestTeamShare = vi.fn(async () => ({ version: 1 }));
    await startRoutes(requestTeamShare);

    const response = await localFetch(`${origin}/api/shared-space/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: 'project-1',
        home_workspace_id: 'team-1',
        recipients: [{ username: 'recipient', displayname: '接收人' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(requestTeamShare).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        memberId: getTeamMemberId('team-1', 'project-owner'),
        teamId: 'team-1',
      }),
      null,
    );
    expect(requestTeamShare).not.toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ memberId: getSharedSpaceMemberId('project-owner') }),
      null,
    );
    expect(hdwMocks.shareToSharedSpace).toHaveBeenCalledWith('/test-data', expect.objectContaining({
      projectId: 'project-1',
      homeWorkspaceId: 'team-1',
      createdByUsername: 'project-owner',
      recipients: [{ username: 'recipient', displayname: '接收人' }],
    }));
  });

  it('rejects cross-workspace rebinding when attempting to share a personal project', async () => {
    const now = Date.now();
    const creatorMemberId = 'member-from-personal-workspace';
    insertProject(db, {
      id: 'project-1',
      name: 'Personal project',
      createdAt: now,
      updatedAt: now,
    });
    ensureWorkspaceProject(db, {
      projectId: 'project-1',
      workspaceId: 'personal-workspace',
      visibility: 'personal',
      resourceState: 'active',
      createdByWorkspaceMemberId: creatorMemberId,
      updatedByWorkspaceMemberId: creatorMemberId,
      syncState: 'local_only',
      createdAt: now,
      updatedAt: now,
    });
    const original = getWorkspaceProjectByProjectId(db, 'project-1');
    const requestTeamShare = vi.fn(async () => ({ version: 1 }));
    await startRoutes(requestTeamShare);

    const response = await share({ project_id: 'project-1', home_workspace_id: 'team-1' });
    expect(response.status).toBe(409);
    expect(getWorkspaceProjectByProjectId(db, 'project-1')).toEqual(original);
    expect(requestTeamShare).not.toHaveBeenCalled();
    expect(hdwMocks.shareToSharedSpace).not.toHaveBeenCalled();
  });

  it('uses the authoritative shared-space member ID for cloud and local ownership', async () => {
    const sharedSpaceId = getSharedSpaceTeamId();
    const sharedSpaceMemberId = 'h5d46096xof2r0vh22ei5rd57';
    expect(sharedSpaceId).toBe('kt7pwus8k23k0sy2x52avt7xv');
    expect(getSharedSpaceMemberId('yebo')).toBe(sharedSpaceMemberId);

    hdwMocks.ssoConfig.value = {
      username: 'yebo',
      cookies: [],
      userInfo: { displayName: 'yebo' },
    };
    hdwMocks.fetchSharedSpaceInfo.mockResolvedValue({
      workspace_id: sharedSpaceId,
      workspace_name: '共享空间',
      workspace_type: 'team',
      workspace_member_id: sharedSpaceMemberId,
      collaborator_member_id: 'collaborator-member',
      role: 'owner',
    });

    seedProject(sharedSpaceId, sharedSpaceMemberId);
    const requestTeamShare = vi.fn(async () => ({ version: 1 }));
    await startRoutes(requestTeamShare);

    const response = await localFetch(`${origin}/api/shared-space/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: 'project-1',
        home_workspace_id: sharedSpaceId,
        recipients: [{ username: 'recipient', displayname: '接收人' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(requestTeamShare).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        memberId: sharedSpaceMemberId,
        teamId: sharedSpaceId,
      }),
      null,
    );
    expect(getWorkspaceProjectByProjectId(db, 'project-1')).toMatchObject({
      workspaceId: sharedSpaceId,
      visibility: 'team',
      createdByWorkspaceMemberId: sharedSpaceMemberId,
      updatedByWorkspaceMemberId: sharedSpaceMemberId,
      syncState: 'pending_upload',
    });
  });
});
