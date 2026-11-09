// Author-side file-change → publish TRIGGER (C spec §D1: C owns *when* to
// publish; the resource hub owns the mechanism). This subscribes to file-change
// events for the projects this daemon's member OWNS and has shared to the team,
// and coalesces every edit into a debounced publish through the scheduler.
//
// Read-only gate (loop-safe): a project is watched ONLY when this daemon's member
// is its single writer (team-shared AND owner === me). A member's pulled read-only
// copy (owned by someone else) is never watched here, so materializing an inbound
// pull can never loop back into a publish. It also keeps the member — who must
// stay read-only — from ever publishing edits to someone else's project.
//
// Kept OUT of runtime.ts (which #5383 is also editing) so the surfaces do not
// collide; server.ts wires it to the runtime's scheduler + the project watchers.

import type { ResourceHubPrincipal } from './resource-principal.js';

export interface PublishWatchSubscription {
  unsubscribe: () => Promise<void> | void;
}

export interface CollabPublishWatcherDeps {
  /** Coalesce every file edit into a debounced publish (the scheduler owns the window). */
  notifyChanged: (
    projectId: string,
    principal?: ResourceHubPrincipal,
  ) => void;
  /** Local project ids to consider watching. */
  listProjectIds: () => string[];
  /** Stable account/workspace/member identity; permission revisions invalidate separately. */
  identityKey?: (projectId: string) => string;
  /**
   * Whether THIS daemon should publish edits to `projectId`: it is team-shared
   * AND this daemon's member is its owner (the single writer). Async because it
   * consults the team hub + the workspace context.
   */
  shouldPublish: (
    projectId: string,
  ) => Promise<boolean | ResourceHubPrincipal>;
  /** Subscribe to file-change events for a project's content dir. */
  subscribeFiles: (projectId: string, onChange: () => void) => PublishWatchSubscription;
  /** Reconcile cadence (ms): how often to (re)discover owned+shared projects. */
  reconcileMs?: number;
  onError?: (error: unknown) => void;
}

export interface CollabPublishWatcher {
  /** Reconcile once immediately (exposed for tests / eager first pass). */
  reconcile: () => Promise<void>;
  /** Membership/permission events invalidate pending decisions and retry cooldowns. */
  invalidate: () => Promise<void>;
  start: () => void;
  dispose: () => void;
}

const DEFAULT_RECONCILE_MS = 10_000;

export function createCollabPublishWatcher(deps: CollabPublishWatcherDeps): CollabPublishWatcher {
  const reconcileMs = deps.reconcileMs ?? DEFAULT_RECONCILE_MS;
  const subs = new Map<string, {
    subscription: PublishWatchSubscription;
    principal: ResourceHubPrincipal | undefined;
    identity: string;
    verifiedGeneration: number;
    dirty: boolean;
  }>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  let generation = 0;
  let disposed = false;
  let reconcileAgain = false;
  const identityFor = (projectId: string) => deps.identityKey?.(projectId) ?? '';
  const retries = new Map<string, { identity: string; attempts: number; retryAt: number }>();

  const notify = (projectId: string, principal: ResourceHubPrincipal | undefined) => {
    if (principal) deps.notifyChanged(projectId, principal);
    else deps.notifyChanged(projectId);
  };
  const unwatch = (projectId: string) => {
    const watched = subs.get(projectId);
    subs.delete(projectId);
    if (watched) void Promise.resolve(watched.subscription.unsubscribe()).catch(() => {});
  };

  async function reconcilePass(): Promise<void> {
    do {
      reconcileAgain = false;
      const ids = new Set(deps.listProjectIds());
      for (const projectId of retries.keys()) {
        if (!ids.has(projectId)) retries.delete(projectId);
      }
      for (const [projectId, watched] of subs) {
        if (!ids.has(projectId) || watched.identity !== identityFor(projectId)) unwatch(projectId);
      }
      for (const projectId of ids) {
        if (disposed) return;
        const identity = identityFor(projectId);
        const decisionGeneration = generation;
        let watched = subs.get(projectId);
        if (watched && watched.identity !== identity) {
          unwatch(projectId);
          watched = undefined;
        }
        if (watched?.verifiedGeneration === decisionGeneration) continue;
        const previousRetry = retries.get(projectId);
        const retry = previousRetry?.identity === identity ? previousRetry : undefined;
        if (retry && Date.now() < retry.retryAt) continue;
        let publishScope: boolean | ResourceHubPrincipal = false;
        try {
          publishScope = await deps.shouldPublish(projectId);
        } catch (error) {
          if (disposed || generation !== decisionGeneration || identityFor(projectId) !== identity) continue;
          const attempts = Math.min((retry?.attempts ?? 0) + 1, 6);
          retries.set(projectId, {
            identity,
            attempts,
            retryAt: Date.now() + Math.min(60_000, reconcileMs * 2 ** (attempts - 1)),
          });
          deps.onError?.(error);
          continue;
        }
        if (disposed || generation !== decisionGeneration || identityFor(projectId) !== identity) continue;
        retries.delete(projectId);
        if (!publishScope) {
          unwatch(projectId);
          continue;
        }
        const principal = typeof publishScope === 'object' ? publishScope : undefined;
        if (watched) {
          watched.principal = principal;
          watched.verifiedGeneration = decisionGeneration;
          if (watched.dirty) {
            watched.dirty = false;
            notify(projectId, principal);
          }
          continue;
        }
        const subscription: PublishWatchSubscription = deps.subscribeFiles(projectId, () => {
          const current = subs.get(projectId);
          if (disposed || current?.subscription !== subscription || identityFor(projectId) !== identity) return;
          // Retain edits while permission is unknown, but never publish them
          // until a current authority check succeeds.
          current.dirty = true;
          if (current.verifiedGeneration !== generation) return;
          current.dirty = false;
          notify(projectId, current.principal);
        });
        subs.set(projectId, {
          subscription, identity, principal, verifiedGeneration: decisionGeneration, dirty: false,
        });
        // ignoreInitial file watchers do not announce files already on disk.
        // Publish once for a genuinely new owned subscription, not a permission
        // revalidation of the same subscription.
        notify(projectId, principal);
      }
    } while (reconcileAgain && !disposed);
  }

  function reconcile(): Promise<void> {
    if (disposed) return Promise.resolve();
    // Install the shared promise before starting work: directory callbacks may
    // invalidate synchronously while a scope decision is being resolved.
    if (!running) {
      running = Promise.resolve().then(reconcilePass).finally(() => {
        running = null;
        // A dirty event can arrive after the last pass but before this promise
        // settles. Its callers must also wait for the replacement authority.
        if (reconcileAgain && !disposed) return reconcile();
      });
      void running.catch(error => deps.onError?.(error));
    }
    return running;
  }

  return {
    reconcile,
    invalidate() {
      generation += 1;
      retries.clear();
      reconcileAgain = true;
      return reconcile();
    },
    start() {
      if (timer) return;
      void reconcile();
      timer = setInterval(() => void reconcile(), reconcileMs);
      timer.unref?.();
    },
    dispose() {
      disposed = true;
      generation += 1;
      retries.clear();
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      for (const projectId of subs.keys()) unwatch(projectId);
    },
  };
}
