// Recently-opened project tracking for the Home "recent projects" strip.
//
// Projects shared *to* the current user live in a different workspace, so
// the daemon's `?view=recent` query (which filters by the viewer's
// workspace_projects binding) never returns them. This localStorage store
// bridges that gap: when the user opens a shared project from /share-me,
// we record enough of the Project shape to render a card on Home, then
// merge it into homeProjectsList so it survives the next server re-fetch.
//
// localStorage is the right home: this is a UX nicety (remembering what
// the user just opened), not source-of-truth state. The server remains
// the authority for project existence and metadata; this store only
// seeds the Home strip until the next server-side refresh replaces it.
import type { Project } from '../types';

const STORAGE_KEY = 'od:recently-opened-projects';
const LIMIT = 10;

/**
 * Minimal project shape persisted to localStorage. We store only the
 * fields the Home strip needs to render a card; the full Project object
 * is re-fetched from the daemon on open.
 */
export interface RecentlyOpenedProject {
  id: string;
  name: string;
  skillId: string | null;
  designSystemId: string | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  workspaceId?: string | null;
  createdByWorkspaceMemberId?: string | null;
  ownerDisplayName?: string | null;
  metadata?: Project['metadata'];
  coverDigest?: string | null;
  workspaceVisibility?: Project['workspaceVisibility'];
}

function read(): RecentlyOpenedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isValidEntry) : [];
  } catch {
    return [];
  }
}

function isValidEntry(x: unknown): x is RecentlyOpenedProject {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return typeof e.id === 'string'
    && typeof e.name === 'string'
    && typeof e.createdAt === 'number'
    && typeof e.updatedAt === 'number'
    && typeof e.openedAt === 'number';
}

function write(entries: RecentlyOpenedProject[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    // Quota exceeded or private mode — best-effort, drop silently.
  }
}

/** Record a project the user just opened so it appears in Home's recent strip. */
export function recordRecentlyOpenedProject(project: Project): void {
  const entries = read();
  const filtered = entries.filter((e) => e.id !== project.id);
  const next: RecentlyOpenedProject = {
    id: project.id,
    name: project.name,
    skillId: project.skillId,
    designSystemId: project.designSystemId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    openedAt: Date.now(),
    ...(project.workspaceId != null ? { workspaceId: project.workspaceId } : {}),
    ...(project.createdByWorkspaceMemberId != null
      ? { createdByWorkspaceMemberId: project.createdByWorkspaceMemberId }
      : {}),
   ...(project.ownerDisplayName != null ? { ownerDisplayName: project.ownerDisplayName } : {}),
   ...(project.metadata ? { metadata: project.metadata } : {}),
   ...(project.coverDigest != null ? { coverDigest: project.coverDigest } : {}),
   ...(project.workspaceVisibility != null ? { workspaceVisibility: project.workspaceVisibility } : {}),
 };
  write([next, ...filtered]);
}

/**
 * Refresh the open time for a project already in the recent strip. Unlike
 * `recordRecentlyOpenedProject`, this does not replace the stored card with a
 * thinner project object that may lack cover or owner metadata.
 */
export function touchRecentlyOpenedProject(projectId: string): void {
  const entries = read();
  const entry = entries.find((candidate) => candidate.id === projectId);
  if (!entry) return;
  entry.openedAt = Date.now();
  write(entries);
}

/**
 * Read recently-opened projects as Project-shaped objects, ready to merge
 * into homeProjectsList. Caller is responsible for deduplication against
 * server-fetched projects (server data takes precedence).
 */
export function readRecentlyOpenedProjects(): Project[] {
  return read().map((e) => ({
    id: e.id,
    name: e.name,
    skillId: e.skillId,
    designSystemId: e.designSystemId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    ...(e.workspaceId != null ? { workspaceId: e.workspaceId } : {}),
    ...(e.createdByWorkspaceMemberId != null
      ? { createdByWorkspaceMemberId: e.createdByWorkspaceMemberId }
      : {}),
   ...(e.ownerDisplayName != null ? { ownerDisplayName: e.ownerDisplayName } : {}),
   ...(e.metadata ? { metadata: e.metadata } : {}),
   ...(e.coverDigest != null ? { coverDigest: e.coverDigest } : {}),
   ...(e.workspaceVisibility != null ? { workspaceVisibility: e.workspaceVisibility } : {}),
 }));
}

