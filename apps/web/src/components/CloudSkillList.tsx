import { responseError, userFacingError } from '../utils/userFacingError';
import { PageEmptyState } from './PageEmptyState';
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@open-design/components';
import { Icon } from './Icon';
import { CenteredLoader } from './Loading';
import { useI18n, useT } from '../i18n';
import { ShareResourceDialog } from './ShareResourceDialog';
import { ResourceCard } from './ResourceCard';
import { RemoveSharedResourceDialog } from './RemoveSharedResourceDialog';
import { CommunityResourceStats } from './CommunityResourceStats';
import styles from './CloudSkillList.module.css';
import {
  SKILL_CATEGORIES,
  emptySkillCategoryCounts,
  normalizeSkillCategory,
  type SkillCategoryCounts,
  type SkillCategoryFilter,
} from '@open-design/contracts';
import {
  skillCategoryButtonLabel,
  skillCategoryLabel,
  skillCategorySelectLabel,
} from '../utils/skill-category-labels';
import { resolveFloatingMenuHorizontalAlign } from '../utils/floating-menu-placement';
import { recordCommunityStat } from '../utils/community-stats';
import { coalescedGet } from '../lib/coalesced-get';
import { currentWorkspaceContextRequestToken } from '../collab/useWorkspaceContext';
import { isSkillLogoKey, SkillLogo } from './SkillLogo';
import { readCommunitySkillCatalog, invalidateCommunitySkillCatalog, type CloudSkill } from '../runtime/community-skill-catalog';
import { communityTextMatchesQuery } from '../utils/community-search';

// Build workspace headers from the string props the parent passes.
function workspaceHeaders(
  workspaceId: string | null,
  workspaceMemberId: string | null,
  workspaceType: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (workspaceId) headers['x-od-workspace-id'] = workspaceId;
  if (workspaceMemberId) headers['x-od-workspace-member-id'] = workspaceMemberId;
  if (workspaceType) headers['x-od-workspace-type'] = workspaceType;
  return headers;
}

function readCloudSkillCatalog(params: URLSearchParams, headers: Record<string, string>) {
  const url = '/api/workspace/skills/cloud?' + params;
  const key = JSON.stringify(['cloud-skills', currentWorkspaceContextRequestToken(), url, headers]);
  return coalescedGet(key, async () => {
    const res = await fetch(url, { cache: 'no-store', headers });
    if (!res.ok) throw await responseError(res);
    return res.json() as Promise<{ skills?: CloudSkill[]; categoryCounts?: Partial<SkillCategoryCounts> }>;
  }, 0);
}

// Minimal relative-date formatter (today / yesterday / N days ago).
function formatRelativeDate(
  iso: string,
  t: (key: any, vars?: Record<string, string | number>) => string,
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return t('personalScope.cloudSkillUpdatedToday');
  if (days === 1) return t('personalScope.cloudSkillUpdatedYesterday');
  return t('personalScope.cloudSkillUpdatedDaysAgo', { n: days });
}

type SkillCardBatchProps = { skills: CloudSkill[]; start: number; renderSkill: (skill: CloudSkill) => ReactNode };
const SkillCardBatch = memo(function SkillCardBatch({ skills, start, renderSkill }: SkillCardBatchProps) {
  return <>{skills.slice(start, start + 12).map(renderSkill)}</>;
});

