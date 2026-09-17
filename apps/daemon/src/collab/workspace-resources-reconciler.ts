// Realtime reconciliation of the local `workspace_resources` SQLite table
// against the resource hub's shared-listing for design-system / plugin /
// skill resources — the generic-table counterpart of
// `workspace-projects-reconciler.ts` for `workspace_projects`.
//
// Two directions, mirroring `workspace-projects-reconciler.ts`:
//
// DIRECTION 1 — ownership correction: `syncSharedTeamDesignSystem` /
// `syncSharedTeamSkill` / `syncSharedTeamPlugin` (server.ts) already
// materialize + bind a resource the hub confirms as shared every time a
// kind's `/team` listing is read. But the `createdByWorkspaceMemberId`
// they stamp comes from the request's resolved workspace context — and
// that context can carry a STALE member id (the concrete bug: a personal
// workspace's member id was written into a team workspace's resource
// binding because the context resolver picked the wrong membership
// directory entry). The sync functions never re-examine an already-bound
// row's ownership, so the wrong member id sits there forever. This
// module's Direction 1 corrects that drift: when the remote hub still
// confirms a resource as shared, and the local row's
// `createdByWorkspaceMemberId` disagrees with the current
// `workspaceMemberId`, the rebind action overwrites it.
//
// DIRECTION 2 — retirement: a resource a workspace has ALREADY bound
// `visibility: 'team'` that the hub no longer lists at all (the owner
// unshared it, or this member's access was revoked). Before this module,
// that local row simply sat there forever, unexamined — the puller's copy
// vanished from the Team scope (the hub stopped listing it) without ever
// being told to leave "team" state, so it also never qualified to
// reappear anywhere else.
//
// Retraction semantic (spec decision, workspace-team continuous-sync 优先级3):
// deliberately NOT "demote to personal" (project's `workspace_projects` model
// is the one to NOT copy). A skill/design-system/plugin pulled copy is a
// materialized MIRROR of someone else's shared resource, not the caller's
// own draft — flipping `visibility` to `'personal'` would misattribute it as
// caller-authored, exactly the bug `SkillSummary.teamSynced` (this same
// continuous-sync effort, priority 2) was written to fix. Instead this marks
// `resourceState: 'deleted'` on the EXISTING `workspace_resources` row and
// leaves `visibility: 'team'` untouched — a tombstone, not a reclassification:
//   - `visibility` staying `'team'` preserves every `teamSynced` / "is this a
//     team-pulled copy" attribution read. Scoped catalogs additionally gate
//     these mirrors on `resourceState`, so a retired resource is hidden while
//     remaining distinguishable from caller-authored Personal content.
//   - `resourceState: 'deleted'` is this reconciler's own bookkeeping: it is
//     what makes a second reconciliation pass a no-op instead of re-writing
//     the same row every ~15s poll tick, and it is the auditable "this used
//     to be team-shared, then wasn't anymore" fact a future "make this mine"
//     reclaim action would key off. Scoped Team catalogs read it as the
//     exclusion signal without erasing that attribution.
//   - The local FILE on disk is never touched. Retraction is a binding-table
//     state change only — this module does not delete, move, or rewrite
//     anything under `USER_SKILLS_DIR` / `USER_DESIGN_SYSTEMS_DIR`.
//
// Scope: this module is resource-type-agnostic. Daemon wiring drives it for
// design systems, plugins, and skills; each materializer owns creating the
// active Team binding that this reconciler later retires.

import type {
  TeamResourcesChangedSsePayload,
  WorkspaceTeamResourceKind,
} from '@open-design/contracts';

/** This daemon's one local `workspace_resources` row for a resource, as far
 *  as reconciliation cares. Only rows the caller has already filtered to
 *  `visibility: 'team'` for the target workspace are meaningful input — see
 *  `WorkspaceResourcesReconcilerDeps.listLocalActiveTeamRows`. */
