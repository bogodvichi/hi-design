import { normalizeSkillCategory, type CloudResourceWorkspaceContext, type SkillCategory } from '@open-design/contracts';
import { responseError } from '../utils/userFacingError';

export interface CloudSkill extends Partial<CloudResourceWorkspaceContext> {
  resourceId: string;
  shareId?: string;
  localId: string;
  title: string;
  description: string | null;
  ownerMemberId: string;
  version: number | null;
  versionId: string | null;
  createdAt: string;
  updatedAt: string;
  // Shared-with-me fields (only present in shared mode)
  sharedByDisplayname?: string | null;
  provider?: string;
  sourceLabel?: string;
  publisherName?: string | null;
  iconUrl?: string | null;
  logoKey?: string | null;
  installed?: boolean;
  teamShared?: boolean;
  category?: SkillCategory;
  peopleCount?: number | null;
  actionCount?: number | null;
  publicationSourceType?: 'reference' | 'local_import' | 'legacy';
  communitySourceResourceId?: string | null;
}
type CatalogEntry = { source: string; skills?: CloudSkill[]; updatedAt: number; pending?: Promise<CloudSkill[]> };
const catalogs = new Map<string, CatalogEntry>();
const FRESH_MS = 5 * 60_000;
const MAX_CATALOGS = 24;
let accountToken: string | undefined;
let invalidationEvents = new WeakSet<object>();

/** Public directory metadata survives navigation; installation state is read separately. */
export function readCommunitySkillCatalog(params: URLSearchParams, headers: Record<string, string>, token: string, revalidate = false) {
  if (token !== accountToken) {
    catalogs.clear();
    accountToken = token;
  }
  const query = new URLSearchParams(params);
  query.delete('q');
  query.delete('category');
  const key = JSON.stringify([token, query.toString(), headers]);
  let entry = catalogs.get(key);
  if (!entry) {
    entry = { source: query.get('source') ?? '', updatedAt: 0 };
    catalogs.set(key, entry);
  } else {
    catalogs.delete(key);
    catalogs.set(key, entry);
  }
  while (catalogs.size > MAX_CATALOGS) catalogs.delete(catalogs.keys().next().value!);
  const current = entry;
  const cached = current.skills;
  if (!current.pending && (revalidate || !cached || Date.now() - current.updatedAt >= FRESH_MS)) {
    current.pending = (async () => {
      try {
        const response = await fetch('/api/workspace/skills/cloud?' + query, { cache: 'no-store', headers });
        if (!response.ok) {
          // A membership denial retires the old snapshot immediately.
          if ((response.status === 401 || response.status === 403) && catalogs.get(key) === current) {
            current.skills = undefined;
            catalogs.delete(key);
          }
          throw await responseError(response);
        }
        const body = await response.json() as { skills?: CloudSkill[] };
        const nextSkills = (body.skills ?? []).map((skill) => {
          const metadata = { ...skill, category: normalizeSkillCategory(skill.category) };
          delete metadata.installed;
          delete metadata.teamShared;
          return metadata;
        });
        // Reentry checks often return identical metadata; keep its identity so
        // mounted lists do not rebuild the full grid when nothing changed.
        const skills = cached && JSON.stringify(cached) === JSON.stringify(nextSkills) ? cached : nextSkills;
        if (catalogs.get(key) === current) {
          current.skills = skills;
          current.updatedAt = Date.now();
        }
        return skills;
      } finally {
        current.pending = undefined;
      }
    })();
  }
  return { cached, updated: current.pending ?? Promise.resolve(current.skills!) };
}

/** Local publication changes affect HiDesign; they do not invalidate Skillhub. */
export function invalidateCommunitySkillCatalog(event?: object): void {
  if (event && invalidationEvents.has(event)) return;
  if (event) invalidationEvents.add(event);
  for (const [key, entry] of catalogs) {
    if (entry.source === 'hdw') catalogs.delete(key);
  }
}

export function resetCommunitySkillCatalog(): void {
  catalogs.clear();
  accountToken = undefined;
  invalidationEvents = new WeakSet();
}
