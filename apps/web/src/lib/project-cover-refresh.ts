// Targeted, request-free cover update for the card of the project that was
// edited in a conversation view.
//
// Saving an HTML artifact already produces the new cover digest on the client
// (captureCoverForEditedHtml -> updateRecentlyOpenedProjectCover). Nothing has
// to be re-fetched: the daemon row, the list requests and the folder previews
// all stay exactly as they are. This module just keeps a per-project digest
// override in memory and lets every mounted card surface read it while
// rendering. Only the edited project's cover URL changes, so the browser
// loads one new PNG and no other card re-requests anything.
//
// The override also survives unmount/remount of a surface (the map is module
// scoped), which matters because Home recents is a keep-alive surface while
// 个人所有 / 分享给我 / 团队 own independent list reads that may mount later.

import { useSyncExternalStore } from 'react';

/** projectId -> authoritative cover digest; `null` means "no cover". */
const coverDigests = new Map<string, string | null>();
/** Per-project bump used to cache-bust local cover URLs without a digest. */
const coverVersions = new Map<string, number>();
const subscribers = new Set<() => void>();
let revision = 0;

/** Announce a freshly generated cover digest. No network, no list refresh. */
export function publishProjectCoverDigest(
  projectId: string,
  coverDigest: string | null,
): void {
  if (!projectId) return;
  if (coverDigests.has(projectId) && coverDigests.get(projectId) === coverDigest) return;
  coverDigests.set(projectId, coverDigest);
  coverVersions.set(projectId, (coverVersions.get(projectId) ?? 0) + 1);
  revision += 1;
  for (const listener of subscribers) listener();
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

function getRevision(): number { return revision; }

/** Re-render the subscribed card surfaces whenever one cover changes. */
export function useProjectCoverRefresh(): void {
  useSyncExternalStore(subscribe, getRevision, getRevision);
}

/** Effective digest: the targeted override wins over the stale list row. */
export function projectCoverDigestFor(
  projectId: string,
  rowDigest: string | null | undefined,
): string | null {
  return coverDigests.has(projectId)
    ? coverDigests.get(projectId)!
    : (rowDigest ?? null);
}

export function projectCoverVersionFor(projectId: string): number {
  return coverVersions.get(projectId) ?? 0;
}

/** Whether a save-time publish already supplied an authoritative digest. */
export function hasProjectCoverOverride(projectId: string): boolean {
  return coverDigests.has(projectId);
}

/** Local daemon cover URL, addressed by the effective digest. */
export function localProjectCoverUrl(
  projectId: string,
  rowDigest?: string | null,
): string {
  const digest = projectCoverDigestFor(projectId, rowDigest);
  const params = new URLSearchParams();
  if (digest) params.set('digest', digest);
  const version = projectCoverVersionFor(projectId);
  if (version > 0) params.set('v', String(version));
  const query = params.toString();
  return `/api/projects/${encodeURIComponent(projectId)}/cover${query ? `?${query}` : ''}`;
}

/** HDW catalog cover URL for team / shared-with-me cards. */
export function sharedProjectCoverUrl(
  projectId: string | null | undefined,
  rowDigest?: string | null,
): string | null {
  const digest = projectId
    ? projectCoverDigestFor(projectId, rowDigest)
    : (rowDigest ?? null);
  if (!digest) return null;
  return `/api/hdw/api/community/cover/${encodeURIComponent(digest)}`;
}

/**
 * Cover URL for one project card or folder-preview thumbnail.
 *
 * A digest produced by a local edit (or by the local project read) is the
 * daemon's SHA-256 of `.cover.png`. HDW assigns its own blob digest when the
 * cover is synced, and that sync is asynchronous, so feeding the local digest
 * into the HDW path would 404. An edited card therefore reads the PNG that was
 * just written from the local daemon; every other card keeps its original URL.
 */
export function projectCardCoverUrl(
  projectId: string | null | undefined,
  rowDigest: string | null | undefined,
  isPersonal: boolean,
): string | null {
  // Without a digest the card keeps its original iframe/entry-file/glyph
  // fallback; inventing a cover URL here would short-circuit that path.
  const digest = projectId
    ? projectCoverDigestFor(projectId, rowDigest)
    : (rowDigest ?? null);
  if (!digest) return null;
  if (projectId && (isPersonal || hasProjectCoverOverride(projectId))) {
    return localProjectCoverUrl(projectId, rowDigest);
  }
  return sharedProjectCoverUrl(projectId, rowDigest);
}

/** Test-only: clear the in-memory overrides between cases. */
export function resetProjectCoverOverrides(): void {
  coverDigests.clear();
  coverVersions.clear();
  revision += 1;
}
