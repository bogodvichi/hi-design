import { describe, expect, it, vi } from 'vitest';

import {
  createHdwHttpTeamProjectCatalog,
  createHdwHttpTeamProjectCatalogClient,
} from '../../src/collab/hdw-http-team-projects.js';
import type {
  HdwCloudClient,
  HdwTeamProjectRecord,
  HdwUpsertTeamProjectInput,
} from '../../src/integrations/hdw-cloud.js';
import type { ResourceHubPrincipal } from '../../src/collab/resource-principal.js';

const PRINCIPAL: ResourceHubPrincipal = {
  memberId: 'member-1',
  teamId: 'team-1',
  role: 'member',
  lifecycleState: 'active',
};

function record(overrides: Partial<HdwTeamProjectRecord> = {}): HdwTeamProjectRecord {
  return {
    id: 'row-1',
    workspaceId: 'team-1',
    projectId: 'p1',
    resourceId: 'res-1',
    ownerMemberId: 'member-1',
    displayName: 'demo',
    syncState: 'synced',
    lastSyncedVersionId: 'v1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    access: { canView: true, canComment: true, canEdit: true, frozen: false },
    ...overrides,
  };
}

describe('hdw http team project catalog · uedroReviewId', () => {
  it('maps camelCase and snake_case review ids onto TeamProject', async () => {
    const client = {
      listTeamProjects: vi.fn(async () => [
        record({ projectId: 'p1', uedroReviewId: 'r-camel' }),
        record({ projectId: 'p2', resourceId: 'res-2', uedro_review_id: 'r-snake' }),
        record({ projectId: 'p3', resourceId: 'res-3' }),
      ]),
      getTeamProject: vi.fn(async () => null),
      upsertTeamProject: vi.fn(async () => null),
      removeTeamProject: vi.fn(async () => undefined),
    } as unknown as HdwCloudClient;

    const projects = await createHdwHttpTeamProjectCatalog(client).list('team-1');

    expect(projects.map((p) => [p.projectId, p.uedroReviewId ?? null])).toEqual([
      ['p1', 'r-camel'],
      ['p2', 'r-snake'],
      ['p3', null],
    ]);
  });

  it('forwards uedroReviewId on the catalog upsert path', async () => {
    const upsertTeamProject = vi.fn(async () => record({ uedroReviewId: 'r-1' }));
    const client = {
      getTeamProject: vi.fn(async () => record()),
      upsertTeamProject,
      listTeamProjects: vi.fn(async () => []),
      removeTeamProject: vi.fn(async () => undefined),
    } as unknown as HdwCloudClient;

    await createHdwHttpTeamProjectCatalog(client).upsert(
      { projectId: 'p1', uedroReviewId: 'r-1' },
      PRINCIPAL,
    );

    expect(upsertTeamProject).toHaveBeenCalledWith(
      'team-1',
      'p1',
      expect.objectContaining({ uedroReviewId: 'r-1' }),
    );
  });

  it('sends an explicit null to clear the binding, and omits it when undefined', async () => {
    const upsertTeamProject = vi.fn(
      async (
        _workspaceId: string,
        _projectId: string,
        _input: HdwUpsertTeamProjectInput,
      ) => record(),
    );
    const client = {
      getTeamProject: vi.fn(async () => record()),
      upsertTeamProject,
      listTeamProjects: vi.fn(async () => []),
      removeTeamProject: vi.fn(async () => undefined),
    } as unknown as HdwCloudClient;

    const catalog = createHdhCatalogForClearTest(client);
    await catalog.upsert({ projectId: 'p1', uedroReviewId: null }, PRINCIPAL);
    expect(upsertTeamProject.mock.calls[0]?.[2]).toMatchObject({ uedroReviewId: null });

    upsertTeamProject.mockClear();
    await catalog.upsert({ projectId: 'p1' }, PRINCIPAL);
    const input = upsertTeamProject.mock.calls[0]?.[2] ?? {};
    expect('uedroReviewId' in input).toBe(false);
  });

  it('parses uedro_review_id into VelaTeamProjectRecord for the client surface', async () => {
    const client = {
      listTeamProjects: vi.fn(async () => [
        record({ uedro_review_id: 'r-snake' }),
      ]),
      getTeamProject: vi.fn(async () => null),
      upsertTeamProject: vi.fn(async () => null),
      removeTeamProject: vi.fn(async () => undefined),
    } as unknown as HdwCloudClient;

    const records = await createHdhClientForTest(client).list(PRINCIPAL);

    expect(records).toHaveLength(1);
    expect(records[0]?.uedroReviewId).toBe('r-snake');
  });
});

function createHdhCatalogForClearTest(client: HdwCloudClient) {
  return createHdwHttpTeamProjectCatalog(client);
}

function createHdhClientForTest(client: HdwCloudClient) {
  return createHdwHttpTeamProjectCatalogClient(client);
}
