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
  };
  write([next, ...filtered]);
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
  }));
}

/** Remove a project from the recently-opened store (e.g. after deletion). */
export function removeRecentlyOpenedProject(projectId: string): void {
  const entries = read().filter((e) => e.id !== projectId);
  write(entries);
}