export interface LocalTeamResourceBinding {
  resourceId: string;
  workspaceId: string;
  visibility: 'personal' | 'team';
  resourceState: string | null;
  createdByWorkspaceMemberId: string | null;
  resourceHubResourceId: string | null;
}

/** What the remote hub says is currently shared — the subset
 *  `TeamResourceShareService.sharedResources()` (team-resource-share.ts)
 *  actually carries that the planner needs: the LOCAL resource id (already
 *  decoded by `parseSharedResourceRecords`, matching `workspace_resources.
 *  resource_id` directly), plus the hub-side `ownerMemberId` and
 *  `hubResourceId` the planner needs for ownership correction. */
export interface RemoteTeamResourceRef {
  resourceId: string;
  versionId?: string;
  version?: number;
  ownerMemberId?: string;
  hubResourceId?: string;
}

/** Tracks the last authoritative listing independently by Workspace and kind. */
export function createWorkspaceResourceSignatureTracker() {
  const signatures = new Map<string, string>();
  return {
    observe(
      workspaceId: string,
      resourceKind: string,
      remoteResources: readonly RemoteTeamResourceRef[],
    ): boolean {
      const key = JSON.stringify([workspaceId, resourceKind]);
      const signature = JSON.stringify(
        remoteResources
          .map((resource) => [
            resource.resourceId,
            resource.versionId ?? null,
            resource.version ?? null,
          ] as const)
          .sort(([left], [right]) => left.localeCompare(right)),
      );
      const previous = signatures.get(key);
      signatures.set(key, signature);
      return previous !== signature;
    },
  };
}

export interface MaterializedTeamResourceRef extends RemoteTeamResourceRef {
  versionId?: string;
}

export type WorkspaceResourceReconcileAction = {
  kind: 'retire';
  resourceId: string;
  workspaceId: string;
} | {
  kind: 'rebind';
  resourceId: string;
  patch: WorkspaceResourceBindPatch;
};

export interface WorkspaceResourceBindPatch {
  workspaceId: string;
  visibility: 'team';
  resourceState: 'active';
  createdByWorkspaceMemberId: string;
  updatedByWorkspaceMemberId: string;
  resourceHubResourceId: string | null;
  cloudTombstonedAt: null;
  syncState: 'synced';
}

/**
 * Pure planner: given what the resource hub currently lists as shared and
 * what this daemon's OWN `workspace_resources` rows (already active-team-
 * filtered by the caller) claim for the workspace, decide which local rows
 * disagree and how to fix them. No I/O — the orchestrator below
 * (`reconcileWorkspaceResourcesWithRemote`) is the only caller that touches
 * the database, which is what keeps this function directly unit-testable.
 *
 * Direction 1: remote confirms the resource is still shared — correct
 * ownership drift. A teammate's pulled mirror should carry the CURRENT
 * member's id as `createdByWorkspaceMemberId` (they created this local
 * binding), not whatever stale member id was resolved when the binding
 * was first written. The hub's `hubResourceId` is also corrected if it
 * has drifted, since the hub is the authoritative source.
 *
 * Direction 2: a local Team row the remote listing no longer confirms.
 */