// Keep batch state here so revealing another batch does not rebuild the cards
// already mounted. Creating the entire catalog's JSX up front also blocks clicks.
function SkillCardGrid({ skills, renderSkill, progressive }: Omit<SkillCardBatchProps, 'start'> & { progressive: boolean }) {
  const [visibleCount, setVisibleCount] = useState(12);
  useEffect(() => {
    if (!progressive || visibleCount >= skills.length) return;
    const revealNext = () => setVisibleCount((count) => Math.min(count + 12, skills.length));
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(revealNext, { timeout: 100 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(revealNext, 16);
    return () => window.clearTimeout(handle);
  }, [progressive, visibleCount, skills.length]);

  return <div className={styles.cloudSkillGrid}>{progressive
    ? Array.from({ length: Math.ceil(Math.min(visibleCount, skills.length) / 12) }, (_, index) => (
      <SkillCardBatch key={index} skills={skills} start={index * 12} renderSkill={renderSkill} />
    ))
    : skills.map(renderSkill)}</div>;
}

export function CloudSkillList({
 workspaceId,
 workspaceMemberId,
 workspaceType,
 ownerMemberId,
 sourceProvider,
 mode = 'personal',
 memberRole,
 scope,
 controlsPortalTarget,
 externalSearchQuery,
 picker = false,
 onBusyChange,
}: {
 workspaceId: string | null;
 workspaceMemberId: string | null;
 workspaceType: string | null;
 ownerMemberId?: string | null;
 sourceProvider?: string | null;
 mode?: 'personal' | 'shared' | 'square' | 'team';
 memberRole?: 'owner' | 'admin' | 'member' | 'guest';
 scope?: string;
 controlsPortalTarget?: HTMLElement | null;
 externalSearchQuery?: string;
 picker?: boolean;
 onBusyChange?: (busy: boolean) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const titleId = useId();
  const [skills, setSkills] = useState<CloudSkill[]>([]);
  const [localSkillIds, setLocalSkillIds] = useState<Set<string>>(new Set());
  const [localCloudIds, setLocalCloudIds] = useState<Set<string>>(new Set());
  const [localSkillsReady, setLocalSkillsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const effectiveSearchQuery = externalSearchQuery ?? searchQuery;
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<SkillCategoryFilter>('all');
  const [categoryCounts, setCategoryCounts] = useState<SkillCategoryCounts>(() => emptySkillCategoryCounts());
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [categoryMenuAlign, setCategoryMenuAlign] = useState<'start' | 'end'>('start');
  const [failedIconIds, setFailedIconIds] = useState<Set<string>>(new Set());
 const [confirmAction, setConfirmAction] = useState<{ type: 'unpublish' | 'delete'; item: CloudSkill } | null>(null);
 const [shareItem, setShareItem] = useState<CloudSkill | null>(null);
 const [removeShareId, setRemoveShareId] = useState<string | null>(null);
 const showCommunityControls = mode === 'square' && sourceProvider === 'all';
 const useCommunityCatalog = mode === 'square' && scope === 'public' && !ownerMemberId
   && (sourceProvider === 'all' || sourceProvider === 'maas-skillhub' || sourceProvider === 'hdw');
 const catalogSearch = useCommunityCatalog ? '' : debouncedSearch;
 const catalogCategory = useCommunityCatalog ? 'all' : activeCategory;
 const categoryMenuRef = useRef<HTMLDivElement | null>(null);
 const categoryMenuPanelRef = useRef<HTMLDivElement | null>(null);
 const loadRequestId = useRef(0);
 const localRequestId = useRef(0);
 const identityKey = JSON.stringify([currentWorkspaceContextRequestToken(), workspaceId, workspaceMemberId, workspaceType]);
 const currentIdentity = useRef(identityKey);
 currentIdentity.current = identityKey;

 useEffect(() => {
   onBusyChange?.(installingId !== null);
 }, [installingId, onBusyChange]);

 const countCategories = useCallback((items: readonly CloudSkill[]): SkillCategoryCounts => {
   const counts = emptySkillCategoryCounts();
   for (const skill of items) {
     const category = normalizeSkillCategory(skill.category);
     counts.all += 1;
     counts[category] += 1;
   }
   return counts;
 }, []);

 const loadLocalSkills = useCallback(async () => {
   const requestId = ++localRequestId.current;
   const token = currentWorkspaceContextRequestToken();
   const isCurrent = () => localRequestId.current === requestId && currentWorkspaceContextRequestToken() === token;
   setLocalSkillIds(new Set());
   setLocalCloudIds(new Set());
   setLocalSkillsReady(false);
   if (!workspaceId) { setLocalSkillIds(new Set()); return; }
   try {
     const res = await fetch('/api/skills', {
       cache: 'no-store',
       headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
     });
     if (!res.ok) return;
  const body = await res.json();
  if (!isCurrent()) return;
  const installed = (body.skills ?? []) as Array<{ id: string; cloudResourceId?: string }>;
  const ids = new Set<string>(
    installed.map((s) => s.id.toLowerCase()),
  );
  setLocalSkillIds(ids);
  setLocalCloudIds(new Set(installed.flatMap((skill) => skill.cloudResourceId ? [skill.cloudResourceId] : [])));
  setLocalSkillsReady(true);
    } catch {
      // Installation controls stay unavailable until a scoped read succeeds.
    }
  }, [workspaceId, workspaceMemberId, workspaceType]);

  const loadSkills = useCallback(async (revalidate = false) => {
    const requestId = ++loadRequestId.current;
    const token = currentWorkspaceContextRequestToken();
    const isCurrent = () => loadRequestId.current === requestId && currentWorkspaceContextRequestToken() === token;
    // ── Design intent (do not change) ──────────────────────────────
    // Personal skills are cloud resources owned by the current user,
    // stored in the shared HDW space — NOT local on-disk files. The
    // personal mode queries /api/workspace/skills/cloud with an
    // owner_member_id filter so the list reflects what the user
    // published to the cloud, while loadLocalSkills() separately
    // tracks which of those are materialized locally (installed).
    // This mirrors CloudMcpList and is the intended architecture.
    // ──────────────────────────────────────────────────────────────
    if (mode === 'shared') {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/resource-share/shared-with-me?kind=skill', { cache: 'no-store' });
        if (!res.ok) { throw await responseError(res); }
        const body = await res.json();
        const list: CloudSkill[] = (body.resources ?? []).map((r: any) => ({
          resourceId: r.resourceId,
          shareId: r.shareId,
          localId: r.metadata?.localId ?? r.resourceId,
          title: r.metadata?.title ?? r.resourceId,
          description: r.metadata?.description ?? null,
          ownerMemberId: r.ownerMemberId ?? '',
          version: null,
          versionId: null,
          createdAt: r.createdAt ?? '',
          updatedAt: r.updatedAt ?? '',
          sharedByDisplayname: r.sharedByDisplayname ?? null,
          homeWorkspaceId: r.homeWorkspaceId ?? '',
          category: normalizeSkillCategory(r.metadata?.category),
          logoKey: r.metadata?.logoKey,
        }));
        if (!isCurrent()) return;
        setError(null);
        setSkills(list);
        setCategoryCounts(countCategories(list));
      } catch (err: any) {
        if (!isCurrent()) return;
        setError(userFacingError(err, t, 'feedback.loadSkillsFailed', t('feedback.objectSkill')));
      } finally {
        if (isCurrent()) setLoading(false);
      }
      return;
    }
    if (!workspaceId) {
      setSkills([]);
      setCategoryCounts(emptySkillCategoryCounts());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
    if (mode === 'team') {
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      const [cloudResult, teamResult] = await Promise.allSettled([
        fetch('/api/workspace/skills/cloud?', { cache: 'no-store', headers }),
        fetch('/api/workspace/skills/team', { cache: 'no-store', headers }),
      ]);
      const cloudResponse = cloudResult.status === 'fulfilled' && cloudResult.value.ok
        ? await cloudResult.value.json()
        : null;
      const teamResponse = teamResult.status === 'fulfilled' && teamResult.value.ok
        ? await teamResult.value.json()
        : null;
      if (!cloudResponse && !teamResponse) {
        if (cloudResult.status === 'fulfilled') throw await responseError(cloudResult.value);
        throw cloudResult.reason;
      }

      const merged = new Map<string, CloudSkill>();
      for (const skill of (cloudResponse?.skills ?? []) as CloudSkill[]) {
        merged.set(skill.localId, { ...skill, category: normalizeSkillCategory(skill.category) });
      }
      for (const resource of (teamResponse?.resources ?? []) as Array<{
        id: string;
        hubResourceId?: string;
        title?: string;
        description?: string;
        ownerMemberId?: string;
        version?: number;
        versionId?: string;
      }>) {
        const existing = merged.get(resource.id);
        merged.set(resource.id, {
          resourceId: existing?.resourceId ?? resource.hubResourceId ?? `team:${resource.id}`,
          localId: resource.id,
          title: existing?.title ?? resource.title ?? resource.id,
          description: existing?.description ?? resource.description ?? null,
          ownerMemberId: existing?.ownerMemberId ?? resource.ownerMemberId ?? '',
          version: existing?.version ?? resource.version ?? null,
          versionId: existing?.versionId ?? resource.versionId ?? null,
          createdAt: existing?.createdAt ?? '',
          updatedAt: existing?.updatedAt ?? '',
          ...existing,
          installed: true,
          teamShared: true,
          category: normalizeSkillCategory(existing?.category),
        });
      }
      const list = [...merged.values()];
      if (!isCurrent()) return;
      setError(null);
      setSkills(list);
      setCategoryCounts(countCategories(list));
      return;
    }
    if (mode === 'personal') {
      // Personal mode: query the cloud endpoint with owner_member_id
      // set to the current user's workspaceMemberId, so the list
      // reflects what the user published to the cloud. Mirrors
      // CloudMcpList. loadLocalSkills() separately tracks which of
      // those are materialized locally (installed).
      const params = new URLSearchParams();
      const ownerFilter = ownerMemberId ?? workspaceMemberId ?? null;
      if (ownerFilter) params.set('owner_member_id', ownerFilter);
      if (catalogSearch) params.set('q', catalogSearch);
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      const body = await readCloudSkillCatalog(params, headers);
      if (!isCurrent()) return;
      setError(null);
      const list: CloudSkill[] = ((body.skills ?? []) as CloudSkill[]).map((skill) => ({
        ...skill,
        category: normalizeSkillCategory(skill.category),
      }));
      setSkills(list);
      const nextCounts = body.categoryCounts as Partial<SkillCategoryCounts> | undefined;
      setCategoryCounts(nextCounts ? {
        ...emptySkillCategoryCounts(),
        ...nextCounts,
      } : countCategories(list));
    } else {
      const params = new URLSearchParams();
      // ownerMemberId controls the owner filter; when null, all public
      // resources are returned (community browse). workspaceMemberId is
      // still sent in the workspace headers for auth and delete checks.
      const ownerFilter = ownerMemberId ?? null;
      if (ownerFilter) params.set('owner_member_id', ownerFilter);
      if (scope) params.set('scope', scope);
      if (sourceProvider) params.set('source', sourceProvider);
      if (catalogSearch) params.set('q', catalogSearch);
      if (showCommunityControls && catalogCategory !== 'all') params.set('category', catalogCategory);
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      if (useCommunityCatalog) {
        const sources = sourceProvider === 'all' ? ['maas-skillhub', 'hdw'] : [sourceProvider!];
        const reads = sources.map((source) => {
          const sourceParams = new URLSearchParams(params);
          sourceParams.set('source', source);
          return readCommunitySkillCatalog(sourceParams, headers, token, revalidate);
        });
        const catalogs = new Map(sources.flatMap((source, index) => (
          reads[index]!.cached ? [[source, reads[index]!.cached!] as const] : []
        )));
        const publish = () => {
          if (!isCurrent()) return;
          const list = sources.flatMap((source) => catalogs.get(source) ?? []);
          setSkills(list);
          setLoading(list.length === 0 && catalogs.size < sources.length);
        };
        publish();
        const results = await Promise.allSettled(reads.map(async (read, index) => {
          try {
            const list = await read.updated;
            if (catalogs.get(sources[index]!) === list) return;
            catalogs.set(sources[index]!, list);
            publish();
          } catch (error) {
            const status = (error as { status?: number }).status;
            if (status === 401 || status === 403) {
              catalogs.delete(sources[index]!);
              publish();
            }
            throw error;
          }
        }));
        if (!isCurrent()) return;
        const hdwResult = results[sources.indexOf('hdw')];
        if (hdwResult?.status === 'rejected') throw hdwResult.reason;
        if (results.every((result) => result.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
        return;
      }
      const body = await readCloudSkillCatalog(params, headers);
      if (!isCurrent()) return;
      setError(null);
      const list: CloudSkill[] = ((body.skills ?? []) as CloudSkill[]).map((skill) => ({
        ...skill,
        category: normalizeSkillCategory(skill.category),
      }));
      setSkills(list);
      const nextCounts = body.categoryCounts as Partial<SkillCategoryCounts> | undefined;
      setCategoryCounts(nextCounts ? {
        ...emptySkillCategoryCounts(),
        ...nextCounts,
      } : countCategories(list));
    }
    } catch (err: any) {
     if (!isCurrent()) return;
     setError(userFacingError(err, t, 'feedback.loadSkillsFailed', t('feedback.objectSkill')));
   } finally {
     if (isCurrent()) setLoading(false);
   }
 }, [workspaceId, workspaceMemberId, workspaceType, ownerMemberId, mode, scope, sourceProvider, catalogSearch, showCommunityControls, catalogCategory, useCommunityCatalog, countCategories, t]);

useEffect(() => {
  const timer = window.setTimeout(() => setDebouncedSearch(effectiveSearchQuery.trim()), 250);
  return () => window.clearTimeout(timer);
}, [effectiveSearchQuery]);

useEffect(() => {
  if (!showCommunityControls && activeCategory !== 'all') setActiveCategory('all');
}, [activeCategory, showCommunityControls]);

useEffect(() => {
  if (!categoryMenuOpen) return;
  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && categoryMenuRef.current?.contains(target)) return;
    setCategoryMenuOpen(false);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') setCategoryMenuOpen(false);
  };
  document.addEventListener('pointerdown', handlePointerDown);
  document.addEventListener('keydown', handleKeyDown);
  return () => {
    document.removeEventListener('pointerdown', handlePointerDown);
    document.removeEventListener('keydown', handleKeyDown);
  };
}, [categoryMenuOpen]);

useLayoutEffect(() => {
  if (!categoryMenuOpen) return;
  const anchor = categoryMenuRef.current;
  const menu = categoryMenuPanelRef.current;
  const trigger = anchor?.querySelector<HTMLElement>(':scope > button');
  if (!anchor || !menu || !trigger) return;

  const measure = () => {
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    setCategoryMenuAlign(resolveFloatingMenuHorizontalAlign({
      triggerLeft: triggerRect.left,
      triggerRight: triggerRect.right,
      menuWidth: menuRect.width,
      viewportWidth: window.innerWidth || document.documentElement.clientWidth,
      preferred: 'start',
    }));
  };

  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('scroll', measure, true);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(trigger);
  observer?.observe(menu);
  return () => {
    window.removeEventListener('resize', measure);
    window.removeEventListener('scroll', measure, true);
    observer?.disconnect();
  };
}, [categoryMenuOpen]);

useEffect(() => {
  void loadSkills(true);
  return () => { loadRequestId.current += 1; };
}, [loadSkills]);

useEffect(() => {
  void loadLocalSkills();
  return () => { localRequestId.current += 1; };
}, [loadLocalSkills]);

 useEffect(() => {
   const handler = (event: Event) => {
     if (event instanceof CustomEvent && event.detail?.source === 'cloud-skill-list') {
       if (event.detail.instanceId !== titleId) void loadLocalSkills();
       return;
     }
     invalidateCommunitySkillCatalog(event);
     void loadSkills();
     void loadLocalSkills();
   };
    window.addEventListener('personal:skill-refresh', handler);
    return () => window.removeEventListener('personal:skill-refresh', handler);
  }, [loadSkills, loadLocalSkills, titleId]);

  async function handleInstall(skill: CloudSkill) {
    const issuedIdentity = currentIdentity.current;
    setInstallingId(skill.resourceId);
    setError(null);
   try {
     const params = new URLSearchParams();
     if (skill.homeWorkspaceId) params.set('home_workspace_id', skill.homeWorkspaceId);
     if (skill.provider) params.set('source', skill.provider);
     const installUrl = '/api/workspace/skills/cloud/' + encodeURIComponent(skill.resourceId) + '/install'
       + (params.size ? '?' + params : '');
     const res = await fetch(installUrl, {
       method: 'POST',
       headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
     });
      if (!res.ok) {
        throw await responseError(res);
      }
      const body = await res.json() as { localId?: string };
      if (currentIdentity.current !== issuedIdentity) return;
      const installedLocalId = body.localId || skill.localId;
      const cloudId = skill.provider === 'maas-skillhub' ? `maas-skillhub:${skill.resourceId}` : skill.resourceId;
      setLocalCloudIds((current) => new Set(current).add(cloudId));
     setLocalSkillIds((current) => new Set([...current].concat(installedLocalId.toLowerCase())));
      setSkills((current) => current.map((item) => (
        item.resourceId === skill.resourceId
          ? { ...item, localId: installedLocalId, installed: true }
          : item
      )));
      if (mode === 'square' && scope === 'public') {
        const statResourceId = skill.provider === 'maas-skillhub'
          ? `maas-skillhub:${skill.resourceId}`
          : skill.resourceId;
        const stats = await recordCommunityStat({
          resourceType: 'skill',
          resourceId: statResourceId,
          metric: 'action',
          workspaceId,
          workspaceMemberId,
          workspaceType,
        });
        if (stats) {
          setSkills((current) => current.map((item) => (
            item.resourceId === skill.resourceId
              ? { ...item, peopleCount: stats.actionUserCount, actionCount: stats.actionCount }
              : item
          )));
        }
      }
      window.dispatchEvent(new CustomEvent('personal:skill-refresh', {
        detail: { source: 'cloud-skill-list', instanceId: titleId },
      }));
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.installFailed', t('feedback.objectSkill')));
    } finally {
      setInstallingId(null);
    }
  }

  async function handleUninstall(skill: CloudSkill) {
   const issuedIdentity = currentIdentity.current;
   setUninstallingId(skill.resourceId);
   setError(null);
   try {
      const params = new URLSearchParams();
      if (skill.homeWorkspaceId) params.set('home_workspace_id', skill.homeWorkspaceId);
      if (skill.provider) params.set('source', skill.provider);
      const uninstallUrl = '/api/workspace/skills/cloud/' + encodeURIComponent(skill.resourceId) + '/uninstall'
        + (params.size ? '?' + params : '');
      const res = await fetch(uninstallUrl, {
        method: 'DELETE',
        headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
      });
      if (!res.ok) {
        throw await responseError(res);
      }
      if (currentIdentity.current !== issuedIdentity) return;
      const cloudId = skill.provider === 'maas-skillhub' ? `maas-skillhub:${skill.resourceId}` : skill.resourceId;
      setLocalCloudIds((current) => {
        const next = new Set(current);
        next.delete(cloudId);
        return next;
      });
      setLocalSkillIds((current) => {
        const next = new Set(current);
        next.delete(skill.localId.toLowerCase());
        return next;
      });
      setSkills((current) => current.map((item) => (
        item.resourceId === skill.resourceId ? { ...item, installed: false } : item
      )));
      window.dispatchEvent(new CustomEvent('personal:skill-refresh', {
        detail: { source: 'cloud-skill-list', instanceId: titleId },
      }));
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.uninstallFailed', t('feedback.objectSkill')));
    } finally {
      setUninstallingId(null);
    }
  }

  async function handleDelete(skill: CloudSkill) {
    setDeletingId(skill.resourceId);
    try {
      const res = await fetch(
        '/api/workspace/skills/cloud/' + encodeURIComponent(skill.resourceId) + (mode === 'square' ? '?community=1' : ''),
        {
          method: 'DELETE',
           // Team deletion never targets the home workspace of an external link.
           headers: mode === 'team'
             ? workspaceHeaders(workspaceId, workspaceMemberId, workspaceType)
             : workspaceHeaders(skill.homeWorkspaceId ?? workspaceId, skill.homeWorkspaceMemberId ?? workspaceMemberId, skill.homeWorkspaceType ?? workspaceType),
        },
      );
      if (!res.ok) {
        throw await responseError(res);
      }
      // Actively refresh both cloud list and local installed set after delete
      invalidateCommunitySkillCatalog();
      await Promise.all([loadSkills(), loadLocalSkills()]);
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.deleteFailed', t('feedback.objectSkill')));
    } finally {
      setDeletingId(null);
      setConfirmAction(null);
    }
  }


  async function handleUpdatePublication(skill: CloudSkill) {
    setUpdatingId(skill.resourceId);
    setError(null);
    try {
      const res = await fetch('/api/workspace/skills/cloud/' + encodeURIComponent(skill.resourceId) + '/update-publication', {
        method: 'POST',
        headers: workspaceHeaders(skill.homeWorkspaceId ?? workspaceId,
          skill.homeWorkspaceMemberId ?? workspaceMemberId, skill.homeWorkspaceType ?? workspaceType),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || 'Update publication failed');
      }
      invalidateCommunitySkillCatalog();
      await Promise.all([loadSkills(), loadLocalSkills()]);
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.updatePublicationFailed', t('feedback.objectSkill')));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleUnpublish(skill: CloudSkill) {
    setUnpublishingId(skill.resourceId);
    try {
      const res = await fetch(
        '/api/workspace/skills/cloud/' + encodeURIComponent(skill.resourceId) + '/unpublish',
        {
          method: 'POST',
          headers: workspaceHeaders(skill.homeWorkspaceId ?? workspaceId, skill.homeWorkspaceMemberId ?? workspaceMemberId, skill.homeWorkspaceType ?? workspaceType),
        },
      );
      if (!res.ok) {
        throw await responseError(res);
      }
      invalidateCommunitySkillCatalog();
      await Promise.all([loadSkills(), loadLocalSkills()]);
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.unpublishFailed', t('feedback.objectSkill')));
    } finally {
      setUnpublishingId(null);
      setConfirmAction(null);
    }
  }

  const searchedSkills = useCommunityCatalog ? skills.filter((skill) => communityTextMatchesQuery([
    skill.title, skill.localId, skill.description, skill.publisherName, skill.sourceLabel,
  ], effectiveSearchQuery)) : skills;
  const visibleSkills = useCommunityCatalog && activeCategory !== 'all'
    ? searchedSkills.filter((skill) => normalizeSkillCategory(skill.category) === activeCategory)
    : searchedSkills;
  const visibleCounts = useCommunityCatalog ? countCategories(searchedSkills) : categoryCounts;

  const fallbackSearchControl = sourceProvider === 'maas-skillhub' && !showCommunityControls ? (
    <label className={styles.searchBox}>
      <Icon name="search" size={15} />
      <input
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder={`${t('common.search' as any)} Skill`}
        aria-label={`${t('common.search' as any)} Skill`}
      />
      {searchQuery ? (
        <button
          type="button"
          className={styles.searchClear}
          aria-label={t('common.clear' as any)}
          onClick={() => setSearchQuery('')}
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </label>
  ) : null;

  const categoryControl = showCommunityControls ? (
    <div ref={categoryMenuRef} className="recent-projects__filter-wrap">
      <button
        type="button"
        className={`recent-projects__select-toggle${activeCategory !== 'all' || categoryMenuOpen ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={categoryMenuOpen}
        onClick={() => setCategoryMenuOpen((open) => !open)}
      >
        {skillCategoryButtonLabel(locale)}
        <Icon name="chevron-down" size={13} />
      </button>
      {categoryMenuOpen ? (
        <div
          ref={categoryMenuPanelRef}
          className={`recent-projects__filter-menu is-align-${categoryMenuAlign}`}
          role="menu"
          aria-label={skillCategorySelectLabel(locale)}
        >
          {(['all', ...SKILL_CATEGORIES] as SkillCategoryFilter[]).map((category) => (
            <button
              key={category}
              type="button"
              role="menuitemradio"
              aria-checked={activeCategory === category}
              className={activeCategory === category ? 'is-active' : undefined}
              onClick={() => {
                setActiveCategory(category);
                setCategoryMenuOpen(false);
              }}
            >
              {skillCategoryLabel(category, locale)} ({visibleCounts[category]})
            </button>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  const communityControls = showCommunityControls && externalSearchQuery === undefined ? (
    <div className="recent-projects__controls">
      <div className="recent-projects__search">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={`${t('common.search' as any)} Skill`}
          aria-label={`${t('common.search' as any)} Skill`}
        />
        {searchQuery ? (
          <button
            type="button"
            className="recent-projects__search-clear"
            aria-label={t('common.clear' as any)}
            onClick={() => setSearchQuery('')}
          >
            <Icon name="close" size={12} />
          </button>
        ) : null}
      </div>
      {categoryControl}
    </div>
  ) : categoryControl;

  const controlsPortal = communityControls && controlsPortalTarget
    ? createPortal(communityControls, controlsPortalTarget)
    : null;
  const inlineControls = communityControls && !controlsPortalTarget
    ? communityControls
    : fallbackSearchControl;

  if (loading) {
    return (
      <>
        {controlsPortal}
        {inlineControls}
        <div className={styles.cloudSkillLoading}>
          <CenteredLoader label={t('personalScope.cloudSkillLoading' as any)} />
        </div>
      </>
    );
  }

  if (error && visibleSkills.length === 0) {
    return (
      <>
        {controlsPortal}
        {inlineControls}
        <div className={styles.cloudSkillEmpty}>
          <span>{error}</span>
        </div>
      </>
    );
  }

  if (visibleSkills.length === 0) {
    return (
      <>
        {controlsPortal}
        {inlineControls}
        <PageEmptyState />
      </>
    );
  }

  const dialog = confirmAction ? (
    <Dialog
      className="modal-confirm"
      role="alertdialog"
      onClose={() => setConfirmAction(null)}
      closeOnEscape
      ariaLabelledBy={titleId}
    >
      <DialogTitle id={titleId}>
        {confirmAction.type === 'unpublish'
          ? t('squareScope.unpublishConfirmTitle' as any)
          : mode === 'square'
            ? t('squareScope.deleteConfirmTitle' as any)
            : t('personalScope.cloudSkillDeleteConfirmTitle' as any)}
      </DialogTitle>
      <DialogDescription>
        {confirmAction.type === 'unpublish'
           ? (locale.startsWith('zh')
             ? `取消发布后，「${confirmAction.item.title}」将从社区和我的发布中移除。${confirmAction.item.publicationSourceType === 'reference' ? '个人或团队中的源资源保留。' : confirmAction.item.publicationSourceType === 'local_import' ? '本地导入的社区资源将被移除。' : '历史资源的源记录将安全保留。'}如需重新发布请从源路径重新选择。`
             : `Unpublishing removes "${confirmAction.item.title}" from Community and My Publications. The original source, if any, is preserved. To publish again, choose the source again.`)
          : mode === 'square'
            ? t('squareScope.deleteConfirmDesc' as any, { title: confirmAction.item.title })
            : mode === 'team'
              ? (locale.startsWith('zh')
                ? `确定删除团队 Skill「${confirmAction.item.title}」吗？团队成员已有的连接及项目引用可能受到影响。`
                : `Delete team Skill "${confirmAction.item.title}"? Existing connections and project references may stop working.`)
              : t('personalScope.cloudSkillDeleteConfirmDesc' as any)}
      </DialogDescription>
      <DialogFooter className="row">
        <button
          type="button"
          onClick={() => setConfirmAction(null)}
          disabled={!!uninstallingId || !!unpublishingId || !!deletingId}
        >
          {t('common.cancel' as any)}
        </button>
        <button
          type="button"
          className={confirmAction.type === 'delete' ? undefined : 'primary'}
          disabled={!!uninstallingId || !!unpublishingId || !!deletingId}
          onClick={() => {
            if (confirmAction.type === 'unpublish') void handleUnpublish(confirmAction.item);
            else void handleDelete(confirmAction.item);
          }}
        >
          {unpublishingId || deletingId ? <Icon name="spinner" size={14} /> : null}
          {confirmAction.type === 'unpublish'
            ? t('squareScope.unpublish' as any)
            : mode === 'square'
              ? t('common.delete' as any)
              : t('personalScope.cloudSkillDelete' as any)}
        </button>
      </DialogFooter>
    </Dialog>
  ) : null;

  return (
    <>
      {controlsPortal}
      {inlineControls}
      {error ? <div className={styles.cloudSkillError} role="alert">{error}</div> : null}
      <SkillCardGrid progressive={useCommunityCatalog}
        key={JSON.stringify([identityKey, effectiveSearchQuery, activeCategory])}
        skills={visibleSkills} renderSkill={(skill) => {
         const cloudId = skill.provider === 'maas-skillhub' ? `maas-skillhub:${skill.resourceId}` : skill.resourceId;
         const isInstalled = localCloudIds.has(cloudId) || (!useCommunityCatalog && skill.installed === true)
           || skill.teamShared === true
          || (skill.provider !== 'maas-skillhub' && localSkillIds.has(skill.localId.toLowerCase()));
          const canManageCloudRecord = skill.provider !== 'maas-skillhub' && !skill.resourceId.startsWith('team:');
          const isResourceOwner = skill.canManage ?? skill.ownerMemberId === workspaceMemberId;
          const isTeamManager = mode === 'team' && (memberRole === 'owner' || memberRole === 'admin');
          const isTeamNative = (skill.homeWorkspaceId ?? workspaceId) === workspaceId;
          // Team resource deletion is scoped to the team's own cloud record.
          // Linking an external source must never grant permission to erase it.
          const canDelete = canManageCloudRecord && mode !== 'shared' && memberRole !== 'guest'
            && (mode === 'team' ? isTeamNative && (isResourceOwner || isTeamManager) : isResourceOwner);
          // In community/personal/team views only the resource owner can
          // grant new shares. Keep the existing shared-with-me forwarding
          // affordance; HDW still validates every attempted share.
          const canShare = canManageCloudRecord && (isResourceOwner || mode === 'shared' || (mode === 'team' && memberRole != null && memberRole !== 'guest'));
          const showOriginalIcon = Boolean(skill.iconUrl) && !failedIconIds.has(skill.resourceId);
          const meta = mode === 'square'
            ? `${skill.publisherName?.trim() || 'HiDesign'}${skill.updatedAt ? ' · ' + formatRelativeDate(skill.updatedAt, t) : ''}`
            : [
              mode === 'shared' && skill.sharedByDisplayname
                ? t('personalScope.cloudSkillSharedBy' as any, { name: skill.sharedByDisplayname })
                : skill.teamShared ? t('pluginsView.teamSharedBadge' as any) : '',
              skill.publisherName ? t('squareScope.publisher' as any, { name: skill.publisherName }) : '',
              skill.updatedAt ? formatRelativeDate(skill.updatedAt, t) : '',
            ].filter(Boolean).join(' · ');
          return <ResourceCard key={skill.resourceId} kind="skill" title={skill.title}
            icon={showOriginalIcon ? (
              <img className={styles.cardCover} src={skill.iconUrl!} alt="" loading="lazy"
                onError={() => setFailedIconIds((current) => new Set(current).add(skill.resourceId))} />
            ) : isSkillLogoKey(skill.logoKey) ? (
              <SkillLogo logoKey={skill.logoKey} size={48} className={styles.cardCover} />
            ) : <img className={styles.cardCover} src="/community/default-skill-logo.svg" alt="" />}
            meta={meta}
            source={mode === 'square' ? skill.sourceLabel || t('personalScope.cloudSkillSource' as any) : null}
            description={skill.description} installed={isInstalled} installing={installingId === skill.resourceId} uninstalling={uninstallingId === skill.resourceId}
            busy={!!installingId || !!uninstallingId || !!unpublishingId || !!updatingId || !!deletingId}
            onInstall={() => void handleInstall(skill)}
             canConnect={(!useCommunityCatalog || localSkillsReady) && (mode !== 'team' || (memberRole != null && memberRole !== 'guest'))}
            actions={picker ? {} : {
              ...(canShare ? { share: () => setShareItem(skill) } : {}),
              ...(isInstalled && !skill.teamShared ? { uninstall: () => void handleUninstall(skill) } : {}),
              ...(canDelete && mode === 'square' ? { unpublish: () => setConfirmAction({ type: 'unpublish', item: skill }) } : {}),
              ...(canDelete && mode === 'square' && skill.publicationSourceType === 'reference' ? { updatePublication: () => void handleUpdatePublication(skill) } : {}),
              ...(canDelete && mode !== 'square' ? { delete: () => setConfirmAction({ type: 'delete', item: skill }) } : {}),
              ...(mode === 'shared' && skill.shareId ? { removeShare: () => setRemoveShareId(skill.shareId!) } : {}),
            }}
            stats={mode === 'square' ? <CommunityResourceStats
              primaryCount={skill.peopleCount} secondaryCount={skill.actionCount} primaryIcon="users" secondaryIcon="download"
              primaryLabel={locale.startsWith('zh') ? '接入人数' : 'Connected users'}
              secondaryLabel={locale.startsWith('zh') ? '接入次数' : 'Connections'} /> : null}
          />;
        }} />
      {typeof document !== 'undefined' && dialog ? createPortal(dialog, document.body) : dialog}
      {removeShareId ? <RemoveSharedResourceDialog key={removeShareId} shareId={removeShareId} kind="skill"
        resourceName={skills.find((item) => item.shareId === removeShareId)?.title ?? t('feedback.objectSkill')}
        onClose={() => setRemoveShareId(null)}
        onRemoved={() => {
          setSkills((current) => current.filter((item) => item.shareId !== removeShareId));
          setRemoveShareId(null);
        }}
      /> : null}
      {shareItem ? (
        <ShareResourceDialog
          resourceId={shareItem.resourceId}
          kind="skill"
          resourceName={shareItem.title}
          homeWorkspaceId={shareItem.homeWorkspaceId ?? workspaceId ?? ''}
          onClose={() => setShareItem(null)}
        />
      ) : null}
    </>
  );
}
