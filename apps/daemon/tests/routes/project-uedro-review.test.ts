// Real-HTTP coverage for the project ↔ uedro review binding endpoints
// (`GET/PUT /api/projects/:id/uedro-review` in routes/project/index.ts),
// wired to the REAL sqlite `workspace_projects` CRUD so the assertions run
// against the same rows production reads/writes.
//
// The behaviour that matters here:
//   - the local binding is the source of truth and survives a team round-trip;
//   - a team project pulls a remote-only binding down and persists it locally;
//   - PUT mirrors to the HDW catalog and reports `remoteSaved` honestly
//     (`true` when mirrored, `null` when there is no HDW client at all).
import express from 'express';
import type http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectRoutes } from '../../src/routes/project/index.js';
import {
  closeDatabase,
  ensureWorkspaceProject,
  getProject,
  getWorkspaceProject,
  getWorkspaceProjectByProjectId,
  insertConversation,
  insertProject,
  listWorkspaceProjectBindings,
  listWorkspaceProjects,
  openDatabase,
  rebindWorkspaceProject,
  updateWorkspaceProject,
} from '../../src/db.js';
import { createAuthorizeProjectRequest } from '../../src/collab/project-request-authority.js';
import { workspaceContextFromDirectoryItem } from '../../src/collab/vela-workspace-context.js';

const TEAM_WORKSPACE_ID = 'ws-team-1';
const TEAM_MEMBER_ID = 'member-owner';

function teamHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-od-workspace-id': TEAM_WORKSPACE_ID,
    'x-od-workspace-member-id': TEAM_MEMBER_ID,
    'x-od-workspace-role': 'owner',
    'x-od-workspace-type': 'team',
    'x-od-workspace-member-status': 'active',
    'x-od-workspace-lifecycle-state': 'active',
    'x-od-workspace-can-share-projects': 'true',
    'x-od-workspace-can-write-synced-files': 'true',
  };
}