export function planWorkspaceResourceReconciliation(input: {
  workspaceId: string;
  workspaceMemberId: string;
  remoteResources: readonly RemoteTeamResourceRef[];
  /** Every row this daemon currently has bound `visibility: 'team'` AND
   *  `resourceState` other than `'deleted'` for `workspaceId` — see
   *  `listLocalActiveTeamRows`'s doc comment for the exact prefilter this
   *  function relies on the caller to apply. */
  localActiveTeamRows: readonly LocalTeamResourceBinding[];
}): WorkspaceResourceReconcileAction[] {
  const { workspaceId, workspaceMemberId, remoteResources, localActiveTeamRows } = input;
  const actions: WorkspaceResourceReconcileAction[] = [];

  // Direction 1: remote confirms the resource is still shared — correct
  // ownership drift on the local binding row.
  const localByResourceId = new Map<string, LocalTeamResourceBinding>();
  for (const local of localActiveTeamRows) {
    if (local.workspaceId === workspaceId) {
      localByResourceId.set(local.resourceId, local);
    }
  }
  for (const remote of remoteResources) {
    const local = localByResourceId.get(remote.resourceId);
    if (!local) continue;
    const wantCreatedBy = workspaceMemberId;
    const wantHubResourceId = remote.hubResourceId ?? local.resourceHubResourceId;
    const alreadyCorrect =
      local.createdByWorkspaceMemberId === wantCreatedBy &&
      local.resourceHubResourceId === wantHubResourceId;
    if (alreadyCorrect) continue;
    actions.push({
      kind: 'rebind',
      resourceId: remote.resourceId,
      patch: {
        workspaceId,
        visibility: 'team',
        resourceState: 'active',
        createdByWorkspaceMemberId: wantCreatedBy,
        updatedByWorkspaceMemberId: workspaceMemberId,
        resourceHubResourceId: wantHubResourceId,
        cloudTombstonedAt: null,
        syncState: 'synced',
      },
    });
  }

  // Direction 2: a local Team row the remote listing no longer confirms.
  const remoteIds = new Set(remoteResources.map((r) => r.resourceId));
  for (const local of localActiveTeamRows) {
    if (local.workspaceId !== workspaceId) continue;
    if (remoteIds.has(local.resourceId)) continue;
    actions.push({ kind: 'retire', resourceId: local.resourceId, workspaceId: local.workspaceId });
  }
  return actions;
}

export interface WorkspaceResourcesReconcilerDeps {
  /** The signed-in team workspace this daemon is currently acting as, or
   *  null off-team / signed out / removed. Must gate on active membership
   *  (`memberStatus === 'active'`) the same way
   *  `reconcileWorkspaceProjectsWithRemote`'s `getWorkspaceIdentity` does — a
   *  context that can still ADDRESS a resource hub partition is not proof
   *  this member is still IN the team. */
  getWorkspaceIdentity: () => Promise<{ workspaceId: string; workspaceMemberId: string } | null>;
 /** This kind's `TeamResourceShareService.sharedResources()` — the exact
   *  same hub read `/api/workspace/<kind>/team` already serves (through its
   *  own SWR cache), so this reconciler never opens a second transport. */
  listRemoteTeamResources: () => Promise<readonly RemoteTeamResourceRef[]>;
  /** Every `workspace_resources` row for this resource type bound
   *  `visibility: 'team'` in `workspaceId`, whose `resourceState` is not
   *  already `'deleted'` (i.e. `listWorkspaceResources(db, resourceType,
   *  workspaceId)` filtered by the caller — kept out of this pure function
   *  so it stays synchronous and test-friendly without a real db handle). */
  listLocalActiveTeamRows: (workspaceId: string) => readonly LocalTeamResourceBinding[];
  /** Write a 'retire' action: flip `resourceState` to `'deleted'`, leaving
   *  `visibility` untouched. See this module's header comment for why that
   *  is the correct action and not a demote-to-personal. */
  applyRetire: (workspaceId: string, resourceId: string) => void;
  /** Write a 'rebind' action: correct `createdByWorkspaceMemberId` and
   *  `resourceHubResourceId` on an existing local binding row that the
   *  remote hub still confirms as shared. */
  applyRebind: (resourceId: string, patch: WorkspaceResourceBindPatch) => void;
  onError?: (error: unknown) => void;
}

export interface WorkspaceResourcesReconcileResult {
  /** Number of retire actions successfully persisted. */
  retired: number;
  /** Number of rebind (ownership correction) actions successfully persisted. */
  rebound: number;
}

const NO_OP_RESULT: WorkspaceResourcesReconcileResult = { retired: 0, rebound: 0 };

