import { PageEmptyState } from './PageEmptyState';
import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@open-design/components';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { ShareResourceDialog } from './ShareResourceDialog';
import styles from './CloudSkillList.module.css';

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
installed?: boolean;
teamShared?: boolean;
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
}: {
 workspaceId: string | null;
 workspaceMemberId: string | null;
 workspaceType: string | null;
 ownerMemberId?: string | null;
 sourceProvider?: string | null;
 mode?: 'personal' | 'shared' | 'square' | 'team';
 scope?: string;
}) {
  const t = useT();
  const titleId = useId();
  const [skills, setSkills] = useState<CloudSkill[]>([]);
  const [localSkillIds, setLocalSkillIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [failedIconIds, setFailedIconIds] = useState<Set<string>>(new Set());
 const [confirmAction, setConfirmAction] = useState<{ type: 'uninstall' | 'delete'; item: CloudSkill } | null>(null);
 const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
 const [shareItem, setShareItem] = useState<CloudSkill | null>(null);

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
        ((body.skills ?? []) as Array<{ id: string }>).map((s) => s.id),
      );
      setLocalSkillIds(ids);
    } catch {
      // leave the previous set intact
    }
  }, [workspaceId, workspaceMemberId, workspaceType]);

  const loadSkills = useCallback(async () => {
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
        }));
        setSkills(list);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!workspaceId) { setSkills([]); setLoading(false); return; }
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
        merged.set(skill.localId, skill);
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
        });
      }
      setSkills([...merged.values()]);
      return;
    }
    if (mode === 'personal') {
      // Personal mode: show locally installed skills from /api/skills.
      // No cloud round-trip - the skills directory is the source of truth.
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      const res = await fetch('/api/skills', { cache: 'no-store', headers });
      if (!res.ok) { throw new Error('Failed to load skills'); }
      const body = await res.json();
      const list: CloudSkill[] = ((body.skills ?? []) as Array<{
        id: string; name: string; description: string;
        source: string; ownerMemberId?: string; workspaceId?: string;
      }>).filter((s) => s.source === 'user').map((s) => ({
        resourceId: `local:${s.id}`,
        localId: s.id,
        title: s.name,
        description: s.description ?? null,
        ownerMemberId: s.ownerMemberId ?? '',
        version: null,
        versionId: null,
        createdAt: '',
        updatedAt: '',
        provider: 'local',
        sourceLabel: 'Local',
        installed: true,
      }));
      setSkills(list);
    } else {
      const params = new URLSearchParams();
      const ownerFilter = ownerMemberId ?? null;
      if (ownerFilter) params.set('owner_member_id', ownerFilter);
      if (scope) params.set('scope', scope);
      if (sourceProvider) params.set('source', sourceProvider);
      if (debouncedSearch) params.set('q', debouncedSearch);
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      const res = await fetch('/api/workspace/skills/cloud?' + params, {
        cache: 'no-store',
        headers,
      });
      if (!res.ok) { throw new Error('Failed to load cloud skills'); }
      const body = await res.json();
      setSkills(body.skills ?? []);
    }
    } catch (err: any) {
     setError(err?.message ?? String(err));
   } finally {
     setLoading(false);
   }
}, [workspaceId, workspaceMemberId, workspaceType, ownerMemberId, mode, scope, sourceProvider, debouncedSearch]);

