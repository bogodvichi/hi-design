// Projects may transfer between Personal and a team only for their creator.
// Management rights never substitute for project ownership.
import express from 'express';
import type http from 'node:http';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerProjectFileRoutes,
  registerProjectRoutes,
} from '../../src/routes/project/index.js';
import { registerCollabContextRoutes } from '../../src/routes/collab-context.js';
import { startBrandExtraction } from '../../src/brands/index.js';
import * as projectFiles from '../../src/projects.js';
import * as hdw from '../../src/http/hdw.js';
import { HdwCloudError } from '../../src/integrations/hdw-cloud.js';
import {
  closeDatabase,
  createWorkspaceFolder,
  deleteProject as dbDeleteProject,
  deleteWorkspaceProject,
  ensureWorkspaceProject,
  getProject,
  getWorkspaceProject,
  getWorkspaceProjectByProjectId,
  insertProject,
  insertConversation,
  listConversations,
  listWorkspaceProjectBindings,
  listWorkspaceProjects,
  openDatabase,
  rebindWorkspaceProject,
  updateProject,
  updateWorkspaceProject,
} from '../../src/db.js';

// Real repo skills root so the bundled brand-kit template resolves, exactly
// like brand-extraction-engine.test.ts.
const SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills');

const NO_LOGO_FALLBACK = async () => ({ changed: false });
const NO_IMAGERY_FALLBACK = async () => ({ changed: false });
const NO_SEED_FALLBACK = async () => ({ changed: false });

// The reporter's real ids from recvqfNnRETNtM, kept verbatim.
const TEAM_WORKSPACE_ID = 'i05lx8ufnrrhloo8qxrpetwt';
const OWNER_MEMBER_ID = 'eu7o99459dcojtv2osoprr5k';
const PERSONAL_WORKSPACE_ID = 'personal-ws-id';
const PERSONAL_MEMBER_ID = 'personal-member-id';

const DESIGN_MD_INPUT = `---
name: Heritage
colors:
  primary: "#1A1C1E"
  secondary: "#6C7278"
---

# Heritage

## Overview
A minimal reference brand used to drive brand extraction fully offline.
`;

function ownerTeamHeaders(extra: Record<string, string> = {}) {
  // Mirrors the real curl from recvqfNnRETNtM byte-for-byte where it matters:
  // owner role, active member, every permission bit granted.
  return {
    'content-type': 'application/json',
    'x-od-workspace-id': TEAM_WORKSPACE_ID,
    'x-od-workspace-member-id': OWNER_MEMBER_ID,
    'x-od-workspace-role': 'owner',
    'x-od-workspace-type': 'team',
    'x-od-workspace-member-status': 'active',
    'x-od-workspace-lifecycle-state': 'active',
    'x-od-workspace-can-share-projects': 'true',
    'x-od-workspace-can-write-synced-files': 'true',
    ...extra,
  };
}

function teamHeaders(input: {
  memberId: string;
  role: 'owner' | 'admin' | 'member';
}) {
  return ownerTeamHeaders({
    'x-od-workspace-member-id': input.memberId,
    'x-od-workspace-role': input.role,
  });
}

function verifiedTeamAuthority(input: {
  workspaceId?: string;
  memberId: string;
  role: 'owner' | 'admin' | 'member';
}) {
  const workspaceId = input.workspaceId ?? TEAM_WORKSPACE_ID;
  return async () => ({
    ok: true as const,
    context: {
      workspaceId,
      workspaceMemberId: input.memberId,
      workspaceType: 'team' as const,
      teamId: workspaceId,
      workspaceName: 'Catalog-only rename team',
      role: input.role,
      memberStatus: 'active' as const,
      lifecycleState: 'active' as const,
      permissions: {
        canManageBilling: input.role === 'owner',
        canManageMembers: input.role !== 'member',
        canInviteMembers: input.role !== 'member',
        canShareProjects: true,
        canWriteSyncedFiles: true,
      },
    },
  });
}