/**
 * Run one reconciliation pass for one resource kind: read the remote shared
 * listing, diff it against this daemon's own active `workspace_resources`
 * rows for that kind, and retire whatever disagrees. Best-effort throughout —
 * a failed identity read or a failed remote read returns a no-op result
 * rather than throwing, so a transient hub outage can never be misread as
 * "remote reports nothing shared" and retire every local team row on missing
 * (as opposed to genuinely empty) data.
 */
export async function reconcileWorkspaceResourcesWithRemote(
  deps: WorkspaceResourcesReconcilerDeps,
): Promise<WorkspaceResourcesReconcileResult> {
  const identity = await deps.getWorkspaceIdentity().catch((error) => {
    deps.onError?.(error);
    return null;
  });
  if (!identity) return NO_OP_RESULT;

  let remoteResources: readonly RemoteTeamResourceRef[];
  try {
    remoteResources = await deps.listRemoteTeamResources();
  } catch (error) {
    deps.onError?.(error);
    return NO_OP_RESULT;
  }

  const localActiveTeamRows = deps.listLocalActiveTeamRows(identity.workspaceId);
  const actions = planWorkspaceResourceReconciliation({
    workspaceId: identity.workspaceId,
    workspaceMemberId: identity.workspaceMemberId,
    remoteResources,
    localActiveTeamRows,
  });

  let retired = 0;
  let rebound = 0;
  for (const action of actions) {
    try {
      if (action.kind === 'retire') {
        deps.applyRetire(action.workspaceId, action.resourceId);
        retired += 1;
      } else {
        deps.applyRebind(action.resourceId, action.patch);
        rebound += 1;
      }
    } catch (error) {
      deps.onError?.(error);
    }
  }

  return { retired, rebound };
}

const TEAM_RESOURCE_KINDS: readonly WorkspaceTeamResourceKind[] = [
  'design_system',
  'plugin',
  'skill',
];

export type WorkspaceTeamResourceRefreshReason = 'push' | 'poll' | 'catch-up';

export interface WorkspaceTeamResourceRefreshInput<TScope> {
  workspaceId: string;
  scope: TScope;
  resourceKind?: string;
  resourceId?: string;
  reason: WorkspaceTeamResourceRefreshReason;
  /**
   * Optional compatibility-lease guard for queued prewarm work. It is checked
   * immediately before the mutating pipeline starts. Once materialization has
   * begun, reconcile, emit, and signature commit finish as one logical unit.
   */
  isRefreshCurrent?: () => boolean;
}

export interface WorkspaceTeamResourceRefreshResult {
  processedKinds: WorkspaceTeamResourceKind[];
  emittedKinds: WorkspaceTeamResourceKind[];
  failedKinds: WorkspaceTeamResourceKind[];
}

export interface WorkspaceTeamResourceEventCoordinatorDeps<TScope> {
  /** Must not resolve until every listed resource is locally materialized. */
  materializeAndList: (input: {
    workspaceId: string;
    resourceKind: WorkspaceTeamResourceKind;
    scope: TScope;
  }) => Promise<readonly MaterializedTeamResourceRef[]>;
  /** Reconcile against the exact listing returned by materializeAndList. */
  reconcile: (input: {
    workspaceId: string;
    resourceKind: WorkspaceTeamResourceKind;
    scope: TScope;
    resources: readonly MaterializedTeamResourceRef[];
  }) => Promise<WorkspaceResourcesReconcileResult>;
  emit: (workspaceId: string, payload: TeamResourcesChangedSsePayload) => void;
  now?: () => number;
  onError?: (error: unknown, resourceKind: WorkspaceTeamResourceKind) => void;
}

function teamResourceSignature(resources: readonly MaterializedTeamResourceRef[]): string {
  return resources
    .map((resource) => `${resource.resourceId}\u0000${resource.versionId ?? ''}`)
    .sort()
    .join('\u0001');
}