/**
 * Read recently-opened project entries including `openedAt`, so callers
 * that need to sort by open time (not just server `updatedAt`) can do so
 * without relying on array index as a proxy.
 */
export function readRecentlyOpenedProjectEntries(): RecentlyOpenedProject[] {
  return read();
}

/** Remove a project from the recently-opened store (e.g. after deletion). */
export function removeRecentlyOpenedProject(projectId: string): void {
  const entries = read().filter((e) => e.id !== projectId);
  write(entries);
}

/** Patch the coverDigest of an already-stored recently-opened project. */
export function updateRecentlyOpenedProjectCover(
  projectId: string,
  coverDigest: string,
): void {
  const entries = read();
  const idx = entries.findIndex((e) => e.id === projectId);
  if (idx < 0) return;
  if (entries[idx]!.coverDigest === coverDigest) return;
  entries[idx]!.coverDigest = coverDigest;
  write(entries);
}

/** Fill authoritative creator metadata on an existing recent entry. */
export function updateRecentlyOpenedProjectOwner(
  projectId: string,
  owner: {
    ownerDisplayName?: string | null;
    createdByWorkspaceMemberId?: string | null;
  },
): boolean {
  const entries = read();
  const entry = entries.find((candidate) => candidate.id === projectId);
  if (!entry) return false;

  const ownerDisplayName = owner.ownerDisplayName?.trim() || null;
  const createdByWorkspaceMemberId = owner.createdByWorkspaceMemberId?.trim() || null;
  let changed = false;
  if (ownerDisplayName && entry.ownerDisplayName !== ownerDisplayName) {
    entry.ownerDisplayName = ownerDisplayName;
    changed = true;
  }
  if (
    createdByWorkspaceMemberId
    && entry.createdByWorkspaceMemberId !== createdByWorkspaceMemberId
  ) {
    entry.createdByWorkspaceMemberId = createdByWorkspaceMemberId;
    changed = true;
  }
  if (changed) write(entries);
  return changed;
}

/**
 * Query the daemon for fresh cover digests for every recently-opened
 * project and patch localStorage in place. Returns the IDs whose
 * coverDigest changed so the caller can trigger a re-render if needed.
 *
 * This is the authoritative sync path: the daemon merges local SQLite
 * `projects.cover_digest` with the HDW team-projects catalog and returns
 * the best digest for each recent entry, so this call supersedes any stale
 * or missing value the localStorage entry carried from its initial
 * `recordRecentlyOpenedProject` write. Personal projects whose local
 * `.od/projects/<id>` directory is gone are removed from the localStorage
 * store so they stop showing on Home.
 */
export async function enrichRecentlyOpenedProjectCovers(): Promise<string[]> {
  const entries = read();
  if (entries.length === 0) return [];
  const ids = entries.map((e) => e.id);
  // Pass workspace scope from the localStorage entry so the daemon can
  // query the HDW team-projects catalog for covers in addition to the
  // local SQLite `projects.cover_digest` value.
  const projects = entries.map((e) => ({
    id: e.id,
    ...(e.workspaceId != null ? { workspaceId: e.workspaceId } : {}),
    ...(e.workspaceVisibility != null ? { workspaceVisibility: e.workspaceVisibility } : {}),
  }));
  let digests: Record<string, string | null> = {};
  let missingPersonalProjectIds: string[] = [];
  try {
    const resp = await fetch('/api/projects/cover-digests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, projects }),
    });
    if (!resp.ok) return [];
    const json = (await resp.json()) as {
      digests?: Record<string, string | null>;
      missingPersonalProjectIds?: string[];
    };
    digests = json.digests ?? {};
    missingPersonalProjectIds = json.missingPersonalProjectIds ?? [];
  } catch {
    return [];
  }
  const missingIds = new Set(missingPersonalProjectIds);
  const changed: string[] = [];
  const remaining: RecentlyOpenedProject[] = [];
  for (const entry of entries) {
    if (missingIds.has(entry.id)) {
      // Reuse the return value as a "needs re-render" signal so Home drops
      // the card immediately instead of waiting for a later project refresh.
      changed.push(entry.id);
      continue;
    }
    remaining.push(entry);
    const fresh = digests[entry.id] ?? null;
    if (fresh !== (entry.coverDigest ?? null)) {
      entry.coverDigest = fresh;
      changed.push(entry.id);
    }
  }
  if (changed.length > 0) write(remaining);
  return changed;
}