useEffect(() => {
  const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250);
  return () => window.clearTimeout(timer);
}, [searchQuery]);

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
      setLocalSkillIds((current) => new Set(current).add(installedLocalId));
      setSkills((current) => current.map((item) => (
        item.resourceId === skill.resourceId
          ? { ...item, localId: installedLocalId, installed: true }
          : item
      )));
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
      if (skill.provider === 'local') {
        const res = await fetch(
          '/api/skills/' + encodeURIComponent(skill.localId),
          { method: 'DELETE', headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType) },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? 'Uninstall failed');
        }
      } else {
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
      }
      setLocalSkillIds((current) => {
        const next = new Set(current);
        next.delete(skill.localId);
        return next;
      });
      setSkills((current) => current.map((item) => (
        item.resourceId === skill.resourceId ? { ...item, installed: false } : item
      )));
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
      await loadSkills();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setDeletingId(null);
      setConfirmAction(null);
      setMenuOpenId(null);
    }
  }

  const searchControl = sourceProvider === 'maas-skillhub' || sourceProvider === 'all' ? (
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

  if (loading) {
    return <>{searchControl}<div className={styles.cloudSkillLoading}>{t('personalScope.cloudSkillLoading' as any)}</div></>;
  }

  if (error && skills.length === 0) {
    return (
      <>
        {searchControl}
        <div className={styles.cloudSkillEmpty}>
          <span>{error}</span>
        </div>
      </>
    );
  }

  if (skills.length === 0) {
    return (
      <>
        {searchControl}
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
      {searchControl}
      {error ? <div className={styles.cloudSkillError} role="alert">{error}</div> : null}
      <div className={styles.cloudSkillGrid}>
        {skills.map((skill) => {
          const isInstalled = skill.installed === true
            || skill.teamShared === true
            || (skill.provider !== 'maas-skillhub' && localSkillIds.has(skill.localId));
          const canManageCloudRecord = skill.provider !== 'maas-skillhub' && skill.provider !== 'local' && !skill.teamShared;
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
                  ) : (
                  <svg viewBox="0 0 1024 1024" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
                    <path d="M512 512m-512 0a512 512 0 1 0 1024 0 512 512 0 1 0-1024 0Z" fill="#324A5E" />
                    <path d="M1019.28 581.532l-118.888-118.888-33.306 34.322-120.47-120.47-57.634-13.904-66.488 42.564 101.456 101.456-79.342 0.7L380.68 243.382l-51.132 6.868-29.864 72.932 185.54 185.54L113.778 512l240.344 240.344-69.676 44.1L512 1024c259.182 0 473.35-192.594 507.28-442.468z" fill="#2B3B4E" />
                    <path d="M880.77 568.888H227.556v-113.778h653.216c16.264 0 29.452 13.184 29.452 29.452v54.878c-0.002 16.264-13.19 29.448-29.454 29.448z" fill="#EAA22F" />
                    <path d="M227.556 511.138v57.75h653.216c16.264 0 29.452-13.184 29.452-29.452v-28.3H227.556z" fill="#E09112" />
                    <path d="M227.556 455.112h605.678v113.778H227.556z" fill="#31BAFD" />
                    <path d="M227.556 512h605.678v56.888H227.556z" fill="#2B9ED8" />
                    <path d="M227.556 455.112L113.778 512l113.778 56.888z" fill="#FEE187" />
                    <path d="M115.502 511.138l-1.724 0.862 113.778 56.888v-57.75z" fill="#FFC61B" />
                    <path d="M113.778 512l53.154 26.576v-53.152z" fill="#59595B" />
                    <path d="M115.502 511.138l-1.724 0.862 53.154 26.576v-27.438z" fill="#272525" />
                    <path d="M341.334 284.444m-56.888 0a56.888 56.888 0 1 0 113.776 0 56.888 56.888 0 1 0-113.776 0Z" fill="#FFFFFF" />
                    <path d="M341.334 227.556c-0.386 0-0.762 0.052-1.148 0.058v113.66c0.382 0.006 0.758 0.058 1.148 0.058 31.42 0 56.888-25.468 56.888-56.888s-25.472-56.888-56.888-56.888z" fill="#D0D1D3" />
                    <path d="M284.444 625.778h170.666v170.666h-170.666z" fill="#FFC61B" />
                    <path d="M368.64 625.778h86.472v170.666H368.64z" fill="#EAA22F" />
                    <path d="M622.498 405.156l37.244-121.822 86.878 93.164z" fill="#FFFFFF" />
                    <path d="M659.742 283.334l-0.296 0.97 28.002 105.858 59.172-13.664z" fill="#D0D1D3" />
                  </svg>
                  )}
                </span>
                <div className={styles.cardHeaderInfo}>
                  <strong className={styles.cardTitle}>{skill.title}</strong>
                 <small className={styles.cardMeta}>
                   {skill.teamShared
                     ? t('pluginsView.teamSharedBadge' as any)
                     : mode === 'shared' && skill.sharedByDisplayname
                     ? t('personalScope.cloudSkillSharedBy' as any, { name: skill.sharedByDisplayname })
                     : skill.sourceLabel || t('personalScope.cloudSkillSource' as any)}
                   {skill.publisherName
                     ? ' \u00b7 ' + t('squareScope.publisher' as any, { name: skill.publisherName })
                     : ''}
                   {skill.updatedAt ? ' \u00b7 ' + formatRelativeDate(skill.updatedAt, t) : ''}
                 </small>
               </div>
            {((canManageCloudRecord && (mode === 'personal' || mode === 'square')) || (isInstalled && !skill.teamShared)) ? (
               <>
                  <button
                    type="button"
                    className={styles.cardMenuBtn}
                    title=""
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === skill.resourceId ? null : skill.resourceId);
                    }}
                  >
                    <Icon name="more-horizontal" size={16} />
                  </button>
                  {menuOpenId === skill.resourceId ? (
                    <>
                      <div className={styles.cardMenuBackdrop} onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); }} />
                      <div className={styles.cardMenu}>
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
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
              {skill.description
                ? <p className={styles.cardDesc}>{skill.description}</p>
                : null}
              {mode !== 'shared' ? (
                <footer className={`community-template-card__foot ${styles.resourceCardFooter}`}>
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