async function listen(app: express.Express): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('project move to personal on an unbound (never-locally-shared) project', () => {
  let tempDir: string;
  let projectsRoot: string;
  let brandsRoot: string;
  let userDesignSystemsRoot: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'od-move-to-personal-'));
    projectsRoot = path.join(tempDir, 'projects');
    brandsRoot = path.join(tempDir, 'brands');
    userDesignSystemsRoot = path.join(tempDir, 'user-design-systems');
    db = openDatabase(projectsRoot, { dataDir: tempDir });
  });

  afterEach(async () => {
    closeDatabase();
    await rm(tempDir, { recursive: true, force: true });
  });

  // Real deps object for `registerProjectRoutes`, wired to the SAME real
  // sqlite db the brand extraction call above writes into — every
  // `projectStore` function is the genuine `db.ts` implementation, not a
  // fixed-snapshot stub, so the route exercises real read-modify-write
  // behavior end to end.
  function buildDeps(overrides: {
    teamProjectCatalog?: unknown;
    hdwCloudClient?: unknown;
    collabSync?: Record<string, unknown>;
    verifyWorkspaceRequestAuthority?: unknown;
    projectFiles?: Record<string, unknown>;
  } = {}) {
    const noop = vi.fn();
    return {
      db,
      design: {},
      http: {
        createSseResponse: noop,
        sendApiError: (res: any, status: number, code: string, message: string, init: Record<string, unknown> = {}) =>
          res.status(status).json({ error: { code, message, ...init } }),
      },
      paths: {
        RUNTIME_DATA_DIR: tempDir,
        DESIGN_SYSTEMS_DIR: '',
        PROJECTS_DIR: projectsRoot,
        SKILLS_DIR: '',
        BRANDS_DIR: brandsRoot,
        USER_DESIGN_SYSTEMS_DIR: userDesignSystemsRoot,
      },
      projectStore: {
        insertProject: (row: any) => insertProject(db, row),
        validateLinkedDirs: () => ({ dirs: [] }),
        getProject: (_db: unknown, id: string) => getProject(db, id),
        updateProject: (_db: unknown, id: string, patch: any) => updateProject(db, id, patch),
        dbDeleteProject: noop,
        removeProjectDir: noop,
        stageProjectDirsForDelete: vi.fn(async () => ({
          rollback: vi.fn(async () => {}),
          commit: vi.fn(async () => {}),
        })),
        deleteWorkspaceProject: (_db: unknown, workspaceId: string, projectId: string) =>
          deleteWorkspaceProject(db, workspaceId, projectId),
        countWorkspaceProjectRefs: vi.fn(() => 1),
        ensureWorkspaceProject: (_db: unknown, input: any) => ensureWorkspaceProject(db, input),
        getWorkspaceProject: (_db: unknown, workspaceId: string, projectId: string) =>
          getWorkspaceProject(db, workspaceId, projectId),
        getWorkspaceProjectByProjectId: (_db: unknown, projectId: string) =>
          getWorkspaceProjectByProjectId(db, projectId),
        listWorkspaceProjectBindings: () => listWorkspaceProjectBindings(db),
        listWorkspaceProjects: (_db: unknown, workspaceId: string) => listWorkspaceProjects(db, workspaceId),
        updateWorkspaceProject: (_db: unknown, workspaceId: string, projectId: string, patch: any) =>
          updateWorkspaceProject(db, workspaceId, projectId, patch),
        rebindWorkspaceProject: (_db: unknown, projectId: string, patch: any) =>
          rebindWorkspaceProject(db, projectId, patch),
      },
      projectFiles: {
        writeProjectFile: noop,
        readProjectFile: noop,
        ensureProject: noop,
        listFiles: () => [],
        listTabs: () => [],
        setTabs: noop,
        resolveProjectDir: () => '',
        ...(overrides.projectFiles ?? {}),
      },
      conversations: { insertConversation: noop },
      templates: {
        getTemplate: noop,
        listTemplates: () => [],
        deleteTemplate: noop,
        insertTemplate: noop,
        findTemplateByNameAndProject: noop,
        updateTemplate: noop,
      },
      status: {
        listLatestProjectRunStatuses: () => new Map(),
        listProjectsAwaitingInput: () => new Set(),
        normalizeProjectDisplayStatus: (status: string) => status,
        composeProjectDisplayStatus: (status: unknown) => status,
        listProjects: () => [],
      },
      events: { subscribeFileEvents: noop, activeProjectEventSinks: new Map() },
      ids: { randomId: () => `id-${Math.random().toString(36).slice(2)}` },
      telemetry: { reportFinalizedMessage: noop },
      appConfig: { readAppConfig: vi.fn(async () => ({})), writeAppConfig: noop },
      agents: {},
      validation: {
        validateProjectDesignSystemId: async () => ({ ok: true, id: null }),
        validateProjectSkillId: async () => ({ ok: true, id: null }),
      },
      collabSync: overrides.collabSync ?? {
        requestTeamShare: noop,
        requestTeamUnshare: noop,
        requestTeamTransfer: noop,
        materializeTeamProject: noop,
        refreshTeamProjectMetadata: noop,
        invalidateTeamProjectCatalog: noop,
      },
     verifyWorkspaceRequestAuthority: overrides.verifyWorkspaceRequestAuthority,
     teamProjectCatalog: overrides.teamProjectCatalog,
     hdwCloudClient: overrides.hdwCloudClient,
     fetchWorkspaceDirectory: async () => ({
       ok: true as const,
       items: [
         {
           workspaceId: TEAM_WORKSPACE_ID,
           workspaceMemberId: OWNER_MEMBER_ID,
           workspaceType: 'team',
           workspaceName: 'Heritage Team',
           role: 'owner',
           memberStatus: 'active',
           lifecycleState: 'active',
           resourceTeamId: TEAM_WORKSPACE_ID,
           permissions: {
             canManageBilling: true,
             canManageMembers: true,
             canInviteMembers: true,
             canShareProjects: true,
             canWriteSyncedFiles: true,
           },
         },
         {
           workspaceId: PERSONAL_WORKSPACE_ID,
           workspaceMemberId: PERSONAL_MEMBER_ID,
           workspaceType: 'personal',
           workspaceName: 'My Workspace',
           role: 'owner',
           memberStatus: 'active',
           lifecycleState: 'active',
           isDefaultTeam: true,
           resourceTeamId: PERSONAL_WORKSPACE_ID,
           permissions: {
             canManageBilling: true,
             canManageMembers: true,
             canInviteMembers: true,
             canShareProjects: true,
             canWriteSyncedFiles: true,
           },
         },
       ],
     }),
    } as unknown as Parameters<typeof registerProjectRoutes>[1];
  }

  it('resolves a shared recipient scope without borrowing the creator identity', async () => {
    const projectId = 'shared-recipient-scope';
    const now = Date.now();
    insertProject(db, {
      id: projectId, name: 'Shared project', skillId: null, designSystemId: null,
      pendingPrompt: null, metadata: {}, customInstructions: null, createdAt: now, updatedAt: now,
    });
    ensureWorkspaceProject(db, {
      workspaceId: 'external-home-team', projectId, visibility: 'team',
      createdByWorkspaceMemberId: 'original-owner',
      updatedByWorkspaceMemberId: 'original-owner', createdAt: now, updatedAt: now,
    });
    const resolveShareAccess = vi.fn(async () => ({
      workspaceId: 'external-home-team', resourceTeamId: 'external-home-team',
      viewerMemberId: 'share-recipient', ownerMemberId: 'original-owner',
    }));
    const app = express();
    const deps = buildDeps({ collabSync: { resolveShareAccess } });
    deps.paths.RUNTIME_DATA_DIR = tempDir;
    registerProjectRoutes(app, deps);
    const { server, url } = await listen(app);
    try {
      const response = await fetch(`${url}/api/projects/${projectId}/workspace-scope`, {
        headers: ownerTeamHeaders(),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ scope: {
        workspaceId: 'external-home-team',
        context: {
          workspaceMemberId: 'share-recipient', role: 'guest',
          permissions: { canWriteSyncedFiles: false, canShareProjects: false },
        },
      } });
      expect(resolveShareAccess).toHaveBeenCalledTimes(1);
      expect(getWorkspaceProjectByProjectId(db, projectId)?.createdByWorkspaceMemberId)
        .toBe('original-owner');
    } finally {
      await close(server);
    }
  });

  describe.each(['single', 'batch'] as const)('personal folder organization (%s)', (mode) => {
    it.each(['personal', 'default-team'] as const)('preserves cloud bindings while organizing a %s home locally', async (home) => {
      const projectIds = ['published-original', 'cloud-personal', 'local-copy'];
      for (const projectId of projectIds) {
        insertProject(db, { id: projectId, name: projectId, skillId: null, designSystemId: null,
          pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 10, updatedAt: 20 });
        ensureWorkspaceProject(db, {
          projectId, workspaceId: PERSONAL_WORKSPACE_ID,
          visibility: projectId === 'published-original' ? 'team' : 'personal', resourceState: 'active',
          createdByWorkspaceMemberId: PERSONAL_MEMBER_ID, updatedByWorkspaceMemberId: PERSONAL_MEMBER_ID,
          resourceHubResourceId: projectId === 'local-copy' ? null : `resource-${projectId}`,
          syncState: projectId === 'local-copy' ? 'local_only' : 'synced',
        });
      }
      const folderId = createWorkspaceFolder(db, { workspaceId: PERSONAL_WORKSPACE_ID,
        folderPid: null, folderName: 'Personal folder', ownerMemberId: PERSONAL_MEMBER_ID });
      const childFolderId = createWorkspaceFolder(db, { workspaceId: PERSONAL_WORKSPACE_ID,
        folderPid: folderId, folderName: 'Child folder', ownerMemberId: PERSONAL_MEMBER_ID });
      const bindings = projectIds.map((id) => getWorkspaceProjectByProjectId(db, id));
      const projects = projectIds.map((id) => getProject(db, id));
      const moveProjectFolder = vi.fn(async () => { throw new HdwCloudError(404, 'FOLDER_NOT_FOUND'); });
      const requestTeamTransfer = vi.fn();
      const requestTeamShare = vi.fn();
      const requestTeamUnshare = vi.fn();
      const authority = verifiedTeamAuthority({ workspaceId: PERSONAL_WORKSPACE_ID, memberId: PERSONAL_MEMBER_ID, role: 'owner' });
      const app = express();
      app.use(express.json());
      registerProjectRoutes(app, buildDeps({
        verifyWorkspaceRequestAuthority: async () => {
          const verified = await authority();
          return { ...verified, context: { ...verified.context,
            workspaceType: home === 'personal' ? 'personal' as const : 'team' as const,
            isDefaultTeam: home === 'default-team',
          } };
        },
        hdwCloudClient: { getTeamProject: vi.fn(async () => ({ folderId: 'cloud-shared-folder' })) },
        collabSync: { moveProjectFolder, requestTeamTransfer, requestTeamShare, requestTeamUnshare },
      }));
      const routeServer = await listen(app);
      try {
        for (const targetFolderId of [folderId, childFolderId, null]) {
          for (const ids of mode === 'single' ? projectIds.map((id) => [id]) : [projectIds]) {
            const response = await fetch(`${routeServer.url}/api/workspaces/${PERSONAL_WORKSPACE_ID}/projects/${mode === 'single' ? `${ids[0]}/move` : 'batch-move'}`, {
              method: 'POST', headers: ownerTeamHeaders({
                'x-od-workspace-id': PERSONAL_WORKSPACE_ID, 'x-od-workspace-member-id': PERSONAL_MEMBER_ID,
                'x-od-workspace-type': home === 'personal' ? 'personal' : 'team',
                'x-od-workspace-is-default-team': String(home === 'default-team'),
              }),
              body: JSON.stringify({ visibility: 'personal', targetWorkspaceId: PERSONAL_WORKSPACE_ID,
                targetFolderId, ...(mode === 'batch' ? { projectIds: ids } : {}) }),
            });
            expect(response.status, await response.clone().text()).toBe(200);
          }
          for (const [index, projectId] of projectIds.entries()) {
            const detail = await fetch(`${routeServer.url}/api/projects/${projectId}`, {
              headers: ownerTeamHeaders({ 'x-od-workspace-id': PERSONAL_WORKSPACE_ID,
                'x-od-workspace-member-id': PERSONAL_MEMBER_ID }),
            });
            expect(detail.status, await detail.clone().text()).toBe(200);
            expect(await detail.json()).toMatchObject({ folderId: targetFolderId });
            const { updatedAt: _updatedAt, ...binding } = bindings[index]!;
            expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({ ...binding, folderId: targetFolderId });
            expect(getProject(db, projectId)).toEqual(projects[index]);
          }
        }
        expect(moveProjectFolder).not.toHaveBeenCalled();
        expect(requestTeamTransfer).not.toHaveBeenCalled();
        expect(requestTeamShare).not.toHaveBeenCalled();
        expect(requestTeamUnshare).not.toHaveBeenCalled();
      } finally { await close(routeServer.server); }
    });
  });

  it.each(['creator', 'other-owner', 'frozen', 'team-home'] as const)(
    'organizes a cloud-only personal project without requiring content editing (%s)', async (scenario) => {
      const projectId = 'cloud-only-personal-project';
      const personalHome = scenario !== 'team-home';
      const workspaceId = personalHome ? PERSONAL_WORKSPACE_ID : TEAM_WORKSPACE_ID;
      const memberId = personalHome ? PERSONAL_MEMBER_ID : OWNER_MEMBER_ID;
      const resourceId = 'cloud-personal-resource';
      const teamProjectCatalog = { list: vi.fn(async () => [{
        id: 'catalog-entry', workspaceId, projectId, resourceId, ownerMemberId: scenario === 'other-owner' ? 'another-member' : memberId,
        displayName: 'Cloud project', syncState: 'synced', lastSyncedVersionId: 'version-1',
        createdAt: new Date(10).toISOString(), updatedAt: new Date(20).toISOString(),
        access: { canView: true, canComment: true, canEdit: false, frozen: scenario === 'frozen' },
      }]), upsert: vi.fn() };
      const materializeTeamProject = vi.fn(async () => {
        insertProject(db, { id: projectId, name: 'Cloud project', skillId: null, designSystemId: null,
          pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 10, updatedAt: 20 });
        ensureWorkspaceProject(db, { projectId, workspaceId, visibility: 'team', resourceState: 'active',
          createdByWorkspaceMemberId: memberId, resourceHubResourceId: resourceId, syncState: 'synced' });
      });
      const moveProjectFolder = vi.fn();
      const requestTeamUnshare = vi.fn();
      const authority = verifiedTeamAuthority({ workspaceId, memberId, role: 'member' });
      const app = express();
      app.use(express.json());
      registerProjectRoutes(app, buildDeps({ teamProjectCatalog,
        verifyWorkspaceRequestAuthority: async () => {
          const verified = await authority();
          return { ...verified, context: { ...verified.context, isDefaultTeam: personalHome } };
        },
        collabSync: { materializeTeamProject, moveProjectFolder, requestTeamUnshare },
      }));
      const routeServer = await listen(app);
      try {
        const response = await fetch(`${routeServer.url}/api/workspaces/${workspaceId}/projects/${projectId}/move`, {
          method: 'POST', headers: ownerTeamHeaders({ 'x-od-workspace-id': workspaceId, 'x-od-workspace-member-id': memberId }),
          body: JSON.stringify({ visibility: personalHome ? 'personal' : 'team', targetWorkspaceId: workspaceId, targetFolderId: 'local-folder' }),
        });
        const allowed = scenario === 'creator' || scenario === 'team-home';
        expect(response.status, await response.clone().text()).toBe(allowed ? 200 : 403);
        expect(materializeTeamProject).toHaveBeenCalledTimes(allowed ? 1 : 0);
        expect(moveProjectFolder).toHaveBeenCalledTimes(scenario === 'team-home' ? 1 : 0);
        expect(requestTeamUnshare).not.toHaveBeenCalled();
        if (allowed) expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({
          workspaceId, visibility: 'team', folderId: 'local-folder', resourceHubResourceId: resourceId, syncState: 'synced',
        });
      } finally { await close(routeServer.server); }
    },
  );

  describe.each(['single', 'batch'] as const)('cloud-only team folder organization (%s)', (mode) => {
    it.each(['creator', 'owner', 'admin', 'member', 'guest', 'frozen'] as const)('checks folder authority without changing ownership (%s)', async (scenario) => {
      const projectId = 'cloud-team-folder-project';
      const creatorId = scenario === 'creator' ? OWNER_MEMBER_ID : 'project-creator';
      const resourceId = 'durable-transfer-resource';
      const teamProjectCatalog = { list: vi.fn(async () => [{
        id: 'catalog-entry', workspaceId: TEAM_WORKSPACE_ID, projectId, resourceId, ownerMemberId: creatorId,
        displayName: 'Team folder project', syncState: 'synced', lastSyncedVersionId: 'version-1',
        createdAt: new Date(10).toISOString(), updatedAt: new Date(20).toISOString(),
        access: { canView: true, canComment: true, canEdit: false, frozen: scenario === 'frozen' },
      }]), upsert: vi.fn() };
      const materializeTeamProject = vi.fn(async () => {
        insertProject(db, { id: projectId, name: 'Team folder project', skillId: null, designSystemId: null,
          pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 10, updatedAt: 20 });
        ensureWorkspaceProject(db, { projectId, workspaceId: TEAM_WORKSPACE_ID, visibility: 'team', resourceState: 'active',
          createdByWorkspaceMemberId: creatorId, resourceHubResourceId: resourceId, syncState: 'synced' });
      });
      const moveProjectFolder = vi.fn();
      const requestTeamTransfer = vi.fn();
      const requestTeamShare = vi.fn();
      const authority = verifiedTeamAuthority({ memberId: OWNER_MEMBER_ID,
        role: scenario === 'owner' || scenario === 'frozen' ? 'owner' : scenario === 'admin' ? 'admin' : 'member' });
      const app = express();
      app.use(express.json());
      registerProjectRoutes(app, buildDeps({ teamProjectCatalog,
        verifyWorkspaceRequestAuthority: async () => {
          const verified = await authority();
          return { ...verified, context: { ...verified.context, ...(scenario === 'guest' ? { role: 'guest' as const } : {}) } };
        },
        collabSync: { materializeTeamProject, moveProjectFolder, requestTeamTransfer, requestTeamShare },
      }));
      const routeServer = await listen(app);
      const allowed = ['creator', 'owner', 'admin'].includes(scenario);
      try {
        const response = await fetch(`${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${mode === 'single' ? `${projectId}/move` : 'batch-move'}`, {
          method: 'POST', headers: ownerTeamHeaders(), body: JSON.stringify({ visibility: 'team',
            targetWorkspaceId: TEAM_WORKSPACE_ID, targetFolderId: 'team-folder', ...(mode === 'batch' ? { projectIds: [projectId] } : {}) }),
        });
        expect(response.status, await response.clone().text()).toBe(allowed ? 200 : 403);
        expect(requestTeamTransfer).not.toHaveBeenCalled();
        expect(requestTeamShare).not.toHaveBeenCalled();
        if (allowed) {
          expect(moveProjectFolder).toHaveBeenCalledWith(TEAM_WORKSPACE_ID, projectId, 'team-folder', OWNER_MEMBER_ID);
          expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({
            workspaceId: TEAM_WORKSPACE_ID, createdByWorkspaceMemberId: creatorId,
            resourceHubResourceId: resourceId, folderId: 'team-folder', syncState: 'synced',
          });
          if (scenario !== 'creator') expect(materializeTeamProject).toHaveBeenCalledWith(
            projectId, expect.objectContaining({ memberId: OWNER_MEMBER_ID }), creatorId,
          );
        } else {
          expect(materializeTeamProject).not.toHaveBeenCalled();
          expect(moveProjectFolder).not.toHaveBeenCalled();
        }
      } finally { await close(routeServer.server); }
    });
  });

  it('still reconciles a real team project folder from the cloud on detail reads', async () => {
    const projectId = 'team-folder-detail';
    insertProject(db, { id: projectId, name: projectId, skillId: null, designSystemId: null,
      pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 10, updatedAt: 20 });
    ensureWorkspaceProject(db, { projectId, workspaceId: TEAM_WORKSPACE_ID, visibility: 'team',
      resourceState: 'active', createdByWorkspaceMemberId: OWNER_MEMBER_ID,
      resourceHubResourceId: 'team-resource', syncState: 'synced' });
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      hdwCloudClient: { getTeamProject: vi.fn(async () => ({ folderId: 'remote-team-folder' })) },
    }));
    const routeServer = await listen(app);
    try {
      const response = await fetch(`${routeServer.url}/api/projects/${projectId}`, { headers: ownerTeamHeaders() });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toMatchObject({ folderId: 'remote-team-folder' });
      expect(getWorkspaceProjectByProjectId(db, projectId)?.folderId).toBe('remote-team-folder');
    } finally { await close(routeServer.server); }
  });

  it.each(['read-only-share', 'catalog-outage', 'other-creator'] as const)(
    'keeps a personal folder project home authoritative during transfer (%s)', async (scenario) => {
      const projectId = 'shared-personal-folder-project';
      insertProject(db, {
        id: projectId, name: 'Shared personal project', skillId: null, designSystemId: null,
        pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 10, updatedAt: 20,
      });
      ensureWorkspaceProject(db, {
        projectId, workspaceId: PERSONAL_WORKSPACE_ID, visibility: 'personal', resourceState: 'active',
        createdByWorkspaceMemberId: scenario === 'other-creator' ? 'another-member' : PERSONAL_MEMBER_ID,
        updatedByWorkspaceMemberId: PERSONAL_MEMBER_ID, syncState: 'synced',
      });
      const teamProjectCatalog = {
        list: vi.fn(async () => {
          if (scenario === 'catalog-outage') throw new Error('catalog unavailable');
          return [{
            id: 'personal-share', workspaceId: PERSONAL_WORKSPACE_ID, projectId,
            resourceId: 'personal-share-resource', ownerMemberId: PERSONAL_MEMBER_ID,
            displayName: 'Shared personal project', syncState: 'synced', lastSyncedVersionId: 'v1',
            createdAt: new Date(10).toISOString(), updatedAt: new Date(20).toISOString(),
            access: { canView: true, canComment: true, canEdit: false, frozen: false },
          }];
        }),
        upsert: vi.fn(),
      };
      const requestTeamTransfer = vi.fn(async () => ({ version: 1, targetOwnerMemberId: OWNER_MEMBER_ID }));
      const moveProjectFolder = vi.fn();
      const authority = verifiedTeamAuthority({ workspaceId: PERSONAL_WORKSPACE_ID, memberId: PERSONAL_MEMBER_ID, role: 'member' });
      const app = express();
      app.use(express.json());
      registerProjectRoutes(app, buildDeps({
        teamProjectCatalog,
        verifyWorkspaceRequestAuthority: async () => {
          const verified = await authority();
          return { ...verified, context: { ...verified.context, isDefaultTeam: true } };
        },
        collabSync: { requestTeamTransfer, moveProjectFolder, invalidateTeamProjectCatalog: vi.fn() },
      }));
      const routeServer = await listen(app);
      try {
        const response = await fetch(`${routeServer.url}/api/workspaces/${PERSONAL_WORKSPACE_ID}/projects/${projectId}/move`, {
          method: 'POST',
          headers: ownerTeamHeaders({
            'x-od-workspace-id': PERSONAL_WORKSPACE_ID,
            'x-od-workspace-member-id': PERSONAL_MEMBER_ID,
            'x-od-workspace-role': 'member',
          }),
          body: JSON.stringify({ visibility: 'team', targetWorkspaceId: TEAM_WORKSPACE_ID, targetFolderId: 'existing-target-folder' }),
        });
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(scenario === 'other-creator' ? 403 : 200);
        expect(teamProjectCatalog.list).not.toHaveBeenCalled();
        if (scenario === 'other-creator') {
          expect(requestTeamTransfer).not.toHaveBeenCalled();
          expect(getWorkspaceProjectByProjectId(db, projectId)?.workspaceId).toBe(PERSONAL_WORKSPACE_ID);
        } else {
          expect(requestTeamTransfer).toHaveBeenCalledWith(projectId, PERSONAL_WORKSPACE_ID, TEAM_WORKSPACE_ID,
            expect.objectContaining({ teamId: TEAM_WORKSPACE_ID, memberId: OWNER_MEMBER_ID }), null);
          expect(moveProjectFolder).toHaveBeenCalledWith(TEAM_WORKSPACE_ID, projectId, 'existing-target-folder', OWNER_MEMBER_ID);
          expect(listWorkspaceProjects(db, TEAM_WORKSPACE_ID)).toEqual([
            expect.objectContaining({ id: projectId, folderId: 'existing-target-folder', createdByWorkspaceMemberId: OWNER_MEMBER_ID }),
          ]);
        }
      } finally {
        await close(routeServer.server);
      }
    },
  );

  describe.each(['single', 'batch'] as const)('personal-to-team transfer (%s)', (mode) => {
    it.each(['writable', 'cloud-published', 'guest', 'removed', 'locked', 'personal', 'folder-failed', 'unpublished', 'timeout', 'forbidden'] as const)(
      'requires a writable team destination and preserves confirmed transfers (%s)', async (destination) => {
        const projectId = 'personal-transfer-policy';
        insertProject(db, { id: projectId, name: 'Personal project', skillId: null, designSystemId: null,
          pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 10, updatedAt: 20 });
        ensureWorkspaceProject(db, { projectId, workspaceId: PERSONAL_WORKSPACE_ID, visibility: destination === 'cloud-published' ? 'team' : 'personal',
          resourceState: 'active', createdByWorkspaceMemberId: PERSONAL_MEMBER_ID, updatedByWorkspaceMemberId: PERSONAL_MEMBER_ID });
        const requestTeamTransfer = vi.fn(async () => ({ targetOwnerMemberId: OWNER_MEMBER_ID }));
        const requestTeamShare = vi.fn(async () => undefined);
        if (destination === 'unpublished') requestTeamTransfer.mockRejectedValueOnce(new HdwCloudError(404, 'source_not_published'));
        if (destination === 'timeout' || destination === 'forbidden') requestTeamTransfer.mockRejectedValueOnce(new HdwCloudError(503, destination));
        const moveProjectFolder = vi.fn(async () => { if (destination === 'folder-failed') throw new Error('folder unavailable'); });
        const authority = verifiedTeamAuthority({ workspaceId: PERSONAL_WORKSPACE_ID, memberId: PERSONAL_MEMBER_ID, role: 'member' });
        const deps = buildDeps({
          verifyWorkspaceRequestAuthority: async () => {
            const verified = await authority();
            return { ...verified, context: { ...verified.context, isDefaultTeam: true } };
          },
          collabSync: { requestTeamTransfer, requestTeamShare, moveProjectFolder, invalidateTeamProjectCatalog: vi.fn() },
        });
        const directory = await deps.fetchWorkspaceDirectory!();
        if (!directory.ok) throw new Error("fixture directory unavailable");
        deps.fetchWorkspaceDirectory = async () => ({ ...directory, items: directory.items.map((item) => item.workspaceId !== TEAM_WORKSPACE_ID ? item : {
          ...item,
          role: destination === 'guest' ? 'guest' : item.role,
          memberStatus: destination === 'removed' ? 'removed' : item.memberStatus,
          lifecycleState: destination === 'locked' ? 'locked' : item.lifecycleState,
          isDefaultTeam: destination === 'personal',
        }) });
        const app = express(); app.use(express.json()); registerProjectRoutes(app, deps);
        const routeServer = await listen(app);
        try {
          const response = await fetch(`${routeServer.url}/api/workspaces/${PERSONAL_WORKSPACE_ID}/projects/${mode === 'single' ? `${projectId}/move` : 'batch-move'}`, {
            method: 'POST', headers: ownerTeamHeaders({ 'x-od-workspace-id': PERSONAL_WORKSPACE_ID, 'x-od-workspace-member-id': PERSONAL_MEMBER_ID }),
            body: JSON.stringify({ projectIds: [projectId], visibility: 'team', targetWorkspaceId: TEAM_WORKSPACE_ID, targetFolderId: 'destination' }),
          });
          const body = await response.json();
          const transferred = ['writable', 'cloud-published', 'folder-failed', 'unpublished'].includes(destination);
          expect(response.status, JSON.stringify(body)).toBe(['writable', 'cloud-published', 'unpublished'].includes(destination) ? 200
            : ['folder-failed', 'timeout', 'forbidden'].includes(destination) ? 503 : 403);
          expect(requestTeamTransfer).toHaveBeenCalledTimes(destination === 'unpublished' ? 2
            : ['writable', 'cloud-published', 'folder-failed', 'timeout', 'forbidden'].includes(destination) ? 1 : 0);
          expect(requestTeamShare).toHaveBeenCalledTimes(destination === 'unpublished' ? 1 : 0);
          if (destination === 'unpublished') expect(requestTeamShare).toHaveBeenCalledWith(projectId,
            expect.objectContaining({ teamId: PERSONAL_WORKSPACE_ID, memberId: PERSONAL_MEMBER_ID }), null);
          expect(getWorkspaceProjectByProjectId(db, projectId)?.workspaceId).toBe(transferred ? TEAM_WORKSPACE_ID : PERSONAL_WORKSPACE_ID);
          if (transferred) expect(listWorkspaceProjects(db, PERSONAL_WORKSPACE_ID)).toHaveLength(0);
          if (mode === 'single' && destination === 'folder-failed') {
            expect(listWorkspaceProjects(db, TEAM_WORKSPACE_ID)[0]?.folderId).toBeNull();
            expect(body).toMatchObject({ error: { details: { movedProject: { id: projectId, workspaceId: TEAM_WORKSPACE_ID, visibility: 'team',
              currentUserAccess: { canMoveToPersonal: true } } } } });
          }
        } finally { await close(routeServer.server); }
      },
    );
  });

  describe.each(['single', 'batch'] as const)('creator-owned team project transfer to Personal (%s)', (mode) => {
    it.each(['creator', 'owner-creator', 'admin-creator', 'foreign-owner', 'foreign-admin', 'unattributed', 'guest', 'removed', 'locked', 'frozen', 'wrong-target', 'transfer-denied', 'transfer-failed', 'folder-failed', 'implicit-target'] as const)(
      'enforces ownership, destination identity and confirmed progress (%s)', async (scenario) => {
        const projectId = 'native-team-project';
        insertProject(db, { id: projectId, name: 'Created in team', skillId: null, designSystemId: null,
          pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 10, updatedAt: 20 });
        ensureWorkspaceProject(db, { projectId, workspaceId: TEAM_WORKSPACE_ID, visibility: 'team',
          resourceState: scenario === 'frozen' ? 'frozen' : 'active',
          createdByWorkspaceMemberId: scenario === 'unattributed' ? null : scenario.startsWith('foreign-') ? 'someone-else' : OWNER_MEMBER_ID,
          updatedByWorkspaceMemberId: OWNER_MEMBER_ID, resourceHubResourceId: 'original-resource', syncState: 'synced' });
        const requestTeamTransfer = vi.fn(async () => {
          if (scenario === 'transfer-denied') throw new HdwCloudError(403, 'CROSS_TEAM_MOVE_FORBIDDEN');
          if (scenario === 'transfer-failed') throw new Error('upstream unavailable');
          return { targetOwnerMemberId: PERSONAL_MEMBER_ID };
        });
        const requestTeamUnshare = vi.fn();
        const requestTeamShare = vi.fn();
        const moveProjectFolder = vi.fn(async () => {
          if (scenario === 'folder-failed') throw new Error('folder unavailable');
        });
        const authority = verifiedTeamAuthority({ memberId: OWNER_MEMBER_ID, role: scenario.includes('admin') ? 'admin'
          : scenario.includes('owner') ? 'owner' : 'member' });
        const app = express();
        app.use(express.json());
        registerProjectRoutes(app, buildDeps({
          verifyWorkspaceRequestAuthority: async (req: express.Request) => {
            if (req.params.workspaceId === PERSONAL_WORKSPACE_ID) {
              const personal = await verifiedTeamAuthority({ workspaceId: PERSONAL_WORKSPACE_ID, memberId: PERSONAL_MEMBER_ID, role: 'owner' })();
              return { ...personal, context: { ...personal.context, isDefaultTeam: true } };
            }
            const verified = await authority();
            return { ...verified, context: { ...verified.context,
              ...(scenario === 'guest' ? { role: 'guest' as const } : {}),
              ...(scenario === 'removed' ? { memberStatus: 'removed' as const } : {}),
              ...(scenario === 'locked' ? { lifecycleState: 'locked' as const } : {}),
            } };
          },
          collabSync: { requestTeamTransfer, requestTeamUnshare, requestTeamShare, moveProjectFolder, invalidateTeamProjectCatalog: vi.fn() },
        }));
        const routeServer = await listen(app);
        try {
          const response = await fetch(`${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${mode === 'single' ? `${projectId}/move` : 'batch-move'}`, {
            method: 'POST', headers: ownerTeamHeaders(), body: JSON.stringify({ visibility: 'personal',
              ...(scenario === 'implicit-target' ? {} : { targetWorkspaceId: scenario === 'wrong-target' ? 'other-team' : PERSONAL_WORKSPACE_ID }),
              targetFolderId: 'personal-folder', ...(mode === 'batch' ? { projectIds: [projectId] } : {}),
            }),
          });
          const body = await response.json();
          const transferred = ['creator', 'owner-creator', 'admin-creator', 'folder-failed', 'implicit-target'].includes(scenario);
          expect(response.status, JSON.stringify(body)).toBe(scenario === 'transfer-failed' ? 503
            : transferred ? 200 : 403);
          expect(requestTeamTransfer).toHaveBeenCalledTimes(transferred || scenario === 'transfer-failed' || scenario === 'transfer-denied' ? 1 : 0);
          if (scenario === 'transfer-denied') expect(body).toMatchObject({ error: { code: 'WORKSPACE_ACCESS_DENIED' } });
          expect(requestTeamUnshare).not.toHaveBeenCalled();
          expect(requestTeamShare).not.toHaveBeenCalled();
          expect(getWorkspaceProjectByProjectId(db, projectId)?.workspaceId).toBe(transferred ? PERSONAL_WORKSPACE_ID : TEAM_WORKSPACE_ID);
          if (transferred) {
            expect(requestTeamTransfer).toHaveBeenCalledWith(projectId, TEAM_WORKSPACE_ID, PERSONAL_WORKSPACE_ID,
              expect.objectContaining({ teamId: PERSONAL_WORKSPACE_ID, memberId: PERSONAL_MEMBER_ID }), null);
            expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({
              visibility: 'personal', createdByWorkspaceMemberId: PERSONAL_MEMBER_ID,
              updatedByWorkspaceMemberId: PERSONAL_MEMBER_ID, cloudTombstonedAt: null, syncState: 'synced',
            });
            expect(listWorkspaceProjects(db, TEAM_WORKSPACE_ID)).toHaveLength(0);
            expect(listWorkspaceProjects(db, PERSONAL_WORKSPACE_ID)[0]?.folderId).toBe('personal-folder');
            expect(moveProjectFolder).not.toHaveBeenCalled();
            expect(getWorkspaceProjectByProjectId(db, projectId)?.resourceHubResourceId).toBeTruthy();
          }
        } finally { await close(routeServer.server); }
      },
    );
  });

  describe.each(['missing', 'placeholder', 'stale-home'] as const)('folder card with %s local state', (state) => {
    it.each([
      ['move', 'ready'], ['copy', 'ready'], ['delete', 'ready'],
      ['move', 'catalog-outage'], ['copy', 'catalog-outage'], ['delete', 'catalog-outage'],
      ['move', 'other-owner'], ['delete', 'other-owner'],
      ['move', 'frozen'], ['copy', 'frozen'], ['delete', 'frozen'],
      ['move', 'pull-failure'], ['copy', 'pull-failure'], ['delete', 'pull-failure'],
      ['move', 'pull-incomplete'], ['copy', 'pull-incomplete'], ['delete', 'pull-incomplete'],
    ] as const)('handles %s with %s authority/content', async (action, scenario) => {
      const projectId = 'folder-card-project';
      const resourceId = `project-${projectId}`;
      const project = {
        id: projectId, name: 'Folder project', skillId: null, designSystemId: null,
        pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 10, updatedAt: 20,
      };
      if (state !== 'missing') {
        insertProject(db, { ...project, metadata: state === 'placeholder' ? { sharedProjectPlaceholderAt: 1 } : null });
        ensureWorkspaceProject(db, {
          projectId, workspaceId: state === 'stale-home' ? PERSONAL_WORKSPACE_ID : TEAM_WORKSPACE_ID,
          visibility: state === 'stale-home' ? 'personal' : 'team', resourceState: 'active',
          createdByWorkspaceMemberId: state === 'stale-home' ? PERSONAL_MEMBER_ID : scenario === 'other-owner' ? 'another-member' : OWNER_MEMBER_ID,
          updatedByWorkspaceMemberId: OWNER_MEMBER_ID, resourceHubResourceId: resourceId, syncState: 'synced',
        });
      }
      const sourceDir = path.join(projectsRoot, projectId);
      if (state === 'stale-home') {
        await mkdir(sourceDir, { recursive: true });
        await writeFile(path.join(sourceDir, 'index.html'), '<main>source content</main>');
      }
      let published = true;
      const teamProjectCatalog = {
        list: vi.fn(async () => published ? [{
          id: 'catalog-project', workspaceId: TEAM_WORKSPACE_ID, projectId, resourceId,
          ownerMemberId: scenario === 'other-owner' ? 'another-member' : OWNER_MEMBER_ID,
          displayName: project.name, syncState: 'synced',
          lastSyncedVersionId: 'version-1', createdAt: new Date(10).toISOString(), updatedAt: new Date(20).toISOString(),
          access: { canView: true, canComment: true, canEdit: scenario !== 'frozen', frozen: scenario === 'frozen' },
        }] : []),
        upsert: vi.fn(),
      };
      if (scenario === 'catalog-outage') teamProjectCatalog.list.mockRejectedValue(new Error('catalog offline'));
      const materializeTeamProject = vi.fn(async () => {
        if (scenario === 'pull-failure') throw new Error('content offline');
        if (scenario === 'pull-incomplete') return;
        if (getProject(db, projectId)) updateProject(db, projectId, { metadata: {} });
        else insertProject(db, project);
        ensureWorkspaceProject(db, {
          projectId, workspaceId: TEAM_WORKSPACE_ID, visibility: 'team', resourceState: 'active',
          createdByWorkspaceMemberId: scenario === 'other-owner' ? 'another-member' : OWNER_MEMBER_ID,
          updatedByWorkspaceMemberId: OWNER_MEMBER_ID,
          resourceHubResourceId: resourceId, syncState: 'synced',
        });
        await mkdir(sourceDir, { recursive: true });
        await writeFile(path.join(sourceDir, 'index.html'), '<main>source content</main>');
      });
      const moveProjectFolder = vi.fn(async () => undefined);
      const requestTeamUnshare = vi.fn(async () => { published = false; });
      const deps = buildDeps({
        teamProjectCatalog,
        verifyWorkspaceRequestAuthority: verifiedTeamAuthority({ memberId: OWNER_MEMBER_ID, role: 'owner' }),
        collabSync: {
          materializeTeamProject, moveProjectFolder, requestTeamUnshare,
          invalidateTeamProjectCatalog: vi.fn(), refreshTeamProjectMetadata: vi.fn(),
        },
        projectFiles: {
          ensureProject: projectFiles.ensureProject, listFiles: projectFiles.listFiles,
          readProjectFile: projectFiles.readProjectFile, writeProjectFile: projectFiles.writeProjectFile,
        },
      });
      deps.projectStore.insertProject = insertProject;
      const deleteLocalProject = vi.fn(dbDeleteProject);
      deps.projectStore.dbDeleteProject = deleteLocalProject;
      deps.projectStore.removeProjectDir = projectFiles.removeProjectDir;
      deps.conversations.insertConversation = insertConversation;
      deps.design = { runs: { list: () => [], cancel: vi.fn() } } as typeof deps.design;
      const revokeGrants = vi.spyOn(hdw, 'unshareProjectFromSharedSpace').mockResolvedValue(true);
      const app = express();
      app.use(express.json());
      registerProjectRoutes(app, deps);
      const routeServer = await listen(app);
      try {
        const endpoint = action === 'move'
          ? `/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`
          : `/api/projects/${projectId}${action === 'copy' ? '/duplicate' : ''}`;
        const response = await fetch(`${routeServer.url}${endpoint}`, {
          method: action === 'delete' ? 'DELETE' : 'POST', headers: ownerTeamHeaders(),
          ...(action === 'delete' ? {} : { body: JSON.stringify(action === 'move'
            ? { visibility: 'team', targetWorkspaceId: TEAM_WORKSPACE_ID, targetFolderId: 'target-folder' } : {}) }),
        });
        const body = await response.json() as { project: { id: string } };
        // An already materialized exact-home project does not need a content
        // pull; the other scenarios require a fresh catalog witness.
        const hasCompleteLocalContent = state === 'stale-home'
          && (scenario === 'pull-failure' || scenario === 'pull-incomplete');
        const managerFolderMove = action === 'move' && scenario === 'other-owner';
        if (scenario !== 'ready' && !hasCompleteLocalContent && !managerFolderMove) {
          expect(response.status, JSON.stringify(body)).toBe(
            scenario === 'other-owner' || scenario === 'frozen' ? 403 : 503,
          );
          expect(deleteLocalProject).not.toHaveBeenCalled();
          expect(requestTeamUnshare).not.toHaveBeenCalled();
          expect(moveProjectFolder).not.toHaveBeenCalled();
          expect(published).toBe(true);
          if (scenario !== 'pull-failure' && scenario !== 'pull-incomplete') {
            expect(materializeTeamProject).not.toHaveBeenCalled();
          }
          return;
        }
        expect(response.status, JSON.stringify(body)).toBe(200);
        if (action === 'delete') {
          expect(getProject(db, projectId)).toBeNull();
          expect(getWorkspaceProjectByProjectId(db, projectId)).toBeUndefined();
          expect(published).toBe(false);
          expect(revokeGrants).toHaveBeenCalled();
          expect(fs.existsSync(sourceDir)).toBe(false);
        } else {
          expect(getProject(db, projectId)?.name).toBe(project.name);
          expect(getWorkspaceProjectByProjectId(db, projectId)?.workspaceId).toBe(TEAM_WORKSPACE_ID);
          expect(fs.readFileSync(path.join(sourceDir, 'index.html'), 'utf8')).toContain('source content');
          if (action === 'move') {
            expect(moveProjectFolder).toHaveBeenCalledWith(TEAM_WORKSPACE_ID, projectId, 'target-folder', OWNER_MEMBER_ID);
            expect(listWorkspaceProjects(db, TEAM_WORKSPACE_ID).find((row) => row.id === projectId)?.folderId).toBe('target-folder');
            if (managerFolderMove) expect(getWorkspaceProjectByProjectId(db, projectId)?.createdByWorkspaceMemberId).toBe('another-member');
          } else {
            expect(body.project.id).not.toBe(projectId);
            expect(fs.readFileSync(path.join(projectsRoot, body.project.id, 'index.html'), 'utf8')).toContain('source content');
          }
        }
      } finally {
        await close(routeServer.server);
        revokeGrants.mockRestore();
      }
    });
  });

  it('never locally binds the backing project a real design-system extraction creates', async () => {
    // Real production call, no hand-written database rows: this is exactly
    // `POST /api/brands` → `startBrandExtraction` (apps/daemon/src/brand-routes.ts).
    // Deliberately omits `userDesignSystemsRoot` so the pipeline takes its
    // synchronous, non-programmatic path (no backgrounded network-touching
    // work left dangling past this call) — the exact line under test
    // (brands/index.ts's unconditional `insertProject` with no workspace
    // binding) runs on BOTH paths, so this stays a faithful real-code repro
    // of the root cause without the flakiness of a real font/network fetch.
    const result = await startBrandExtraction({
      designMd: DESIGN_MD_INPUT,
      brandsRoot,
      projectsRoot,
      skillsRoot: SKILLS_ROOT,
      db,
      logoFallback: NO_LOGO_FALLBACK,
      imageryFallback: NO_IMAGERY_FALLBACK,
      seedFallback: NO_SEED_FALLBACK,
    });

    expect(getProject(db, result.projectId)).toBeTruthy();
    // The actual bug precondition, produced by real code: the backing
    // project has no `workspace_projects` row at all.
    expect(getWorkspaceProjectByProjectId(db, result.projectId)).toBeUndefined();
  });

  it('preserves the project, renamed content and conversations through a personal/team round trip', async () => {
    const projectId = `move-round-trip-${Date.now()}`;
    const renamed = '主视觉（已重命名）';
    const teamFolderIds = ['team-folder-a'];
    insertProject(db, {
      id: projectId,
      name: '主视觉',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    ensureWorkspaceProject(db, {
      projectId,
      workspaceId: PERSONAL_WORKSPACE_ID,
      visibility: 'personal',
      resourceState: 'active',
      createdByWorkspaceMemberId: PERSONAL_MEMBER_ID,
      updatedByWorkspaceMemberId: PERSONAL_MEMBER_ID,
      resourceHubResourceId: null,
      cloudTombstonedAt: null,
      syncState: 'local_only',
    });
    const projectDir = path.join(projectsRoot, projectId);
    const entryFilePath = path.join(projectDir, 'index.html');
    await mkdir(projectDir, { recursive: true });
    await writeFile(entryFilePath, '<main>round trip</main>', 'utf8');

    const requestTeamTransfer = vi.fn(async (_id: string, _source: string, target: string) => ({
      targetOwnerMemberId: target === PERSONAL_WORKSPACE_ID ? PERSONAL_MEMBER_ID : OWNER_MEMBER_ID,
    }));
    const requestTeamUnshare = vi.fn(async () => undefined);
    const moveProjectFolder = vi.fn(async () => undefined);
    const readProjectFile = vi.fn(async () => ({
      mime: 'text/html',
      buffer: Buffer.from('<main>round trip</main>'),
    }));
    const app = express();
    app.use(express.json());
    const deps = buildDeps({
      collabSync: {
        requestTeamShare: vi.fn(async () => undefined),
        requestTeamTransfer,
        requestTeamUnshare,
        moveProjectFolder,
        refreshTeamProjectMetadata: vi.fn(),
        invalidateTeamProjectCatalog: vi.fn(),
      },
      projectFiles: {
        readProjectFile,
      },
    }) as any;
    registerProjectRoutes(app, deps);
    registerProjectFileRoutes(app, {
      ...deps,
      http: {
        ...deps.http,
        sendMulterError: vi.fn(),
      },
      uploads: {
        upload: {
          single: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
        },
      },
      node: { fs },
      projectFiles: {
        ...deps.projectFiles,
        listProjectFolders: vi.fn(async () => []),
        createProjectFolder: vi.fn(),
        deleteProjectFolder: vi.fn(),
        searchProjectFiles: vi.fn(async () => []),
        readProjectFile,
        resolveProjectDir: () => projectDir,
        resolveProjectFilePath: vi.fn(async () => ({
          filePath: entryFilePath,
          mime: 'text/html',
          size: Buffer.byteLength('<main>round trip</main>'),
          mtime: Date.now(),
        })),
        parseByteRange: vi.fn(() => null),
        renameProjectFile: vi.fn(),
        deleteProjectFile: vi.fn(),
        sanitizeName: (value: string) => value,
        sanitizePath: (value: string) => value,
      },
      documents: { buildDocumentPreview: vi.fn() },
      artifacts: { validateArtifactManifestInput: vi.fn() },
      projectPreviewScopes: {
        mint: vi.fn(() => 'scope'),
        expiresAt: vi.fn(() => Date.now() + 60_000),
        resolve: vi.fn(),
        renew: vi.fn(),
      },
    } as any);
    const routeServer = await listen(app);
    const personalHeaders = ownerTeamHeaders({
      'x-od-workspace-id': PERSONAL_WORKSPACE_ID,
      'x-od-workspace-member-id': PERSONAL_MEMBER_ID,
      'x-od-workspace-type': 'personal',
    });
    const assertOpen = async (
      headers: Record<string, string>,
      workspaceId: string,
      folderId: string | null,
    ) => {
      const detail = await fetch(`${routeServer.url}/api/projects/${projectId}`, { headers });
      expect(detail.status, await detail.clone().text()).toBe(200);
      await expect(detail.json()).resolves.toMatchObject({
        project: { id: projectId, name: renamed, workspaceId },
        folderId,
      });
      const file = await fetch(
        `${routeServer.url}/api/projects/${projectId}/raw/index.html`,
        { headers },
      );
      expect(file.status, await file.clone().text()).toBe(200);
      expect(await file.text()).toContain('round trip');
    };

    try {
      const rename = await fetch(`${routeServer.url}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: personalHeaders,
        body: JSON.stringify({ name: renamed }),
      });
      expect(rename.status, await rename.clone().text()).toBe(200);
      await expect(rename.json()).resolves.toMatchObject({ project: { name: renamed } });
      await assertOpen(personalHeaders, PERSONAL_WORKSPACE_ID, null);

      for (const teamFolderId of teamFolderIds) {
        const moveToTeam = await fetch(
          `${routeServer.url}/api/workspaces/${PERSONAL_WORKSPACE_ID}/projects/${projectId}/move`,
          {
            method: 'POST',
            headers: personalHeaders,
            body: JSON.stringify({
              visibility: 'team',
              targetWorkspaceId: TEAM_WORKSPACE_ID,
              targetFolderId: teamFolderId,
            }),
          },
        );
        expect(moveToTeam.status, await moveToTeam.clone().text()).toBe(200);
        await expect(moveToTeam.json()).resolves.toMatchObject({
          project: {
            id: projectId,
            workspaceId: TEAM_WORKSPACE_ID,
            createdByWorkspaceMemberId: OWNER_MEMBER_ID,
            currentUserAccess: {
              canMoveToPersonal: true,
              canRename: true,
            },
          },
        });
        await assertOpen(ownerTeamHeaders(), TEAM_WORKSPACE_ID, teamFolderId);
        const conversationsBefore = listConversations(db, projectId);

        const moveToPersonal = await fetch(
          `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
          {
            method: 'POST',
            headers: ownerTeamHeaders(),
            body: JSON.stringify({
              visibility: 'personal',
              targetWorkspaceId: PERSONAL_WORKSPACE_ID,
              targetFolderId: null,
            }),
          },
        );
        expect(moveToPersonal.status, await moveToPersonal.clone().text()).toBe(200);
        await expect(moveToPersonal.json()).resolves.toMatchObject({ project: {
          id: projectId, workspaceId: PERSONAL_WORKSPACE_ID, visibility: 'personal',
          createdByWorkspaceMemberId: PERSONAL_MEMBER_ID,
          currentUserAccess: { canRename: true },
        } });
        await assertOpen(personalHeaders, PERSONAL_WORKSPACE_ID, null);
        expect(listConversations(db, projectId)).toEqual(conversationsBefore);
        expect(listWorkspaceProjects(db, TEAM_WORKSPACE_ID)).toHaveLength(0);
      }

      expect(requestTeamTransfer).toHaveBeenCalledTimes(teamFolderIds.length * 2);
      expect(requestTeamUnshare).not.toHaveBeenCalled();
      expect(moveProjectFolder).toHaveBeenCalledTimes(teamFolderIds.length);
    } finally {
      await close(routeServer.server);
    }
  });

  describe.each(['single', 'batch'] as const)('folder organization with a stale local home (%s)', (mode) => {
    it.each(['personal', 'team', 'foreign-owner', 'frozen', 'locked', 'tombstoned'] as const)(
      'uses verified catalog ownership without requiring content editing (%s)', async (scenario) => {
        const projectId = 'stale-folder-home';
        const personal = scenario !== 'team';
        const workspaceId = personal ? PERSONAL_WORKSPACE_ID : TEAM_WORKSPACE_ID;
        const memberId = personal ? PERSONAL_MEMBER_ID : OWNER_MEMBER_ID;
        insertProject(db, { id: projectId, name: 'Stale folder home', skillId: null, designSystemId: null,
          pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 10, updatedAt: 20 });
        ensureWorkspaceProject(db, { projectId, workspaceId: personal ? TEAM_WORKSPACE_ID : PERSONAL_WORKSPACE_ID,
          visibility: 'team', resourceState: 'active', createdByWorkspaceMemberId: personal ? OWNER_MEMBER_ID : PERSONAL_MEMBER_ID,
          resourceHubResourceId: 'old-resource', syncState: 'synced',
          cloudTombstonedAt: scenario === 'tombstoned' ? 30 : null });
        const before = getWorkspaceProjectByProjectId(db, projectId);
        const folderId = createWorkspaceFolder(db, { workspaceId, folderPid: null, folderName: 'Target', ownerMemberId: memberId });
        const teamProjectCatalog = { list: vi.fn(async () => [{
          id: 'current-catalog', workspaceId, projectId, resourceId: 'current-resource',
          ownerMemberId: scenario === 'foreign-owner' ? 'another-member' : memberId,
          displayName: 'Stale folder home', syncState: 'synced', lastSyncedVersionId: 'v1',
          createdAt: new Date(10).toISOString(), updatedAt: new Date(20).toISOString(),
          access: { canView: true, canComment: true, canEdit: false, frozen: scenario === 'frozen' },
        }]), upsert: vi.fn() };
        const authority = verifiedTeamAuthority({ workspaceId, memberId, role: 'owner' });
        const moveProjectFolder = vi.fn(), requestTeamTransfer = vi.fn();
        const app = express();
        app.use(express.json());
        registerProjectRoutes(app, buildDeps({ teamProjectCatalog,
          verifyWorkspaceRequestAuthority: async () => {
            const verified = await authority();
            return { ...verified, context: { ...verified.context, isDefaultTeam: personal,
              lifecycleState: scenario === 'locked' ? 'locked' : 'active' } };
          },
          collabSync: { moveProjectFolder, requestTeamTransfer },
        }));
        const routeServer = await listen(app);
        try {
          const response = await fetch(`${routeServer.url}/api/workspaces/${workspaceId}/projects/${mode === 'single' ? `${projectId}/move` : 'batch-move'}`, {
            method: 'POST', headers: ownerTeamHeaders({ 'x-od-workspace-id': workspaceId, 'x-od-workspace-member-id': memberId }),
            body: JSON.stringify({ visibility: personal ? 'personal' : 'team', targetWorkspaceId: workspaceId,
              targetFolderId: folderId, ...(mode === 'batch' ? { projectIds: [projectId] } : {}) }),
          });
          const allowed = scenario === 'personal' || scenario === 'team';
          expect(response.status, await response.clone().text()).toBe(allowed ? 200 : 403);
          if (allowed) {
            expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({ workspaceId, visibility: 'team',
              createdByWorkspaceMemberId: memberId, resourceHubResourceId: 'current-resource', folderId, syncState: 'synced' });
            expect(moveProjectFolder).toHaveBeenCalledTimes(personal ? 0 : 1);
          } else {
            expect(getWorkspaceProjectByProjectId(db, projectId)).toEqual(before);
            expect(moveProjectFolder).not.toHaveBeenCalled();
          }
          expect(getProject(db, projectId)?.updatedAt).toBe(20);
          expect(requestTeamTransfer).not.toHaveBeenCalled();
        } finally { await close(routeServer.server); }
      },
    );
  });

  it('repairs a stale personal home before moving its creator-owned team catalog project into a folder', async () => {
    const projectId = `stale-personal-home-${Date.now()}`;
    const resourceId = `project-${projectId}`;
    const targetFolderId = 'team-folder-main-visual';
    insertProject(db, {
      id: projectId,
      name: '主视觉22',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: 10,
      updatedAt: 20,
    });
    // Exact production failure shape: content exists and the team catalog
    // lists it under the destination team, but the daemon still has the one
    // local binding parked under Personal.
    ensureWorkspaceProject(db, {
      projectId,
      workspaceId: PERSONAL_WORKSPACE_ID,
      visibility: 'team',
      resourceState: 'active',
      createdByWorkspaceMemberId: PERSONAL_MEMBER_ID,
      updatedByWorkspaceMemberId: PERSONAL_MEMBER_ID,
      resourceHubResourceId: `personal-${resourceId}`,
      cloudTombstonedAt: null,
      syncState: 'synced',
    });
    const teamProjectCatalog = {
      // Mirrors the affected development runtime: Vela is selected but the
      // binary is unavailable, while the HDW HTTP endpoint remains healthy.
      list: vi.fn(async () => {
        throw new Error('vela binary not found');
      }),
      upsert: vi.fn(),
    };
    const getTeamProject = vi.fn(async () => ({
      id: `catalog-${projectId}`,
      workspaceId: TEAM_WORKSPACE_ID,
      projectId,
      resourceId,
      ownerMemberId: OWNER_MEMBER_ID,
      displayName: '主视觉22',
      syncState: 'synced',
      lastSyncedVersionId: 'version-1',
      createdAt: new Date(10).toISOString(),
      updatedAt: new Date(20).toISOString(),
      access: { canView: true, canComment: true, canEdit: true, frozen: false },
    }));
    const moveProjectFolder = vi.fn(async () => undefined);
    const requestTeamShare = vi.fn(async () => undefined);
    const requestTeamUnshare = vi.fn(async () => undefined);
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      hdwCloudClient: { getTeamProject },
      collabSync: {
        requestTeamShare,
        requestTeamUnshare,
        moveProjectFolder,
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      const response = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: ownerTeamHeaders(),
          body: JSON.stringify({
            visibility: 'team',
            targetFolderId,
          }),
        },
      );
      const body = await response.json() as any;

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.project).toMatchObject({
        id: projectId,
        workspaceId: TEAM_WORKSPACE_ID,
        visibility: 'team',
        createdByWorkspaceMemberId: OWNER_MEMBER_ID,
      });
      expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({
        workspaceId: TEAM_WORKSPACE_ID,
        visibility: 'team',
        folderId: targetFolderId,
        createdByWorkspaceMemberId: OWNER_MEMBER_ID,
        resourceHubResourceId: expect.any(String),
      });
      expect(moveProjectFolder).toHaveBeenCalledWith(
        TEAM_WORKSPACE_ID,
        projectId,
        targetFolderId,
        OWNER_MEMBER_ID,
      );
      expect(requestTeamShare).not.toHaveBeenCalled();
      expect(requestTeamUnshare).not.toHaveBeenCalled();
      expect(getTeamProject).toHaveBeenCalledWith(TEAM_WORKSPACE_ID, projectId);
    } finally {
      await close(routeServer.server);
    }
  });

  it('lets a workspace owner organize a teammate catalog project with a stale local home', async () => {
    const projectId = `stale-personal-home-foreign-${Date.now()}`;
    const resourceId = `project-${projectId}`;
    insertProject(db, {
      id: projectId,
      name: 'Another member project',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: 10,
      updatedAt: 20,
    });
    ensureWorkspaceProject(db, {
      projectId,
      workspaceId: PERSONAL_WORKSPACE_ID,
      visibility: 'team',
      resourceState: 'active',
      createdByWorkspaceMemberId: PERSONAL_MEMBER_ID,
      updatedByWorkspaceMemberId: PERSONAL_MEMBER_ID,
      resourceHubResourceId: `personal-${resourceId}`,
      cloudTombstonedAt: null,
      syncState: 'synced',
    });
    const teamProjectCatalog = {
      list: vi.fn(async () => [{
        id: `catalog-${projectId}`,
        workspaceId: TEAM_WORKSPACE_ID,
        projectId,
        resourceId,
        ownerMemberId: 'another-project-creator',
        displayName: 'Another member project',
        syncState: 'synced',
        lastSyncedVersionId: 'version-1',
        createdAt: new Date(10).toISOString(),
        updatedAt: new Date(20).toISOString(),
        access: { canView: true, canComment: true, canEdit: true, frozen: false },
      }]),
      upsert: vi.fn(),
    };
    const moveProjectFolder = vi.fn(async () => undefined);
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      collabSync: {
        requestTeamShare: vi.fn(),
        requestTeamUnshare: vi.fn(),
        moveProjectFolder,
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      const response = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: ownerTeamHeaders(),
          body: JSON.stringify({
            visibility: 'team',
            targetFolderId: 'target-folder',
          }),
        },
      );

      expect(response.status, await response.clone().text()).toBe(200);
      expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({
        workspaceId: TEAM_WORKSPACE_ID,
        createdByWorkspaceMemberId: 'another-project-creator',
      });
      expect(moveProjectFolder).toHaveBeenCalledTimes(1);
    } finally {
      await close(routeServer.server);
    }
  });

  it('closes the causal gap: the real endpoint the web client reads for "is this shared" reports the unbound project as shared', async () => {
    // Sharpest objection to this whole diagnosis: if the project's local
    // workspace_projects row genuinely never existed, why would the web
    // client ever have shown it as team-shared in the first place (the
    // precondition for a user to see, and click, "move out of team")?
    //
    // Verified answer, from the REAL client + REAL daemon code (not
    // assumption): the web client does NOT read `workspace_projects` to
    // decide this. Both real UI surfaces that gate the "move to personal"
    // affordance —
    //   - `RecentProjectsStrip.tsx`'s "共享" badge / "移出团队" menu item, via
    //     `createSharedProjectPredicate({ teamProjects })`
    //     (apps/web/src/collab/all-projects-list.ts)
    //   - `FileWorkspace.tsx`'s in-project Share toggle, via
    //     `projectIsSharedWithWorkspace(projectId)`, which falls back to the
    //     exact same source
    // both resolve `teamProjects` from `GET /api/workspace/projects/team`
    // (apps/daemon/src/routes/collab-context.ts), which is backed by the
    // resource hub's OWN team-project catalog — an external system this
    // daemon's local sqlite does not control and is not the same store as
    // `workspace_projects`. `apps/daemon/src/collab/team-projects.ts`
    // confirms it: `createTeamProjectsLister` calls
    // `teamProjectCatalog.list()` directly, the identical client instance
    // (`velaCliTeamProjectCatalog`, wired in server.ts) `/move`'s own
    // `teamProjectCatalog` reconciliation reads.
    //
    // So: whenever the hub genuinely lists a project (for whatever external
    // reason — this codebase's own brand-extraction pipeline never
    // registers one, so that registration is not something this repo's code
    // performs; it is either the hub's own cross-referencing of the
    // extraction's linked, team-claimed design system, or a share taken from
    // a different device/session), a user opening this project SEES it as
    // team-shared and "move to personal" is a live, meaningful action — with
    // or without a matching LOCAL `workspace_projects` row. This test proves
    // that half of the chain with the real route, not a guess: inject the
    // exact same hub record `/move`'s tests use directly into
    // `registerCollabContextRoutes`'s `listTeamProjects` seam (the
    // documented test injection point for this exact external dependency)
    // and confirm the endpoint the client actually calls echoes it back.
    const result = await startBrandExtraction({
      designMd: DESIGN_MD_INPUT,
      brandsRoot,
      projectsRoot,
      skillsRoot: SKILLS_ROOT,
      db,
      logoFallback: NO_LOGO_FALLBACK,
      imageryFallback: NO_IMAGERY_FALLBACK,
      seedFallback: NO_SEED_FALLBACK,
    });
    expect(getWorkspaceProjectByProjectId(db, result.projectId)).toBeUndefined();

    const app = express();
    app.use(express.json());
    registerCollabContextRoutes(app, {
      workspaceContext: { current: async () => null },
      fetchWorkspaceDirectory: async () => ({
        ok: true,
        items: [
          {
            workspaceId: TEAM_WORKSPACE_ID,
            workspaceMemberId: OWNER_MEMBER_ID,
            workspaceType: 'team',
            workspaceName: 'Heritage Team',
            role: 'owner',
            memberStatus: 'active',
            lifecycleState: 'active',
            resourceTeamId: TEAM_WORKSPACE_ID,
            permissions: {
              canManageBilling: true,
              canManageMembers: true,
              canInviteMembers: true,
              canShareProjects: true,
              canWriteSyncedFiles: true,
            },
          },
        ],
      }),
      listTeamProjects: async () => [
        {
          projectId: result.projectId,
          ownerMemberId: 'some-other-member-id',
          sharedAt: new Date(10).toISOString(),
          name: 'Heritage Design System',
        },
      ],
    });
    const routeServer = await listen(app);
    try {
      const resp = await fetch(`${routeServer.url}/api/workspace/projects/team`, {
        headers: ownerTeamHeaders(),
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { projects: Array<{ projectId: string }> };
      expect(body.projects.some((project) => project.projectId === result.projectId)).toBe(true);
    } finally {
      await close(routeServer.server);
    }
  });

  it('materializes a catalog-only creator project before transferring it to Personal', async () => {
    const projectId = `catalog-only-owner-${Date.now()}`;
    const resourceId = `project-${projectId}`;
    const teamProjectCatalog = {
      list: vi.fn(async () => [{
        id: `catalog-${projectId}`,
        workspaceId: TEAM_WORKSPACE_ID,
        projectId,
        resourceId,
        ownerMemberId: OWNER_MEMBER_ID,
        displayName: 'Catalog-only owner project',
        syncState: 'synced',
        lastSyncedVersionId: 'version-1',
        createdAt: new Date(10).toISOString(),
        updatedAt: new Date(20).toISOString(),
        access: { canView: true, canComment: true, canEdit: true, frozen: false },
      }]),
      upsert: vi.fn(),
    };
    const materializeTeamProject = vi.fn(async () => {
      insertProject(db, {
        id: projectId,
        name: 'Catalog-only owner project',
        skillId: null,
        designSystemId: null,
        pendingPrompt: null,
        metadata: null,
        customInstructions: null,
        createdAt: 10,
        updatedAt: 20,
      });
      ensureWorkspaceProject(db, {
        projectId,
        workspaceId: TEAM_WORKSPACE_ID,
        visibility: 'team',
        resourceState: 'active',
        createdByWorkspaceMemberId: OWNER_MEMBER_ID,
        updatedByWorkspaceMemberId: OWNER_MEMBER_ID,
        resourceHubResourceId: resourceId,
        cloudTombstonedAt: null,
        syncState: 'synced',
      });
    });
    const requestTeamUnshare = vi.fn(async () => undefined);
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      collabSync: {
        requestTeamShare: vi.fn(),
        requestTeamUnshare,
        requestTeamTransfer: vi.fn(async () => ({ targetOwnerMemberId: PERSONAL_MEMBER_ID })),
        materializeTeamProject,
        refreshTeamProjectMetadata: vi.fn(),
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      expect(getProject(db, projectId)).toBeNull();

      const response = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: ownerTeamHeaders(),
          body: JSON.stringify({ visibility: 'personal' }),
        },
      );

      expect(response.status, await response.clone().text()).toBe(200);
      expect(materializeTeamProject).toHaveBeenCalledTimes(1);
      expect(requestTeamUnshare).not.toHaveBeenCalled();
      expect(getProject(db, projectId)?.name).toBe('Catalog-only owner project');
      expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({ workspaceId: PERSONAL_WORKSPACE_ID, visibility: 'personal', createdByWorkspaceMemberId: PERSONAL_MEMBER_ID });
    } finally {
     await close(routeServer.server);
   }
 });

 it('materializes and renames an exact-owner Team catalog project on a fresh daemon', async () => {
    const projectId = `catalog-only-owner-rename-${Date.now()}`;
    const resourceId = `project-${projectId}`;
    const teamProjectCatalog = {
      list: vi.fn(async () => [{
        id: `catalog-${projectId}`,
        workspaceId: TEAM_WORKSPACE_ID,
        projectId,
        resourceId,
        ownerMemberId: OWNER_MEMBER_ID,
        displayName: 'Remote project before rename',
        syncState: 'synced',
        lastSyncedVersionId: 'version-1',
        createdAt: new Date(10).toISOString(),
        updatedAt: new Date(20).toISOString(),
        access: { canView: true, canComment: true, canEdit: true, frozen: false },
      }]),
      upsert: vi.fn(),
    };
    const materializeTeamProject = vi.fn(async () => {
      insertProject(db, {
        id: projectId,
        name: 'Remote project before rename',
        skillId: null,
        designSystemId: null,
        pendingPrompt: null,
        metadata: null,
        customInstructions: null,
        createdAt: 10,
        updatedAt: 20,
      });
      ensureWorkspaceProject(db, {
        projectId,
        workspaceId: TEAM_WORKSPACE_ID,
        visibility: 'team',
        resourceState: 'active',
        createdByWorkspaceMemberId: OWNER_MEMBER_ID,
        updatedByWorkspaceMemberId: OWNER_MEMBER_ID,
        resourceHubResourceId: resourceId,
        cloudTombstonedAt: null,
        syncState: 'synced',
      });
    });
    const refreshTeamProjectMetadata = vi.fn();
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      verifyWorkspaceRequestAuthority: verifiedTeamAuthority({
        memberId: OWNER_MEMBER_ID,
        role: 'owner',
      }),
      collabSync: {
        requestTeamShare: vi.fn(),
        requestTeamUnshare: vi.fn(),
        materializeTeamProject,
        refreshTeamProjectMetadata,
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      // A second device knows this project only through Vela's Team catalog.
      expect(getProject(db, projectId)).toBeNull();
      expect(getWorkspaceProjectByProjectId(db, projectId)).toBeUndefined();

      const response = await fetch(
        `${routeServer.url}/api/projects/${projectId}`,
        {
          method: 'PATCH',
          headers: ownerTeamHeaders(),
          body: JSON.stringify({ name: 'Renamed from another device' }),
        },
      );

      const body = await response.json() as any;
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(materializeTeamProject).toHaveBeenCalledWith(projectId, {
        memberId: OWNER_MEMBER_ID,
        teamId: TEAM_WORKSPACE_ID,
        role: 'owner',
        lifecycleState: 'active',
      }, OWNER_MEMBER_ID);
      expect(refreshTeamProjectMetadata).toHaveBeenCalledWith(projectId);
      expect(getProject(db, projectId)).toMatchObject({
        id: projectId,
        name: 'Renamed from another device',
      });
      expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({
        workspaceId: TEAM_WORKSPACE_ID,
        visibility: 'team',
        createdByWorkspaceMemberId: OWNER_MEMBER_ID,
        resourceHubResourceId: resourceId,
      });
    } finally {
      await close(routeServer.server);
    }
  });

  it.each(['owner', 'admin', 'member'] as const)(
    'does not let a Workspace %s materialize or rename another member catalog-only project',
    async (role) => {
      const projectId = `catalog-only-other-owner-rename-${role}-${Date.now()}`;
      const teamProjectCatalog = {
        list: vi.fn(async () => [{
          id: `catalog-${projectId}`,
          workspaceId: TEAM_WORKSPACE_ID,
          projectId,
          resourceId: `project-${projectId}`,
          ownerMemberId: 'actual-project-owner',
          displayName: 'Another member project',
          syncState: 'synced',
          lastSyncedVersionId: 'version-1',
          createdAt: new Date(10).toISOString(),
          updatedAt: new Date(20).toISOString(),
          access: { canView: true, canComment: true, canEdit: true, frozen: false },
        }]),
        upsert: vi.fn(),
      };
      const materializeTeamProject = vi.fn();
      const refreshTeamProjectMetadata = vi.fn();
      const app = express();
      app.use(express.json());
      registerProjectRoutes(app, buildDeps({
        teamProjectCatalog,
        verifyWorkspaceRequestAuthority: verifiedTeamAuthority({
          memberId: OWNER_MEMBER_ID,
          role,
        }),
        collabSync: {
          requestTeamShare: vi.fn(),
          requestTeamUnshare: vi.fn(),
          materializeTeamProject,
          refreshTeamProjectMetadata,
          invalidateTeamProjectCatalog: vi.fn(),
        },
      }));
      const routeServer = await listen(app);
      try {
        const response = await fetch(
          `${routeServer.url}/api/projects/${projectId}`,
          {
            method: 'PATCH',
            headers: teamHeaders({ memberId: OWNER_MEMBER_ID, role }),
            body: JSON.stringify({ name: 'Illicit catalog-only rename' }),
          },
        );

        expect(response.status).toBe(403);
        expect(materializeTeamProject).not.toHaveBeenCalled();
        expect(refreshTeamProjectMetadata).not.toHaveBeenCalled();
        expect(getProject(db, projectId)).toBeNull();
        expect(getWorkspaceProjectByProjectId(db, projectId)).toBeUndefined();
      } finally {
        await close(routeServer.server);
      }
    },
  );

  it('does not materialize or rename a catalog-only Team project through the wrong Workspace', async () => {
    const projectId = `catalog-only-wrong-workspace-rename-${Date.now()}`;
    const wrongWorkspaceId = `${TEAM_WORKSPACE_ID}-wrong`;
    const teamProjectCatalog = {
      list: vi.fn(async () => [{
        id: `catalog-${projectId}`,
        workspaceId: TEAM_WORKSPACE_ID,
        projectId,
        resourceId: `project-${projectId}`,
        ownerMemberId: OWNER_MEMBER_ID,
        displayName: 'Right project, wrong request Workspace',
        syncState: 'synced',
        lastSyncedVersionId: 'version-1',
        createdAt: new Date(10).toISOString(),
        updatedAt: new Date(20).toISOString(),
        access: { canView: true, canComment: true, canEdit: true, frozen: false },
      }]),
      upsert: vi.fn(),
    };
    const materializeTeamProject = vi.fn();
    const refreshTeamProjectMetadata = vi.fn();
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      verifyWorkspaceRequestAuthority: verifiedTeamAuthority({
        workspaceId: wrongWorkspaceId,
        memberId: OWNER_MEMBER_ID,
        role: 'owner',
      }),
      collabSync: {
        requestTeamShare: vi.fn(),
        requestTeamUnshare: vi.fn(),
        materializeTeamProject,
        refreshTeamProjectMetadata,
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      const response = await fetch(
        `${routeServer.url}/api/projects/${projectId}`,
        {
          method: 'PATCH',
          headers: ownerTeamHeaders({
            'x-od-workspace-id': wrongWorkspaceId,
          }),
          body: JSON.stringify({ name: 'Wrong Workspace rename' }),
        },
      );

      expect(response.status).toBe(404);
      expect(teamProjectCatalog.list).toHaveBeenCalledWith({
        memberId: OWNER_MEMBER_ID,
        teamId: wrongWorkspaceId,
        role: 'owner',
        lifecycleState: 'active',
      });
      expect(materializeTeamProject).not.toHaveBeenCalled();
      expect(refreshTeamProjectMetadata).not.toHaveBeenCalled();
      expect(getProject(db, projectId)).toBeNull();
      expect(getWorkspaceProjectByProjectId(db, projectId)).toBeUndefined();
    } finally {
      await close(routeServer.server);
    }
  });

  it('preserves the team source when content materialization fails', async () => {
    const projectId = `catalog-only-pull-failure-${Date.now()}`;
    const teamProjectCatalog = {
      list: vi.fn(async () => [{
        id: `catalog-${projectId}`,
        workspaceId: TEAM_WORKSPACE_ID,
        projectId,
        resourceId: `project-${projectId}`,
        ownerMemberId: OWNER_MEMBER_ID,
        displayName: 'Catalog-only pull failure',
        syncState: 'synced',
        lastSyncedVersionId: 'version-1',
        createdAt: new Date(10).toISOString(),
        updatedAt: new Date(20).toISOString(),
        access: { canView: true, canComment: true, canEdit: true, frozen: false },
      }]),
      upsert: vi.fn(),
    };
    const materializeTeamProject = vi.fn(async () => {
      throw new Error('temporary team content pull failure');
    });
    const requestTeamUnshare = vi.fn();
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      collabSync: {
        requestTeamShare: vi.fn(),
        requestTeamUnshare,
        materializeTeamProject,
        refreshTeamProjectMetadata: vi.fn(),
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      const response = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: ownerTeamHeaders(),
          body: JSON.stringify({ visibility: 'personal' }),
        },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE', retryable: true } });
      expect(materializeTeamProject).toHaveBeenCalledTimes(1);
      expect(requestTeamUnshare).not.toHaveBeenCalled();
      expect(getProject(db, projectId)).toBeNull();
      expect(getWorkspaceProjectByProjectId(db, projectId)).toBeUndefined();
    } finally {
      await close(routeServer.server);
    }
  });

  it.each(['owner', 'admin'] as const)(
    'does not let a Workspace %s materialize or unshare another member catalog-only project',
    async (role) => {
      const projectId = `catalog-only-other-owner-${role}-${Date.now()}`;
      const teamProjectCatalog = {
        list: vi.fn(async () => [{
          id: `catalog-${projectId}`,
          workspaceId: TEAM_WORKSPACE_ID,
          projectId,
          resourceId: `project-${projectId}`,
          ownerMemberId: 'actual-project-owner',
          displayName: 'Another member project',
          syncState: 'synced',
          lastSyncedVersionId: 'version-1',
          createdAt: new Date(10).toISOString(),
          updatedAt: new Date(20).toISOString(),
          access: { canView: true, canComment: true, canEdit: true, frozen: false },
        }]),
        upsert: vi.fn(),
      };
      const materializeTeamProject = vi.fn();
      const requestTeamUnshare = vi.fn();
      const app = express();
      app.use(express.json());
      registerProjectRoutes(app, buildDeps({
        teamProjectCatalog,
        collabSync: {
          requestTeamShare: vi.fn(),
          requestTeamUnshare,
          materializeTeamProject,
          refreshTeamProjectMetadata: vi.fn(),
          invalidateTeamProjectCatalog: vi.fn(),
        },
      }));
      const routeServer = await listen(app);
      try {
        const response = await fetch(
          `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
          {
            method: 'POST',
            headers: teamHeaders({ memberId: OWNER_MEMBER_ID, role }),
            body: JSON.stringify({ visibility: 'personal' }),
          },
        );

        expect(response.status).toBe(403);
        expect(materializeTeamProject).not.toHaveBeenCalled();
        expect(requestTeamUnshare).not.toHaveBeenCalled();
        expect(getProject(db, projectId)).toBeNull();
      } finally {
        await close(routeServer.server);
      }
    },
  );

  it.each(['owner', 'admin'] as const)(
    'allows its creator with Workspace role %s to transfer a team design system into Personal',
    async (role) => {
      const result = await startBrandExtraction({
        designMd: DESIGN_MD_INPUT,
        brandsRoot,
        projectsRoot,
        skillsRoot: SKILLS_ROOT,
        db,
        logoFallback: NO_LOGO_FALLBACK,
        imageryFallback: NO_IMAGERY_FALLBACK,
        seedFallback: NO_SEED_FALLBACK,
      });
      // Precondition, from real code: still unbound.
      expect(getWorkspaceProjectByProjectId(db, result.projectId)).toBeUndefined();

      const resourceId = `project-${result.projectId}`;
      const teamProjectCatalog = {
        list: vi.fn(async () => [
          {
            id: `catalog-${result.projectId}`,
            workspaceId: TEAM_WORKSPACE_ID,
            projectId: result.projectId,
            resourceId,
            ownerMemberId: OWNER_MEMBER_ID,
            displayName: 'Heritage Design System',
            syncState: 'synced',
            lastSyncedVersionId: 'v1',
            createdAt: new Date(10).toISOString(),
            updatedAt: new Date(20).toISOString(),
            access: { canView: true, canComment: true, canEdit: true, frozen: false },
          },
        ]),
        upsert: vi.fn(),
      };

      const app = express();
      app.use(express.json());
      registerProjectRoutes(app, buildDeps({ teamProjectCatalog }));
      const routeServer = await listen(app);
      try {
        const resp = await fetch(
          `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${result.projectId}/move`,
          {
            method: 'POST',
            headers: teamHeaders({ memberId: OWNER_MEMBER_ID, role }),
            body: JSON.stringify({ visibility: 'personal' }),
          },
        );
        expect(resp.status, await resp.clone().text()).toBe(200);
        expect(teamProjectCatalog.list).toHaveBeenCalled();
        expect(getWorkspaceProjectByProjectId(db, result.projectId)).toMatchObject({ workspaceId: PERSONAL_WORKSPACE_ID, visibility: 'personal' });
    } finally {
       await close(routeServer.server);
     }
    },
  );

  it('retries a failed atomic team-to-personal transfer without deleting its cloud source', async () => {
    const projectId = `retryable-orphan-${Date.now()}`;
    insertProject(db, {
      id: projectId,
      name: 'Retryable privileged orphan',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(getWorkspaceProjectByProjectId(db, projectId)).toBeUndefined();

    const teamProjectCatalog = {
      list: vi.fn(async () => [
        {
          id: `catalog-${projectId}`,
          workspaceId: TEAM_WORKSPACE_ID,
          projectId,
          resourceId: `project-${projectId}`,
          ownerMemberId: OWNER_MEMBER_ID,
          displayName: 'Retryable privileged orphan',
          syncState: 'synced',
          lastSyncedVersionId: 'v1',
          createdAt: new Date(10).toISOString(),
          updatedAt: new Date(20).toISOString(),
          access: { canView: true, canComment: true, canEdit: true, frozen: false },
        },
      ]),
      upsert: vi.fn(),
    };
    const requestTeamUnshare = vi.fn();
    const requestTeamTransfer = vi.fn()
      .mockRejectedValueOnce(new Error('temporary resource hub failure'))
      .mockResolvedValueOnce({ targetOwnerMemberId: PERSONAL_MEMBER_ID });
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      collabSync: {
        requestTeamShare: vi.fn(),
        requestTeamUnshare,
        requestTeamTransfer,
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      const move = () => fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: teamHeaders({ memberId: OWNER_MEMBER_ID, role: 'owner' }),
          body: JSON.stringify({ visibility: 'personal' }),
        },
      );

      const failed = await move();
      expect(failed.status).toBe(503);
      await expect(failed.json()).resolves.toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE', retryable: true } });
      expect(getWorkspaceProjectByProjectId(db, projectId)?.workspaceId).toBe(TEAM_WORKSPACE_ID);
      expect((await move()).status).toBe(200);
      expect(requestTeamTransfer).toHaveBeenCalledTimes(2);
      expect(requestTeamUnshare).not.toHaveBeenCalled();
      expect(teamProjectCatalog.list).toHaveBeenCalled();
      expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({ workspaceId: PERSONAL_WORKSPACE_ID, visibility: 'personal' });
    } finally {
     await close(routeServer.server);
   }
 });

 it('refuses an unbound project without a catalog ownership witness', async () => {
    // Same setup as above, but WITHOUT a teamProjectCatalog wired up — the
    // exact condition `reconcileUnboundProjectBeforeMove` early-returns on
    // (`if (!teamProjectCatalog) return;`). This is what production looked
    // like before the fix for every caller, and is still the real, correct
    // behavior today when the hub genuinely has no opinion (e.g. catalog
    // unconfigured) — the code must fall back to reporting "not currently
    // team" rather than guessing.
    const result = await startBrandExtraction({
      designMd: DESIGN_MD_INPUT,
      brandsRoot,
      projectsRoot,
      skillsRoot: SKILLS_ROOT,
      db,
      logoFallback: NO_LOGO_FALLBACK,
      imageryFallback: NO_IMAGERY_FALLBACK,
      seedFallback: NO_SEED_FALLBACK,
    });

    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({ teamProjectCatalog: undefined }));
    const routeServer = await listen(app);
    try {
      const resp = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${result.projectId}/move`,
        {
          method: 'POST',
          headers: ownerTeamHeaders(),
          body: JSON.stringify({ visibility: 'personal' }),
        },
      );
      expect(resp.status).toBe(403);
      const body = await resp.json() as any;
      expect(body.error.code).toBe('PROJECT_DELETE_FORBIDDEN');
    } finally {
      await close(routeServer.server);
    }
  });

  it('transfers an unbound project only after reconciling its creator from the team catalog', async () => {
    // No brand/design-system involved at all — a plain project created with
    // no workspace headers (`POST /api/projects` without headers), the same
    // orphan shape the rest of this directory's suite already relies on
    // (see "projects legacy rows into a workspace list ..." above).
    const projectId = `plain-clone-${Date.now()}`;
    insertProject(db, {
      id: projectId,
      name: 'Cloned website',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(getWorkspaceProjectByProjectId(db, projectId)).toBeUndefined();

    const resourceId = `project-${projectId}`;
    const teamProjectCatalog = {
      list: vi.fn(async () => [
        {
          id: `catalog-${projectId}`,
          workspaceId: TEAM_WORKSPACE_ID,
          projectId,
          resourceId,
          ownerMemberId: OWNER_MEMBER_ID,
          displayName: 'Cloned website',
          syncState: 'synced',
          lastSyncedVersionId: 'v1',
          createdAt: new Date(10).toISOString(),
          updatedAt: new Date(20).toISOString(),
          access: { canView: true, canComment: true, canEdit: true, frozen: false },
        },
      ]),
      upsert: vi.fn(),
    };

    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({ teamProjectCatalog }));
    const routeServer = await listen(app);
    try {
      const resp = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: ownerTeamHeaders(),
          body: JSON.stringify({ visibility: 'personal' }),
        },
      );
      expect(resp.status, await resp.clone().text()).toBe(200);
      expect(teamProjectCatalog.list).toHaveBeenCalled();
      expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({ workspaceId: PERSONAL_WORKSPACE_ID, visibility: 'personal' });
    } finally {
     await close(routeServer.server);
   }
 });

 it('does not let a non-creator member consume the catalog recovery witness', async () => {
    const projectId = `orphan-non-creator-${Date.now()}`;
    insertProject(db, {
      id: projectId,
      name: 'Orphan owned by another member',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const teamProjectCatalog = {
      list: vi.fn(async () => [
        {
          id: `catalog-${projectId}`,
          workspaceId: TEAM_WORKSPACE_ID,
          projectId,
          resourceId: `project-${projectId}`,
          ownerMemberId: 'actual-project-creator',
          displayName: 'Orphan owned by another member',
          syncState: 'synced',
          lastSyncedVersionId: 'v1',
          createdAt: new Date(10).toISOString(),
          updatedAt: new Date(20).toISOString(),
          access: { canView: true, canComment: true, canEdit: false, frozen: false },
        },
      ]),
      upsert: vi.fn(),
    };
    const requestTeamUnshare = vi.fn();
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      collabSync: {
        requestTeamShare: vi.fn(),
        requestTeamUnshare,
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      const response = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: teamHeaders({ memberId: 'another-member', role: 'member' }),
          body: JSON.stringify({ visibility: 'personal' }),
        },
      );

      expect(response.status).toBe(403);
      expect(requestTeamUnshare).not.toHaveBeenCalled();
      // A rejected reader must not consume the orphan state by leaving a
      // sticky binding that prevents a later owner/admin recovery request.
      expect(getWorkspaceProjectByProjectId(db, projectId)).toBeUndefined();
    } finally {
      await close(routeServer.server);
    }
  });

  describe.each(['single', 'batch'] as const)('cross-team manager transfer (%s)', (mode) => {
    it.each([['owner', 'local'], ['admin', 'local'], ['member', 'local'], ['owner', 'catalog'], ['admin', 'catalog'], ['owner', 'stale'], ['admin', 'stale']] as const)('checks source role %s with %s content without granting edits', async (role, state) => {
      const projectId = `manager-transfer-${mode}-${role}`;
      const createLocalProject = () => insertProject(db, { id: projectId, name: 'Teammate project', skillId: null, designSystemId: null,
        pendingPrompt: null, metadata: null, customInstructions: null, createdAt: 1, updatedAt: 1 });
      if (state !== 'catalog') createLocalProject();
      if (state !== 'catalog') ensureWorkspaceProject(db, { projectId, workspaceId: state === 'stale' ? PERSONAL_WORKSPACE_ID : TEAM_WORKSPACE_ID, visibility: 'team',
        resourceState: 'active', createdByWorkspaceMemberId: 'another-creator', updatedByWorkspaceMemberId: 'another-creator',
        resourceHubResourceId: 'source-resource', syncState: 'synced' });
      const requestTeamTransfer = vi.fn(async () => ({ targetOwnerMemberId: 'target-member' }));
      const authority = verifiedTeamAuthority({ memberId: OWNER_MEMBER_ID, role });
      const target = { ...(await authority()).context, workspaceId: 'target-team', workspaceMemberId: 'target-member', teamId: 'target-team' };
      const deps = buildDeps({
        verifyWorkspaceRequestAuthority: authority,
        teamProjectCatalog: { list: async () => [{ workspaceId: TEAM_WORKSPACE_ID, projectId, resourceId: 'source-resource',
          ownerMemberId: 'another-creator', access: { canView: true, canEdit: false, frozen: false }, syncState: 'synced' }] },
        collabSync: { requestTeamTransfer, invalidateTeamProjectCatalog: vi.fn(), materializeTeamProject: async () => {
          createLocalProject();
          ensureWorkspaceProject(db, { projectId, workspaceId: TEAM_WORKSPACE_ID, visibility: 'team', resourceState: 'active',
            createdByWorkspaceMemberId: 'another-creator', resourceHubResourceId: 'source-resource', syncState: 'synced' });
        } },
      });
      deps.fetchWorkspaceDirectory = async () => ({ ok: true, items: [target] }) as any;
      const app = express(); app.use(express.json()); registerProjectRoutes(app, deps);
      const routeServer = await listen(app);
      try {
        const response = await fetch(`${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${mode === 'batch' ? 'batch-move' : `${projectId}/move`}`, {
          method: 'POST', headers: ownerTeamHeaders(), body: JSON.stringify({ visibility: 'team', targetWorkspaceId: 'target-team',
            ...(mode === 'batch' ? { projectIds: [projectId] } : {}) }),
        });
        expect(response.status, await response.clone().text()).toBe(role === 'member' ? 403 : 200);
        expect(requestTeamTransfer).toHaveBeenCalledTimes(role === 'member' ? 0 : 1);
        expect(getWorkspaceProjectByProjectId(db, projectId)?.workspaceId).toBe(role === 'member' ? TEAM_WORKSPACE_ID : 'target-team');
      } finally { await close(routeServer.server); }
    });
  });

  it('allows the creator to transfer a bound team project while denying non-creator managers', async () => {
    const projectId = `bound-team-project-${Date.now()}`;
    insertProject(db, {
      id: projectId,
      name: 'Ordinary shared project',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    ensureWorkspaceProject(db, {
      projectId,
      workspaceId: TEAM_WORKSPACE_ID,
      visibility: 'team',
      resourceState: 'active',
      createdByWorkspaceMemberId: 'project-creator',
      updatedByWorkspaceMemberId: 'project-creator',
      resourceHubResourceId: `project-${projectId}`,
      cloudTombstonedAt: null,
      syncState: 'synced',
    });
    const teamProjectCatalog = { list: vi.fn(async () => []), upsert: vi.fn() };
    const requestTeamUnshare = vi.fn(async () => undefined);
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      collabSync: {
        requestTeamShare: vi.fn(),
        requestTeamUnshare,
        requestTeamTransfer: vi.fn(async () => ({ targetOwnerMemberId: PERSONAL_MEMBER_ID })),
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      for (const role of ['owner', 'admin'] as const) {
        const denied = await fetch(
          `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
          {
            method: 'POST',
            headers: teamHeaders({ memberId: `${role}-non-creator`, role }),
            body: JSON.stringify({ visibility: 'personal' }),
          },
        );
        expect(denied.status).toBe(403);
      }

      const creator = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: teamHeaders({ memberId: 'project-creator', role: 'member' }),
          body: JSON.stringify({ visibility: 'personal' }),
        },
      );
      expect(creator.status, await creator.clone().text()).toBe(200);
      expect(requestTeamUnshare).not.toHaveBeenCalled();
      expect(teamProjectCatalog.list).not.toHaveBeenCalled();
      expect(getWorkspaceProjectByProjectId(db, projectId)).toMatchObject({
        workspaceId: PERSONAL_WORKSPACE_ID, visibility: 'personal', createdByWorkspaceMemberId: PERSONAL_MEMBER_ID,
      });
    } finally {
     await close(routeServer.server);
   }
 });

 it('keeps an owner rename visible while the team catalog still has the previous title', async () => {
    const projectId = `owner-rename-stale-catalog-${Date.now()}`;
    const resourceId = `project-${projectId}`;
    insertProject(db, {
      id: projectId,
      name: 'Before rename',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: 10,
      updatedAt: 10,
    });
    ensureWorkspaceProject(db, {
      projectId,
      workspaceId: TEAM_WORKSPACE_ID,
      visibility: 'team',
      resourceState: 'active',
      createdByWorkspaceMemberId: OWNER_MEMBER_ID,
      updatedByWorkspaceMemberId: OWNER_MEMBER_ID,
      resourceHubResourceId: resourceId,
      cloudTombstonedAt: null,
      syncState: 'synced',
    });
    const teamProjectCatalog = {
      list: vi.fn(async () => [{
        id: `catalog-${projectId}`,
        workspaceId: TEAM_WORKSPACE_ID,
        projectId,
        resourceId,
        ownerMemberId: OWNER_MEMBER_ID,
        displayName: 'Before rename',
        syncState: 'synced',
        lastSyncedVersionId: 'version-1',
        createdAt: new Date(10).toISOString(),
        updatedAt: new Date(10).toISOString(),
        access: { canView: true, canComment: true, canEdit: true, frozen: false },
      }]),
      upsert: vi.fn(),
    };
    const refreshTeamProjectMetadata = vi.fn();
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({
      teamProjectCatalog,
      verifyWorkspaceRequestAuthority: async () => ({
        ok: true,
        context: {
          workspaceId: TEAM_WORKSPACE_ID,
          workspaceMemberId: OWNER_MEMBER_ID,
          workspaceType: 'team',
          teamId: TEAM_WORKSPACE_ID,
          workspaceName: 'Owner rename team',
          role: 'owner',
          memberStatus: 'active',
          lifecycleState: 'active',
          permissions: {
            canManageBilling: true,
            canManageMembers: true,
            canInviteMembers: true,
            canShareProjects: true,
            canWriteSyncedFiles: true,
          },
        },
      }),
      collabSync: {
        requestTeamShare: vi.fn(),
        requestTeamUnshare: vi.fn(),
        materializeTeamProject: vi.fn(),
        refreshTeamProjectMetadata,
        invalidateTeamProjectCatalog: vi.fn(),
      },
    }));
    const routeServer = await listen(app);
    try {
      const renamed = await fetch(`${routeServer.url}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: ownerTeamHeaders(),
        body: JSON.stringify({ name: 'After rename' }),
      });
      const renamedBody = await renamed.json() as any;
      expect(renamed.status, JSON.stringify(renamedBody)).toBe(200);
      expect(refreshTeamProjectMetadata).toHaveBeenCalledWith(projectId);

      const listed = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects?view=team`,
        { headers: ownerTeamHeaders() },
      );
      expect(listed.status).toBe(200);
      const body = await listed.json() as { projects: Array<any> };
      expect(body.projects.find((project) => project.id === projectId)).toMatchObject({
        name: 'After rename',
        project: { name: 'After rename' },
      });
      // The test intentionally keeps returning the stale title, proving the
      // immediate list does not wait for the async catalog refresh to land.
      expect(teamProjectCatalog.list).toHaveBeenCalled();
    } finally {
      await close(routeServer.server);
    }
  });

  it('still 403s move-to-personal for a project the hub has never heard of (no over-grant)', async () => {
    // Guards against the fix over-relaxing the check: a project that really
    // is only ever personal (never shared anywhere) must keep 403ing a
    // redundant "move to personal" — this is existing, correct behavior
    // (see "projects legacy rows for batch operations..." in
    // workspace-projects.test.ts) and must not regress.
    const projectId = `never-shared-${Date.now()}`;
    insertProject(db, {
      id: projectId,
      name: 'Never shared',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const teamProjectCatalog = { list: vi.fn(async () => []), upsert: vi.fn() };
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({ teamProjectCatalog }));
    const routeServer = await listen(app);
    try {
      const resp = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: ownerTeamHeaders(),
          body: JSON.stringify({ visibility: 'personal' }),
        },
      );
      expect(resp.status).toBe(403);
      await expect(resp.json()).resolves.toMatchObject({ error: { code: 'PROJECT_DELETE_FORBIDDEN' } });
      expect(teamProjectCatalog.list).toHaveBeenCalled();
      expect(getWorkspaceProjectByProjectId(db, projectId)).toBeUndefined();
    } finally {
      await close(routeServer.server);
    }
  });

  it('does not touch the move-to-team direction for an unbound project (canMoveToTeam unaffected)', async () => {
    const projectId = `fresh-orphan-${Date.now()}`;
    insertProject(db, {
      id: projectId,
      name: 'Fresh orphan',
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: null,
      customInstructions: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const teamProjectCatalog = { list: vi.fn(async () => []), upsert: vi.fn() };
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps({ teamProjectCatalog }));
    const routeServer = await listen(app);
    try {
      expect(listConversations(db, projectId)).toEqual([]);
      const resp = await fetch(
        `${routeServer.url}/api/workspaces/${TEAM_WORKSPACE_ID}/projects/${projectId}/move`,
        {
          method: 'POST',
          headers: ownerTeamHeaders(),
          body: JSON.stringify({ visibility: 'team' }),
        },
      );
      const body = await resp.json() as any;
      expect(resp.status, `expected 200, got ${resp.status}: ${JSON.stringify(body)}`).toBe(200);
      expect(body.project).toMatchObject({ id: projectId, visibility: 'team' });
      expect(listConversations(db, projectId)).toEqual([
        expect.objectContaining({
          projectId,
          title: null,
          sessionMode: 'design',
        }),
      ]);
      // The reconciliation guard is scoped to the 'personal' direction only —
      // it must not even consult the catalog for a 'team' request.
      expect(teamProjectCatalog.list).not.toHaveBeenCalled();
    } finally {
      await close(routeServer.server);
    }
  });
});
