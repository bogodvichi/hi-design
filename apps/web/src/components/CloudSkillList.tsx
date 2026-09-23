import { PageEmptyState } from './PageEmptyState';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@open-design/components';
import { Icon } from './Icon';
import { useI18n, useT } from '../i18n';
import { ShareResourceDialog } from './ShareResourceDialog';
import { CommunityResourceStats } from './CommunityResourceStats';
import styles from './CloudSkillList.module.css';
import {
  SKILL_CATEGORIES,
  emptySkillCategoryCounts,
  normalizeSkillCategory,
  type SkillCategory,
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
import { isSkillLogoKey, SkillLogo } from './SkillLogo';

interface CloudSkill {
  resourceId: string;
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
homeWorkspaceId?: string;
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
}

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

export function CloudSkillList({
 workspaceId,
 workspaceMemberId,
 workspaceType,
 ownerMemberId,
 sourceProvider,
 mode = 'personal',
 scope,
 controlsPortalTarget,
 externalSearchQuery,
}: {
 workspaceId: string | null;
 workspaceMemberId: string | null;
 workspaceType: string | null;
 ownerMemberId?: string | null;
 sourceProvider?: string | null;
 mode?: 'personal' | 'shared' | 'square' | 'team';
 scope?: string;
 controlsPortalTarget?: HTMLElement | null;
 externalSearchQuery?: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  const titleId = useId();
  const [skills, setSkills] = useState<CloudSkill[]>([]);
  const [localSkillIds, setLocalSkillIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const effectiveSearchQuery = externalSearchQuery ?? searchQuery;
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<SkillCategoryFilter>('all');
  const [categoryCounts, setCategoryCounts] = useState<SkillCategoryCounts>(() => emptySkillCategoryCounts());
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [categoryMenuAlign, setCategoryMenuAlign] = useState<'start' | 'end'>('start');
  const [failedIconIds, setFailedIconIds] = useState<Set<string>>(new Set());
 const [confirmAction, setConfirmAction] = useState<{ type: 'uninstall' | 'delete'; item: CloudSkill } | null>(null);
 const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
 const [shareItem, setShareItem] = useState<CloudSkill | null>(null);
 const showCommunityControls = mode === 'square' && sourceProvider === 'all';
 const categoryMenuRef = useRef<HTMLDivElement | null>(null);
 const categoryMenuPanelRef = useRef<HTMLDivElement | null>(null);
 const menuRef = useRef<HTMLDivElement>(null);
 const menuTriggerRef = useRef<HTMLButtonElement>(null);

 useEffect(() => {
   if (!menuOpenId) return;
   const closeOutside = (event: PointerEvent) => {
     if (event.target instanceof Node
       && (menuRef.current?.contains(event.target) || menuTriggerRef.current?.contains(event.target))) {
       return;
     }
     setMenuOpenId(null);
   };
   document.addEventListener('pointerdown', closeOutside, { capture: true });
   return () => document.removeEventListener('pointerdown', closeOutside, { capture: true });
 }, [menuOpenId]);

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
   if (!workspaceId) { setLocalSkillIds(new Set()); return; }
   try {
     const res = await fetch('/api/skills', {
       cache: 'no-store',
       headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
     });
     if (!res.ok) return;
  const body = await res.json();
  const ids = new Set<string>(
    ((body.skills ?? []) as Array<{ id: string }>).map((s) => s.id.toLowerCase()),
  );
  setLocalSkillIds(ids);
    } catch {
      // leave the previous set intact
    }
  }, [workspaceId, workspaceMemberId, workspaceType]);

  const loadSkills = useCallback(async () => {
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
        if (!res.ok) { throw new Error('Failed to load shared skills'); }
        const body = await res.json();
        const list: CloudSkill[] = (body.resources ?? []).map((r: any) => ({
          resourceId: r.resourceId,
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
        }));
        setSkills(list);
        setCategoryCounts(countCategories(list));
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        setLoading(false);
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
      if (!cloudResponse && !teamResponse) throw new Error('Failed to load team skills');

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
      if (debouncedSearch) params.set('q', debouncedSearch);
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      const res = await fetch('/api/workspace/skills/cloud?' + params, {
        cache: 'no-store',
        headers,
      });
      if (!res.ok) { throw new Error('Failed to load cloud skills'); }
      const body = await res.json();
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
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (showCommunityControls && activeCategory !== 'all') params.set('category', activeCategory);
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      const res = await fetch('/api/workspace/skills/cloud?' + params, {
        cache: 'no-store',
        headers,
      });
      if (!res.ok) { throw new Error('Failed to load cloud skills'); }
      const body = await res.json();
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
     setError(err?.message ?? String(err));
   } finally {
     setLoading(false);
   }
 }, [workspaceId, workspaceMemberId, workspaceType, ownerMemberId, mode, scope, sourceProvider, debouncedSearch, showCommunityControls, activeCategory, countCategories]);

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
  void Promise.all([loadSkills(), loadLocalSkills()]);
}, [loadSkills, loadLocalSkills]);

 useEffect(() => {
   const handler = (event: Event) => {
     if (event instanceof CustomEvent && event.detail?.source === 'cloud-skill-list') return;
     void loadSkills();
     void loadLocalSkills();
   };
    window.addEventListener('personal:skill-refresh', handler);
    return () => window.removeEventListener('personal:skill-refresh', handler);
  }, [loadSkills, loadLocalSkills]);

  async function handleInstall(skill: CloudSkill) {
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
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? body?.error ?? 'Install failed');
      }
      const body = await res.json() as { localId?: string };
      const installedLocalId = body.localId || skill.localId;
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
        detail: { source: 'cloud-skill-list' },
      }));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setInstallingId(null);
    }
  }

  async function handleUninstall(skill: CloudSkill) {
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
        const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? body?.error ?? 'Uninstall failed');
      }
      // Actively refresh list data from server after uninstall
      await Promise.all([loadSkills(), loadLocalSkills()]);
      window.dispatchEvent(new CustomEvent('personal:skill-refresh', {
        detail: { source: 'cloud-skill-list' },
      }));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setUninstallingId(null);
      setConfirmAction(null);
      setMenuOpenId(null);
    }
  }

  async function handleDelete(skill: CloudSkill) {
    setDeletingId(skill.resourceId);
    try {
      const res = await fetch(
        '/api/workspace/skills/cloud/' + encodeURIComponent(skill.resourceId),
        {
          method: 'DELETE',
          headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Delete failed');
      }
      // Actively refresh both cloud list and local installed set after delete
      await Promise.all([loadSkills(), loadLocalSkills()]);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setDeletingId(null);
      setConfirmAction(null);
      setMenuOpenId(null);
    }
  }

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
              {skillCategoryLabel(category, locale)} ({categoryCounts[category]})
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
    return <>{controlsPortal}{inlineControls}<div className={styles.cloudSkillLoading}>{t('personalScope.cloudSkillLoading' as any)}</div></>;
  }

  if (error && skills.length === 0) {
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

  if (skills.length === 0) {
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
        {confirmAction.type === 'uninstall'
          ? t('personalScope.cloudSkillUninstallConfirmTitle' as any)
          : t('personalScope.cloudSkillDeleteConfirmTitle' as any)}
      </DialogTitle>
      <DialogDescription>
        {confirmAction.type === 'uninstall'
          ? t('personalScope.cloudSkillUninstallConfirmDesc' as any)
          : t('personalScope.cloudSkillDeleteConfirmDesc' as any)}
      </DialogDescription>
      <DialogFooter className="row">
        <button
          type="button"
          onClick={() => setConfirmAction(null)}
          disabled={confirmAction.type === 'uninstall' ? !!uninstallingId : !!deletingId}
        >
          {t('common.cancel' as any)}
        </button>
        <button
          type="button"
          className="primary"
          disabled={confirmAction.type === 'uninstall' ? !!uninstallingId : !!deletingId}
          onClick={() => {
            if (confirmAction.type === 'uninstall') void handleUninstall(confirmAction.item);
            else void handleDelete(confirmAction.item);
          }}
        >
          {confirmAction.type === 'uninstall'
            ? (uninstallingId ? <Icon name="spinner" size={14} /> : null)
            : (deletingId ? <Icon name="spinner" size={14} /> : null)}
          {confirmAction.type === 'uninstall'
            ? t('personalScope.cloudSkillUninstall' as any)
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
      <div className={styles.cloudSkillGrid}>
        {skills.map((skill) => {
         const isInstalled = skill.installed === true
           || skill.teamShared === true
          || (skill.provider !== 'maas-skillhub' && localSkillIds.has(skill.localId.toLowerCase()));
          const canManageCloudRecord = skill.provider !== 'maas-skillhub' && !skill.teamShared;
          const isInstalling = installingId === skill.resourceId;
          const isUninstalling = uninstallingId === skill.resourceId;
          const isDeleting = deletingId === skill.resourceId;
          const showOriginalIcon = Boolean(skill.iconUrl) && !failedIconIds.has(skill.resourceId);
          return (
            <article key={skill.resourceId} className={styles.teamAssetCard} role="button" tabIndex={0}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIcon} aria-hidden>
                  {showOriginalIcon ? (
                    <img
                      className={styles.cardCover}
                      src={skill.iconUrl!}
                      alt=""
                      loading="lazy"
                      onError={() => setFailedIconIds((current) => (
                        new Set(current).add(skill.resourceId)
                      ))}
                    />
                  ) : isSkillLogoKey(skill.logoKey) ? (
                    <SkillLogo
                      logoKey={skill.logoKey}
                      size={48}
                      className={styles.cardCover}
                    />
                  ) : (
                    <img
                      className={styles.cardCover}
                      src="/community/default-skill-logo.svg"
                      alt=""
                    />
                  )}
                </span>
                <div className={styles.cardHeaderInfo}>
                  <strong className={styles.cardTitle}>{skill.title}</strong>
                 {mode === 'square' ? (
                   <>
                     <small className={`${styles.cardMeta} ${styles.cardAuthorLine}`}>
                       {skill.publisherName?.trim() || 'HiDesign'}
                       {skill.updatedAt ? ' · ' + formatRelativeDate(skill.updatedAt, t) : ''}
                     </small>
                     <small className={`${styles.cardMeta} ${styles.cardSourceLine}`}>
                       {skill.sourceLabel || t('personalScope.cloudSkillSource' as any)}
                     </small>
                   </>
                ) : (
                  <small className={styles.cardMeta}>
                    {(() => {
                      const parts: string[] = [];
                      if (skill.teamShared) {
                        parts.push(t('pluginsView.teamSharedBadge' as any));
                      } else if (mode === 'shared' && skill.sharedByDisplayname) {
                        parts.push(t('personalScope.cloudSkillSharedBy' as any, { name: skill.sharedByDisplayname }));
                      }
                      if (skill.publisherName) {
                        parts.push(t('squareScope.publisher' as any, { name: skill.publisherName }));
                      }
                      if (skill.updatedAt) {
                        parts.push(formatRelativeDate(skill.updatedAt, t));
                      }
                      return parts.join(' · ');
                    })()}
                  </small>
                )}
               </div>
            {((canManageCloudRecord && (mode === 'personal' || mode === 'square')) || (isInstalled && !skill.teamShared)) ? (
               <>
                  <button
                    type="button"
                    className={styles.cardMenuBtn}
                    ref={menuOpenId === skill.resourceId ? menuTriggerRef : undefined}
                    title=""
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === skill.resourceId ? null : skill.resourceId);
                    }}
                  >
                    <Icon name="more-horizontal" size={16} />
                  </button>
                  {menuOpenId === skill.resourceId ? (
                      <div className={styles.cardMenu} ref={menuRef}>
                       {canManageCloudRecord && (mode === 'personal' || mode === 'square') ? (
                          <button
                            type="button"
                            className={styles.cardMenuItem}
                            onClick={(e) => { e.stopPropagation(); setShareItem(skill); setMenuOpenId(null); }}
                          >
                            <Icon name="share" size={14} />
                            {t('personalScope.cloudSkillShare' as any)}
                          </button>
                        ) : null}
                        {isInstalled ? (
                          <button
                            type="button"
                            className={styles.cardMenuItem}
                            disabled={isUninstalling}
                            onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'uninstall', item: skill }); }}
                          >
                            <Icon name="trash" size={14} />
                            {t('personalScope.cloudSkillUninstall' as any)}
                          </button>
                        ) : null}
                       {canManageCloudRecord && (mode === 'personal' || (mode === 'square' && skill.ownerMemberId === workspaceMemberId)) ? (
                          <button
                            type="button"
                            className={styles.cardMenuItemDanger}
                            disabled={isDeleting}
                            onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', item: skill }); }}
                          >
                            <Icon name="close" size={14} />
                            {t('personalScope.cloudSkillDelete' as any)}
                          </button>
                        ) : null}
                      </div>
                  ) : null}
                </>
              ) : null}
            </div>
              {skill.description
                ? <p className={`${styles.cardDesc}${mode === 'square' ? ` ${styles.squareCardDesc}` : ''}`}>{skill.description}</p>
                : null}
              {mode !== 'shared' ? (
                <footer className={`community-template-card__foot ${styles.resourceCardFooter}`}>
                  {mode === 'square' ? (
                    <CommunityResourceStats
                      primaryCount={skill.peopleCount}
                      secondaryCount={skill.actionCount}
                      primaryIcon="users"
                      secondaryIcon="download"
                      primaryLabel={locale.startsWith('zh') ? '接入人数' : 'Connected users'}
                      secondaryLabel={locale.startsWith('zh') ? '接入次数' : 'Connections'}
                    />
                  ) : null}
                  <div className="community-template-card__actions">
                    <button
                      type="button"
                      disabled={isInstalled || isInstalling}
                      onClick={() => void handleInstall(skill)}
                    >
                      <Icon name={isInstalled ? 'check' : isInstalling ? 'spinner' : 'plus'} size={14} aria-hidden />
                      {isInstalled
                        ? t('personalScope.cloudSkillInstalled' as any)
                        : isInstalling
                          ? t('personalScope.cloudSkillInstalling' as any)
                          : t('personalScope.cloudSkillAdd' as any)}
                    </button>
                  </div>
                </footer>
              ) : isInstalled ? (
                <div className={styles.cardActions}>
                  <span className={styles.capabilityComplete}>
                    <Icon name="check" size={14} />
                    {t('personalScope.cloudSkillInstalled' as any)}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.capabilityAdd}
                  disabled={isInstalling}
                  onClick={() => void handleInstall(skill)}
                >
                  {isInstalling
                    ? <Icon name="spinner" size={14} />
                    : <Icon name="plus" size={14} />}
                  {isInstalling
                    ? t('personalScope.cloudSkillInstalling' as any)
                    : t('personalScope.cloudSkillAdd' as any)}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {typeof document !== 'undefined' && dialog ? createPortal(dialog, document.body) : dialog}
      {shareItem ? (
        <ShareResourceDialog
          resourceId={shareItem.resourceId}
          kind="skill"
          resourceName={shareItem.title}
          homeWorkspaceId={workspaceId ?? ''}
          onClose={() => setShareItem(null)}
        />
      ) : null}
    </>
  );
}
