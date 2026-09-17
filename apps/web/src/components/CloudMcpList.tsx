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
import type { CloudMcpTemplate } from '@open-design/contracts';
import styles from './CloudSkillList.module.css';

// Extended type that includes shared-with-me fields (only present in shared mode).
interface CloudMcpItem extends CloudMcpTemplate {
  sharedByDisplayname?: string | null;
  homeWorkspaceId?: string;
  teamLocal?: boolean;
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
  if (days <= 0) return t('personalScope.cloudMcpUpdatedToday');
  if (days === 1) return t('personalScope.cloudMcpUpdatedYesterday');
  return t('personalScope.cloudMcpUpdatedDaysAgo', { n: days });
}

export function CloudMcpList({
 workspaceId,
 workspaceMemberId,
 workspaceType,
 ownerMemberId,
 mode = 'personal',
 scope,
}: {
 workspaceId: string | null;
 workspaceMemberId: string | null;
 workspaceType: string | null;
 ownerMemberId?: string | null;
 mode?: 'personal' | 'shared' | 'square' | 'team';
 scope?: string;
}) {
  const t = useT();
  const titleId = useId();
  const [templates, setTemplates] = useState<CloudMcpItem[]>([]);
  const [localTemplateIds, setLocalTemplateIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
 const [confirmAction, setConfirmAction] = useState<{ type: 'uninstall' | 'delete'; item: CloudMcpItem } | null>(null);
 const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
 const [shareItem, setShareItem] = useState<CloudMcpItem | null>(null);

  const loadLocalServers = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/servers', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      const ids = new Set<string>(
        ((body.servers ?? []) as Array<{ templateId?: string }>)
          .filter((s) => s.templateId)
          .map((s) => s.templateId as string),
      );
      setLocalTemplateIds(ids);
    } catch {
      // leave the previous set intact
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    if (mode === 'shared') {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/resource-share/shared-with-me?kind=mcp', { cache: 'no-store' });
        if (!res.ok) { throw new Error('Failed to load shared MCP templates'); }
        const body = await res.json();
        const list: CloudMcpItem[] = (body.resources ?? []).map((r: any) => ({
          id: r.metadata?.id ?? r.resourceId,
          resourceId: r.resourceId,
          label: r.metadata?.label ?? r.resourceId,
          description: r.metadata?.description ?? '',
          transport: r.metadata?.transport ?? 'stdio',
          category: r.metadata?.category ?? 'utilities',
          command: r.metadata?.command,
          args: r.metadata?.args,
          envFields: r.metadata?.envFields,
          url: r.metadata?.url,
          headerFields: r.metadata?.headerFields,
          authMode: r.metadata?.authMode,
          homepage: r.metadata?.homepage,
          example: r.metadata?.example,
          ownerMemberId: r.ownerMemberId ?? '',
          version: null,
          versionId: null,
          createdAt: r.createdAt ?? '',
          updatedAt: r.updatedAt ?? '',
          sharedByDisplayname: r.sharedByDisplayname ?? null,
          homeWorkspaceId: r.homeWorkspaceId ?? '',
        }));
        setTemplates(list);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!workspaceId) { setTemplates([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
    if (mode === 'team') {
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      const [cloudResult, localResult] = await Promise.allSettled([
        fetch('/api/workspace/mcp/cloud?', { cache: 'no-store', headers }),
        fetch('/api/mcp/servers', { cache: 'no-store' }),
      ]);
      const cloudResponse = cloudResult.status === 'fulfilled' && cloudResult.value.ok
        ? await cloudResult.value.json()
        : null;
      const localResponse = localResult.status === 'fulfilled' && localResult.value.ok
        ? await localResult.value.json()
        : null;
      if (!cloudResponse && !localResponse) throw new Error('Failed to load team MCP templates');

      const merged = new Map<string, CloudMcpItem>();
      for (const template of (cloudResponse?.templates ?? []) as CloudMcpItem[]) {
        merged.set(template.id, template);
      }
      for (const server of (localResponse?.servers ?? []) as Array<{
        id: string;
        label?: string;
        templateId?: string;
        workspaceId?: string;
        ownerMemberId?: string;
        transport: 'stdio' | 'sse' | 'http';
        command?: string;
        args?: string[];
        url?: string;
        authMode?: 'none' | 'oauth';
      }>) {
        if (server.workspaceId !== workspaceId) continue;
        const templateId = server.templateId ?? server.id;
        const existing = merged.get(templateId);
        merged.set(templateId, {
          id: templateId,
          resourceId: existing?.resourceId ?? `local:${server.id}`,
          label: existing?.label ?? server.label ?? server.id,
          description: existing?.description ?? '',
          transport: existing?.transport ?? server.transport,
          category: existing?.category ?? 'utilities',
          command: existing?.command ?? server.command,
          args: existing?.args ?? server.args,
          url: existing?.url ?? server.url,
          authMode: existing?.authMode ?? server.authMode,
          ownerMemberId: existing?.ownerMemberId ?? server.ownerMemberId ?? '',
          version: existing?.version ?? null,
          versionId: existing?.versionId ?? null,
          createdAt: existing?.createdAt ?? '',
          updatedAt: existing?.updatedAt ?? '',
          ...existing,
          teamLocal: true,
        });
      }
      setTemplates([...merged.values()]);
      return;
    }
    const params = new URLSearchParams();
    // ownerMemberId controls the owner filter; when null, all public
    // resources are returned (community browse). workspaceMemberId is
    // still sent in the workspace headers for auth and delete checks.
    const ownerFilter = ownerMemberId ?? (mode === 'personal' ? workspaceMemberId : null);
    if (ownerFilter) params.set('owner_member_id', ownerFilter);
    if (scope) params.set('scope', scope);
     const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
     const res = await fetch('/api/workspace/mcp/cloud?' + params, {
       cache: 'no-store',
       headers,
     });
     if (!res.ok) { throw new Error('Failed to load cloud MCP templates'); }
     const body = await res.json();
     setTemplates(body.templates ?? []);
   } catch (err: any) {
     setError(err?.message ?? String(err));
   } finally {
     setLoading(false);
   }
 }, [workspaceId, workspaceMemberId, workspaceType, ownerMemberId, mode, scope]);

 useEffect(() => {
   void Promise.all([loadTemplates(), loadLocalServers()]);
  }, [loadTemplates, loadLocalServers]);

  useEffect(() => {
    const handler = () => { void loadTemplates(); void loadLocalServers(); };
    window.addEventListener('personal:mcp-refresh', handler);
    return () => window.removeEventListener('personal:mcp-refresh', handler);
  }, [loadTemplates, loadLocalServers]);

  async function handleInstall(tpl: CloudMcpItem) {
    setInstallingId(tpl.resourceId);
    try {
      const installUrl = '/api/workspace/mcp/cloud/' + encodeURIComponent(tpl.resourceId) + '/install'
        + (tpl.homeWorkspaceId ? '?home_workspace_id=' + encodeURIComponent(tpl.homeWorkspaceId) : '');
      const res = await fetch(installUrl, {
        method: 'POST',
        headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Install failed');
      }
      await loadLocalServers();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setInstallingId(null);
    }
  }

  async function handleUninstall(tpl: CloudMcpItem) {
    setUninstallingId(tpl.resourceId);
    try {
      const uninstallUrl = '/api/workspace/mcp/cloud/' + encodeURIComponent(tpl.resourceId) + '/uninstall'
        + (tpl.homeWorkspaceId ? '?home_workspace_id=' + encodeURIComponent(tpl.homeWorkspaceId) : '');
      const res = await fetch(uninstallUrl, {
        method: 'DELETE',
        headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Uninstall failed');
      }
      await loadLocalServers();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setUninstallingId(null);
      setConfirmAction(null);
      setMenuOpenId(null);
    }
  }

  async function handleDelete(tpl: CloudMcpItem) {
    setDeletingId(tpl.resourceId);
    try {
      const res = await fetch(
        '/api/workspace/mcp/cloud/' + encodeURIComponent(tpl.resourceId),
        {
          method: 'DELETE',
          headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Delete failed');
      }
      await loadTemplates();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setDeletingId(null);
      setConfirmAction(null);
      setMenuOpenId(null);
    }
  }

  if (loading) {
    return <div className={styles.cloudSkillLoading}>{t('personalScope.cloudMcpLoading' as any)}</div>;
  }

  if (error && templates.length === 0) {
    return (
      <div className={styles.cloudSkillEmpty}>
        <span>{error}</span>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <PageEmptyState />
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
          ? t('personalScope.cloudMcpUninstallConfirmTitle' as any)
          : t('personalScope.cloudMcpDeleteConfirmTitle' as any)}
      </DialogTitle>
      <DialogDescription>
        {confirmAction.type === 'uninstall'
          ? t('personalScope.cloudMcpUninstallConfirmDesc' as any)
          : t('personalScope.cloudMcpDeleteConfirmDesc' as any)}
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
            ? t('personalScope.cloudMcpUninstall' as any)
            : t('personalScope.cloudMcpDelete' as any)}
        </button>
      </DialogFooter>
    </Dialog>
  ) : null;

  return (
    <>
      <div className={styles.cloudSkillGrid}>
        {templates.map((tpl) => {
          const isInstalled = tpl.teamLocal || localTemplateIds.has(tpl.id);
          const isInstalling = installingId === tpl.resourceId;
          const isUninstalling = uninstallingId === tpl.resourceId;
          const isDeleting = deletingId === tpl.resourceId;
          return (
            <article key={tpl.resourceId} className={styles.teamAssetCard} role="button" tabIndex={0}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIcon} aria-hidden>
                  <Icon name="terminal" size={32} />
                </span>
                <div className={styles.cardHeaderInfo}>
                  <strong className={styles.cardTitle}>{tpl.label}</strong>
                 <small className={styles.cardMeta}>
                   {tpl.teamLocal
                     ? t('pluginsView.teamSharedBadge' as any)
                     : mode === 'shared' && tpl.sharedByDisplayname
                     ? t('personalScope.cloudMcpSharedBy' as any, { name: tpl.sharedByDisplayname })
                     : t('personalScope.cloudMcpSource' as any)}
                   {tpl.updatedAt ? ' \u00b7 ' + formatRelativeDate(tpl.updatedAt, t) : ''}
                 </small>
               </div>
              {(mode === 'personal' || mode === 'square' || (isInstalled && !tpl.teamLocal)) ? (
                <>
                  <button
                    type="button"
                    className={styles.cardMenuBtn}
                    title=""
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === tpl.resourceId ? null : tpl.resourceId);
                    }}
                  >
                    <Icon name="more-horizontal" size={16} />
                  </button>
                  {menuOpenId === tpl.resourceId ? (
                    <>
                      <div className={styles.cardMenuBackdrop} onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); }} />
                      <div className={styles.cardMenu}>
                          {(mode === 'personal' || mode === 'square') ? (
                            <button
                              type="button"
                              className={styles.cardMenuItem}
                              onClick={(e) => { e.stopPropagation(); setShareItem(tpl); setMenuOpenId(null); }}
                            >
                              <Icon name="share" size={14} />
                              {t('personalScope.cloudMcpShare' as any)}
                            </button>
                          ) : null}
                          {isInstalled ? (
                            <button
                              type="button"
                              className={styles.cardMenuItem}
                              disabled={isUninstalling}
                              onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'uninstall', item: tpl }); }}
                            >
                              <Icon name="trash" size={14} />
                              {t('personalScope.cloudMcpUninstall' as any)}
                            </button>
                          ) : null}
                          {(mode === 'personal' || (mode === 'square' && tpl.ownerMemberId === workspaceMemberId)) ? (
                            <button
                              type="button"
                              className={styles.cardMenuItemDanger}
                              disabled={isDeleting}
                              onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', item: tpl }); }}
                            >
                              <Icon name="close" size={14} />
                              {t('personalScope.cloudMcpDelete' as any)}
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : null}
             </div>
              {tpl.description
                ? <p className={styles.cardDesc}>{tpl.description}</p>
                : null}
              {mode !== 'shared' ? (
                <footer className={`community-template-card__foot ${styles.resourceCardFooter}`}>
                  <div className="community-template-card__actions">
                    <button
                      type="button"
                      disabled={isInstalled || isInstalling}
                      onClick={() => void handleInstall(tpl)}
                    >
                      <Icon name={isInstalled ? 'check' : isInstalling ? 'spinner' : 'plus'} size={14} aria-hidden />
                      {isInstalled
                        ? t('personalScope.cloudMcpInstalled' as any)
                        : isInstalling
                          ? t('personalScope.cloudMcpInstalling' as any)
                          : t('personalScope.cloudMcpAdd' as any)}
                    </button>
                  </div>
                </footer>
              ) : isInstalled ? (
                <div className={styles.cardActions}>
                  <span className={styles.capabilityComplete}>
                    <Icon name="check" size={14} />
                    {t('personalScope.cloudMcpInstalled' as any)}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.capabilityAdd}
                  disabled={isInstalling}
                  onClick={() => void handleInstall(tpl)}
                >
                  {isInstalling
                    ? <Icon name="spinner" size={14} />
                    : <Icon name="plus" size={14} />}
                  {isInstalling
                    ? t('personalScope.cloudMcpInstalling' as any)
                    : t('personalScope.cloudMcpAdd' as any)}
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
          kind="mcp"
          resourceName={shareItem.label}
          homeWorkspaceId={workspaceId ?? ''}
          onClose={() => setShareItem(null)}
        />
      ) : null}
    </>
  );
}