async function listen(app: express.Express): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('project uedro review binding endpoints', () => {
  let tempDir: string;
  let projectsRoot: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'od-uedro-review-routes-'));
    projectsRoot = path.join(tempDir, 'projects');
    db = openDatabase(projectsRoot, { dataDir: tempDir });
  });

  afterEach(async () => {
    closeDatabase();
    await rm(tempDir, { recursive: true, force: true });
  });

  function buildDeps(hdwCloudClient: Record<string, unknown> | null) {
    const noop = vi.fn();
    const sendApiError = (
      res: any,
      status: number,
      code: string,
      message: string,
    ) => res.status(status).json({ error: { code, message } });
    const verifiedContext = workspaceContextFromDirectoryItem({
      workspaceId: TEAM_WORKSPACE_ID,
      workspaceName: 'Team',
      workspaceType: 'team',
      workspaceMemberId: TEAM_MEMBER_ID,
      role: 'owner',
      memberStatus: 'active',
      lifecycleState: 'active',
    });
    const authorizeProjectRequest = createAuthorizeProjectRequest({
      db,
      getWorkspaceProject: (_db, workspaceId, projectId) =>
        getWorkspaceProject(db, workspaceId, projectId),
      getWorkspaceProjectByProjectId: (_db, projectId) =>
        getWorkspaceProjectByProjectId(db, projectId),
      verifyWorkspaceReadAuthority: async () => ({ ok: true, context: verifiedContext }),
      verifyWorkspaceRequestAuthority: async () => ({ ok: true, context: verifiedContext }),
      sendApiError,
    });
    return {
      db,
      design: {},
      http: { createSseResponse: noop, sendApiError },
      paths: {
        DESIGN_SYSTEMS_DIR: '',
        PROJECTS_DIR: projectsRoot,
        RUNTIME_DATA_DIR: tempDir,
        RUNTIME_DATA_DIR_CANONICAL: tempDir,
        SKILLS_DIR: '',
        BRANDS_DIR: path.join(tempDir, 'brands'),
        USER_DESIGN_SYSTEMS_DIR: path.join(tempDir, 'user-design-systems'),
      },
      projectStore: {
        insertProject: (row: any) => insertProject(db, row),
        validateLinkedDirs: () => ({ dirs: [] }),
        getProject: (_db: unknown, id: string) => getProject(db, id),
        updateProject: noop,
        dbDeleteProject: noop,
        removeProjectDir: noop,
        stageProjectDirsForDelete: vi.fn(async () => ({
          rollback: vi.fn(async () => {}),
          commit: vi.fn(async () => {}),
        })),
        deleteWorkspaceProject: noop,
        countWorkspaceProjectRefs: vi.fn(() => 1),
        ensureWorkspaceProject: (_db: unknown, input: any) =>
          ensureWorkspaceProject(db, input),
        getWorkspaceProject: (_db: unknown, workspaceId: string, projectId: string) =>
          getWorkspaceProject(db, workspaceId, projectId),
        getWorkspaceProjectByProjectId: (_db: unknown, projectId: string) =>
          getWorkspaceProjectByProjectId(db, projectId),
        listWorkspaceProjectBindings: () => listWorkspaceProjectBindings(db),
        listWorkspaceProjects: (_db: unknown, workspaceId: string) =>
          listWorkspaceProjects(db, workspaceId),
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
      },
      conversations: {
        insertConversation: (_db: unknown, input: any) => insertConversation(db, input),
      },
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
      collabSync: {
        requestTeamShare: noop,
        requestTeamUnshare: noop,
        invalidateTeamProjectCatalog: noop,
      },
      teamProjectCatalog: undefined,
      hdwCloudClient,
      authorizeProjectRequest,
    } as unknown as Parameters<typeof registerProjectRoutes>[1];
  }

  function seedTeamProject(projectId: string, uedroReviewId: string | null = null) {
    insertProject(db, {
      id: projectId,
      name: 'Team project',
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
      createdByWorkspaceMemberId: TEAM_MEMBER_ID,
      updatedByWorkspaceMemberId: TEAM_MEMBER_ID,
      resourceHubResourceId: `res-${projectId}`,
      syncState: 'synced',
      ...(uedroReviewId ? { uedroReviewId } : {}),
    });
  }

  async function withServer<T>(
    hdwCloudClient: Record<string, unknown> | null,
    run: (baseUrl: string) => Promise<T>,
  ): Promise<T> {
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, buildDeps(hdwCloudClient));
    const server = await listen(app);
    try {
      return await run(server.url);
    } finally {
      await close(server.server);
    }
  }

  it('reads the locally bound review id', async () => {
    seedTeamProject('project-local', 'review-local');
    await withServer(null, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/project-local/uedro-review`, {
        headers: teamHeaders(),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        projectId: 'project-local',
        uedroReviewId: 'review-local',
      });
    });
  });

  it('pulls a remote-only binding from the HDW catalog and persists it locally', async () => {
    seedTeamProject('project-remote', null);
    const getTeamProject = vi.fn(async () => ({ uedroReviewId: 'review-remote' }));
    await withServer({ getTeamProject }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/project-remote/uedro-review`, {
        headers: teamHeaders(),
      });
      expect(await response.json()).toEqual({
        projectId: 'project-remote',
        uedroReviewId: 'review-remote',
      });
    });
    expect(getTeamProject).toHaveBeenCalledWith(TEAM_WORKSPACE_ID, 'project-remote');
    // Written back so the next read is daemon-local.
    expect(getWorkspaceProjectByProjectId(db, 'project-remote')?.uedroReviewId)
      .toBe('review-remote');
  });

  it('writes the binding locally and mirrors it to the HDW catalog', async () => {
    seedTeamProject('project-write');
    const upsertTeamProject = vi.fn(async () => ({}));
    const getTeamProject = vi.fn(async () => null);
    await withServer({ getTeamProject, upsertTeamProject }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/project-write/uedro-review`, {
        method: 'PUT',
        headers: teamHeaders(),
        body: JSON.stringify({ uedroReviewId: 'review-new' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        projectId: 'project-write',
        uedroReviewId: 'review-new',
        localSaved: true,
        remoteSaved: true,
      });
    });
    expect(getWorkspaceProjectByProjectId(db, 'project-write')?.uedroReviewId)
      .toBe('review-new');
    expect(upsertTeamProject).toHaveBeenCalledWith(
      TEAM_WORKSPACE_ID,
      'project-write',
      expect.objectContaining({ uedroReviewId: 'review-new' }),
    );
  });

  it('reports remoteSaved null when the daemon has no HDW client', async () => {
    seedTeamProject('project-offline');
    await withServer(null, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/project-offline/uedro-review`, {
        method: 'PUT',
        headers: teamHeaders(),
        body: JSON.stringify({ uedroReviewId: 'review-offline' }),
      });
      expect(await response.json()).toEqual({
        projectId: 'project-offline',
        uedroReviewId: 'review-offline',
        localSaved: true,
        remoteSaved: null,
      });
    });
    expect(getWorkspaceProjectByProjectId(db, 'project-offline')?.uedroReviewId)
      .toBe('review-offline');
  });

  it('rejects a non-string binding value', async () => {
    seedTeamProject('project-bad');
    await withServer(null, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/project-bad/uedro-review`, {
        method: 'PUT',
        headers: teamHeaders(),
        body: JSON.stringify({ uedroReviewId: 123 }),
      });
      expect(response.status).toBe(400);
    });
    expect(getWorkspaceProjectByProjectId(db, 'project-bad')?.uedroReviewId ?? null)
      .toBeNull();
  });
});
