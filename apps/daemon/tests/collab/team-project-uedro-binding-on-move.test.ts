// The uedro (羽点) review binding is stored on the LOCAL `workspace_projects`
// row. Moving a personal project into an HDW workspace (shared space or any
// other team space) re-creates the remote `team_projects` row, so the binding
// must be part of that upsert — otherwise the review silently detaches on the
// way out and the destination space sees `uedro_review_id = NULL`.
//
// Covered here:
//   - share/publish (personal → team) carries the binding;
//   - an unbound project never sends the key (it must not clear a teammate's);
//   - a cross-workspace transfer re-upserts the binding under the target team.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCollabRuntime, type CollabRuntime } from '../../src/collab/runtime.js';
import type { ResourceHubPrincipal } from '../../src/collab/resource-principal.js';

const SOURCE_PRINCIPAL: ResourceHubPrincipal = {
  memberId: 'member-owner',
  teamId: 'team-personal',
  role: 'owner',
  lifecycleState: 'active',
};

describe('team project catalog carries the uedro review binding', () => {
  let runtime: CollabRuntime | null = null;

  afterEach(() => {
    runtime?.dispose();
    runtime = null;
  });

  it('sends the local binding when a project is published into a team space', async () => {
    const upsert = vi.fn(async (_input: Record<string, unknown>, _principal?: unknown) => {});
    runtime = createCollabRuntime({
      adapter: { publish: vi.fn(async () => ({ version: 3, versionId: 'v3' })) },
      describeProject: () => ({ name: 'Project with review' }),
      getProjectUedroReviewId: (projectId) =>
        projectId === 'project-1' ? 'review-1' : null,
      teamProjectCatalog: { upsert, remove: vi.fn(async () => {}) },
    });

    await runtime.requestTeamShare('project-1', SOURCE_PRINCIPAL, null);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', uedroReviewId: 'review-1' }),
      SOURCE_PRINCIPAL,
    );
  });

  it('omits the key for an unbound project so a teammate binding is never cleared', async () => {
    const upsert = vi.fn(async (_input: Record<string, unknown>, _principal?: unknown) => {});
    runtime = createCollabRuntime({
      adapter: { publish: vi.fn(async () => ({ version: 1, versionId: 'v1' })) },
      describeProject: () => ({ name: 'Project without review' }),
      getProjectUedroReviewId: () => null,
      teamProjectCatalog: { upsert, remove: vi.fn(async () => {}) },
    });

    await runtime.requestTeamShare('project-2', SOURCE_PRINCIPAL, null);

    const input = upsert.mock.calls[0]?.[0] ?? {};
    expect('uedroReviewId' in input).toBe(false);
  });

  it('re-upserts the binding under the target team after a cross-workspace move', async () => {
    const upsert = vi.fn(async (_input: Record<string, unknown>, _principal?: unknown) => {});
    const targetPrincipal: ResourceHubPrincipal = {
      ...SOURCE_PRINCIPAL,
      teamId: 'team-shared',
    };
    runtime = createCollabRuntime({
      adapter: {
        publish: vi.fn(async () => null),
        transferToWorkspace: vi.fn(async () => ({
          version: 9,
          versionId: 'v9',
          resourceId: 'res-1',
          targetOwnerMemberId: 'member-target',
        })),
      },
      describeProject: () => ({ name: 'Moved project' }),
      getProjectUedroReviewId: (projectId) =>
        projectId === 'project-1' ? 'review-1' : null,
      teamProjectCatalog: { upsert, remove: vi.fn(async () => {}) },
    });

    await runtime.requestTeamTransfer(
      'project-1',
      'team-personal',
      'team-shared',
      targetPrincipal,
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', uedroReviewId: 'review-1' }),
      expect.objectContaining({ teamId: 'team-shared' }),
    );
  });
});
