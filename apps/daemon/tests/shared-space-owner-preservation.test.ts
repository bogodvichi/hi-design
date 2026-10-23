import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  closeDatabase,
  ensureWorkspaceProject,
  getWorkspaceProjectByProjectId,
  insertProject,
  openDatabase,
} from '../src/db.js';
import {
  getSharedSpaceMemberId,
  getSharedSpaceTeamId,
  getTeamMemberId,
} from '../src/ids.js';
import { registerCollabContextHideSignRoutes } from '../src/routes/collab-context-hidesign.js';

const hdwMocks = vi.hoisted(() => ({
  shareToSharedSpace: vi.fn(),
  fetchSharedSpaceInfo: vi.fn(),
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
}));

vi.mock('../src/http/hik_logins/hicoo.js', () => ({
  readSsoConfigFile: () => hdwMocks.ssoConfig.value,
  readSsoUsername: () => hdwMocks.ssoConfig.value.username,
}));

const localFetch = globalThis.fetch;
let server: Server | undefined;
let origin = '';
let tempDir = '';

beforeEach(async () => {
  hdwMocks.shareToSharedSpace.mockReset();
  hdwMocks.shareToSharedSpace.mockResolvedValue({ shared: 1, skipped: 0 });
  hdwMocks.fetchSharedSpaceInfo.mockReset();
  hdwMocks.fetchSharedSpaceInfo.mockResolvedValue(null);
  hdwMocks.ssoConfig.value = {
    username: 'project-owner',
    cookies: [],
    userInfo: { displayName: '项目所有者' },
  };
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'od-shared-space-owner-'));
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
  await rm(tempDir, { recursive: true, force: true });
});

describe('shared-space project owner preservation', () => {
  it('publishes with the home-team owner while creating recipient-scoped share records', async () => {
    const requestTeamShare = vi.fn(async () => ({ version: 1 }));
    const app = express();
    app.use(express.json());
    registerCollabContextHideSignRoutes(app, {
      dataDir: '/test-data',
      requestTeamShare,
    });
    server = await new Promise<Server>((resolve) => {
      const running = createServer(app);
      running.listen(0, '127.0.0.1', () => resolve(running));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    origin = `http://127.0.0.1:${address.port}`;

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

  it('rebinds a personal project creator to the target workspace member', async () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
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

    const app = express();
    app.use(express.json());
    registerCollabContextHideSignRoutes(app, {
      dataDir: tempDir,
      db,
      requestTeamShare: vi.fn(async () => ({ version: 1 })),
    });
    server = await new Promise<Server>((resolve) => {
      const running = createServer(app);
      running.listen(0, '127.0.0.1', () => resolve(running));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    origin = `http://127.0.0.1:${address.port}`;

    const response = await localFetch(`${origin}/api/shared-space/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: 'project-1',
        home_workspace_id: 'home-team',
        recipients: [{ username: 'recipient', displayname: '接收人' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(getWorkspaceProjectByProjectId(db, 'project-1')).toMatchObject({
      workspaceId: 'home-team',
      visibility: 'team',
      createdByWorkspaceMemberId: getTeamMemberId('home-team', 'project-owner'),
    });
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

    const db = openDatabase(tempDir, { dataDir: tempDir });
    const now = Date.now();
    const personalMemberId = getTeamMemberId('personal-workspace', 'yebo');
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
      createdByWorkspaceMemberId: personalMemberId,
      updatedByWorkspaceMemberId: personalMemberId,
      syncState: 'local_only',
      createdAt: now,
      updatedAt: now,
    });

    const requestTeamShare = vi.fn(async () => ({ version: 1 }));
    const app = express();
    app.use(express.json());
    registerCollabContextHideSignRoutes(app, {
      dataDir: tempDir,
      db,
      requestTeamShare,
    });
    server = await new Promise<Server>((resolve) => {
      const running = createServer(app);
      running.listen(0, '127.0.0.1', () => resolve(running));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    origin = `http://127.0.0.1:${address.port}`;

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