function isWorkspaceTeamResourceKind(value: string): value is WorkspaceTeamResourceKind {
  return TEAM_RESOURCE_KINDS.some((kind) => kind === value);
}

/**
 * Coordinates background resource invalidation without exposing partially
 * materialized state. Work for the same workspace/kind is serialized; polling
 * emits only when the stable remote signature changes (or a local row retires).
 */
export function createWorkspaceTeamResourceEventCoordinator<TScope>(
  deps: WorkspaceTeamResourceEventCoordinatorDeps<TScope>,
): {
  refresh: (
    input: WorkspaceTeamResourceRefreshInput<TScope>,
  ) => Promise<WorkspaceTeamResourceRefreshResult>;
} {
  const signatures = new Map<string, string>();
  const pending = new Map<string, Promise<void>>();

  const runKind = async (
    input: WorkspaceTeamResourceRefreshInput<TScope>,
    resourceKind: WorkspaceTeamResourceKind,
  ): Promise<'emitted' | 'processed' | 'skipped' | 'failed'> => {
    try {
      if (input.isRefreshCurrent?.() === false) return 'skipped';
      const resources = await deps.materializeAndList({
        workspaceId: input.workspaceId,
        resourceKind,
        scope: input.scope,
      });
      const reconciliation = await deps.reconcile({
        workspaceId: input.workspaceId,
        resourceKind,
        scope: input.scope,
        resources,
      });
      const key = `${input.workspaceId}\u0000${resourceKind}`;
      const nextSignature = teamResourceSignature(resources);
      const previousSignature = signatures.get(key);
      const shouldEmit = input.reason === 'push'
        || reconciliation.retired > 0
        || reconciliation.rebound > 0
        || (previousSignature === undefined
          ? resources.length > 0
          : previousSignature !== nextSignature);

      if (shouldEmit) {
        deps.emit(input.workspaceId, {
          type: 'team-resources-changed',
          resourceKind,
          ...(input.resourceId ? { resourceId: input.resourceId } : {}),
          at: deps.now?.() ?? Date.now(),
        });
      }
      signatures.set(key, nextSignature);
      return shouldEmit ? 'emitted' : 'processed';
    } catch (error) {
      deps.onError?.(error, resourceKind);
      return 'failed';
    }
  };

  const enqueueKind = async (
    input: WorkspaceTeamResourceRefreshInput<TScope>,
    resourceKind: WorkspaceTeamResourceKind,
  ): Promise<'emitted' | 'processed' | 'skipped' | 'failed'> => {
    const key = `${input.workspaceId}\u0000${resourceKind}`;
    const previous = pending.get(key);
    let result: 'emitted' | 'processed' | 'skipped' | 'failed' = 'failed';
    const run = async () => {
      result = await runKind(input, resourceKind);
    };
    const current = previous
      ? previous.catch(() => undefined).then(run)
      : run();
    pending.set(key, current);
    await current;
    if (pending.get(key) === current) pending.delete(key);
    return result;
  };

  return {
    async refresh(input) {
      const kinds = input.resourceKind === undefined
        ? TEAM_RESOURCE_KINDS
        : isWorkspaceTeamResourceKind(input.resourceKind)
          ? [input.resourceKind]
          : [];
      const outcomes = await Promise.all(
        kinds.map(async (resourceKind) => ({
          resourceKind,
          outcome: await enqueueKind(input, resourceKind),
        })),
      );
      return {
        processedKinds: outcomes
          .filter(({ outcome }) => outcome === 'processed' || outcome === 'emitted')
          .map(({ resourceKind }) => resourceKind),
        emittedKinds: outcomes
          .filter(({ outcome }) => outcome === 'emitted')
          .map(({ resourceKind }) => resourceKind),
        failedKinds: outcomes
          .filter(({ outcome }) => outcome === 'failed')
          .map(({ resourceKind }) => resourceKind),
      };
    },
  };
}
