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
import { CenteredLoader } from './Loading';
import { useI18n, useT } from '../i18n';
import { ShareResourceDialog } from './ShareResourceDialog';
import { ResourceCard } from './ResourceCard';
import { RemoveSharedResourceDialog } from './RemoveSharedResourceDialog';
import { CommunityResourceStats } from './CommunityResourceStats';
import { McpLogo, resolveMcpLogoKey } from './McpLogo';
import type { CloudMcpTemplate } from '@open-design/contracts';
import styles from './CloudSkillList.module.css';
import { communityTextMatchesQuery } from '../utils/community-search';
import { recordCommunityStat } from '../utils/community-stats';

// Extended type that includes shared-with-me fields (only present in shared mode).
interface CloudMcpItem extends CloudMcpTemplate {
  shareId?: string;
  sharedByDisplayname?: string | null;
  homeWorkspaceId?: string;
  teamLocal?: boolean;
  publisherName?: string | null;
  logoKey?: string;
  peopleCount?: number | null;
  actionCount?: number | null;
}

// Catalog and share metadata can carry null or an unvalidated logo field.
// Normalize it at the read boundary; stored items retain the shared contract.
type CloudMcpResponseItem = Omit<CloudMcpItem, 'logoKey'> & { logoKey?: unknown };

function normalizeLogoKey(value: unknown): CloudMcpTemplate['logoKey'] {
  return typeof value === 'string' ? value : undefined;
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
 searchQuery = '',
}: {
 workspaceId: string | null;
 workspaceMemberId: string | null;
 workspaceType: string | null;
 ownerMemberId?: string | null;
 mode?: 'personal' | 'shared' | 'square' | 'team';
 scope?: string;
 searchQuery?: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  const titleId = useId();
  const [templates, setTemplates] = useState<CloudMcpItem[]>([]);
  const [localTemplateIds, setLocalTemplateIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
 const [confirmAction, setConfirmAction] = useState<{ type: 'unpublish' | 'delete'; item: CloudMcpItem } | null>(null);
 const [shareItem, setShareItem] = useState<CloudMcpItem | null>(null);
 const [removeShareId, setRemoveShareId] = useState<string | null>(null);

  const loadLocalServers = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/servers', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
     const ids = new Set<string>(
       ((body.servers ?? []) as Array<{ templateId?: string }>)
         .filter((s) => s.templateId)
         .map((s) => (s.templateId as string).toLowerCase()),
     );
      setLocalTemplateIds(ids);
    } catch {
      // leave the previous set intact
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    // ── Design intent (do not change) ──────────────────────────────
    // Personal MCPs are cloud resources owned by the current user,
    // stored in the shared HDW space — NOT local on-disk files. The
    // personal mode queries /api/workspace/mcp/cloud with an
    // owner_member_id filter so the list reflects what the user
    // published to the cloud, while loadLocalServers() separately
    // tracks which of those are materialized locally (installed).
    // This mirrors CloudSkillList and is the intended architecture.
    // ──────────────────────────────────────────────────────────────
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
          shareId: r.shareId,
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
           logoKey: normalizeLogoKey(r.metadata?.logoKey),
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
     for (const template of (cloudResponse?.templates ?? []) as CloudMcpResponseItem[]) {
       merged.set(template.id.toLowerCase(), { ...template, logoKey: normalizeLogoKey(template.logoKey) });
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
       const existing = merged.get(templateId.toLowerCase());
       // A local connection is installation state, not a surviving team resource.
       if (!existing && cloudResponse) continue;
       merged.set(templateId.toLowerCase(), {
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
    const response = await fetch('/api/workspace/mcp/cloud?' + params, { cache: 'no-store', headers });
    if (!response.ok) throw new Error('Failed to load cloud MCP templates');
    const body = await response.json();
    // Ownership comes from the cloud catalog. Local connections only supply
    // installed state through loadLocalServers; they never add owned records.
    setTemplates(((body.templates ?? []) as CloudMcpResponseItem[]).map((template) => ({
      ...template, logoKey: normalizeLogoKey(template.logoKey),
    })));
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
    const handler = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.source === 'cloud-mcp-list') return;
      void loadTemplates();
      void loadLocalServers();
    };
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
      setLocalTemplateIds((current) => new Set(current).add(tpl.id.toLowerCase()));
      if (mode === 'square' && scope === 'public') {
        const stats = await recordCommunityStat({
          resourceType: 'mcp',
          resourceId: tpl.resourceId,
          metric: 'action',
          workspaceId,
          workspaceMemberId,
          workspaceType,
        });
        if (stats) {
          setTemplates((current) => current.map((item) => (
            item.resourceId === tpl.resourceId
              ? { ...item, peopleCount: stats.actionUserCount, actionCount: stats.actionCount }
              : item
          )));
        }
      }
      // Notify other surfaces (ChatComposer, HomeView, other CloudMcpList
      // instances) that the local MCP installation set changed. The source
      // tag lets our own listener skip the redundant reload.
      window.dispatchEvent(new CustomEvent('personal:mcp-refresh', {
        detail: { source: 'cloud-mcp-list' },
      }));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setInstallingId(null);
    }
  }

 async function handleUninstall(tpl: CloudMcpItem) {
   setUninstallingId(tpl.resourceId);
   setError(null);
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
     setLocalTemplateIds((current) => {
       const next = new Set(current);
       next.delete(tpl.id.toLowerCase());
       return next;
     });
     window.dispatchEvent(new CustomEvent('personal:mcp-refresh', {
        detail: { source: 'cloud-mcp-list' },
      }));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setUninstallingId(null);
    }
  }

  async function handleDelete(tpl: CloudMcpItem) {
    setDeletingId(tpl.resourceId);
    try {
      const res = await fetch(
        '/api/workspace/mcp/cloud/' + encodeURIComponent(tpl.resourceId),
        {
          method: 'DELETE',
          headers: workspaceHeaders(tpl.homeWorkspaceId ?? workspaceId, tpl.homeWorkspaceMemberId ?? workspaceMemberId, tpl.homeWorkspaceType ?? workspaceType),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Delete failed');
      }
      await loadTemplates();
      window.dispatchEvent(new CustomEvent('personal:mcp-refresh', {
        detail: { source: 'cloud-mcp-list' },
      }));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setDeletingId(null);
      setConfirmAction(null);
    }
  }

  async function handleUnpublish(tpl: CloudMcpItem) {
    setUnpublishingId(tpl.resourceId);
    try {
      const res = await fetch(
        '/api/workspace/mcp/cloud/' + encodeURIComponent(tpl.resourceId) + '/unpublish',
        {
          method: 'POST',
          headers: workspaceHeaders(tpl.homeWorkspaceId ?? workspaceId, tpl.homeWorkspaceMemberId ?? workspaceMemberId, tpl.homeWorkspaceType ?? workspaceType),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Unpublish failed');
      }
      await loadTemplates();
      window.dispatchEvent(new CustomEvent('personal:mcp-refresh', {
        detail: { source: 'cloud-mcp-list' },
      }));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setUnpublishingId(null);
      setConfirmAction(null);
    }
  }

  const visibleTemplates = searchQuery.trim()
    ? templates.filter((tpl) => communityTextMatchesQuery([
        tpl.label,
        tpl.id,
        tpl.description,
        tpl.transport,
        tpl.category,
        tpl.command,
        tpl.args?.join(' '),
        tpl.url,
        tpl.homepage,
        tpl.publisherName,
      ], searchQuery))
    : templates;

  if (loading) {
    return (
      <div className={styles.cloudSkillLoading}>
        <CenteredLoader label={t('personalScope.cloudMcpLoading' as any)} />
      </div>
    );
  }

  if (error && templates.length === 0) {
    return (
      <div className={styles.cloudSkillEmpty}>
        <span>{error}</span>
      </div>
    );
  }

  if (visibleTemplates.length === 0) {
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
        {confirmAction.type === 'unpublish'
          ? t('squareScope.unpublishConfirmTitle' as any)
          : mode === 'square'
            ? t('squareScope.deleteConfirmTitle' as any)
            : t('personalScope.cloudMcpDeleteConfirmTitle' as any)}
      </DialogTitle>
      <DialogDescription>
        {confirmAction.type === 'unpublish'
          ? t('squareScope.unpublishConfirmDesc' as any, { title: confirmAction.item.label })
          : mode === 'square'
            ? t('squareScope.deleteConfirmDesc' as any, { title: confirmAction.item.label })
            : t('personalScope.cloudMcpDeleteConfirmDesc' as any)}
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
              : t('personalScope.cloudMcpDelete' as any)}
        </button>
      </DialogFooter>
    </Dialog>
  ) : null;

  return (
    <>
      {error ? <div className={styles.cloudSkillError} role="alert">{error}</div> : null}
      <div className={styles.cloudSkillGrid}>
        {visibleTemplates.map((tpl) => {
          // Case-insensitive match so Memoryxxx and memoryxxx are treated as the same installed server.
          const isInstalled = tpl.teamLocal || localTemplateIds.has(tpl.id.toLowerCase());
          const isResourceOwner = tpl.canManage ?? tpl.ownerMemberId === workspaceMemberId;
          const hasCloudRecord = !tpl.resourceId.startsWith('local:');
          const canDelete = hasCloudRecord && isResourceOwner && mode !== 'shared';
          const canShare = hasCloudRecord && (mode === 'personal' || mode === 'square' || mode === 'shared' || (mode === 'team' && isResourceOwner));
          const logoKey = resolveMcpLogoKey(tpl.logoKey, tpl.id || tpl.label);
          const meta = mode === 'square'
            ? `${tpl.publisherName?.trim() || 'HiDesign'}${tpl.updatedAt ? ' · ' + formatRelativeDate(tpl.updatedAt, t) : ''}`
            : [
              mode === 'shared' && tpl.sharedByDisplayname ? t('personalScope.cloudMcpSharedBy' as any, { name: tpl.sharedByDisplayname })
                : tpl.teamLocal ? t('pluginsView.teamSharedBadge' as any) : t('personalScope.cloudMcpSource' as any),
              tpl.updatedAt ? formatRelativeDate(tpl.updatedAt, t) : '',
            ].filter(Boolean).join(' · ');
          return <ResourceCard key={tpl.resourceId} kind="mcp" title={tpl.label}
            icon={<McpLogo logoKey={logoKey} size={40} />} meta={meta} description={tpl.description}
            installed={!!isInstalled} installing={installingId === tpl.resourceId} uninstalling={uninstallingId === tpl.resourceId}
            busy={!!installingId || !!uninstallingId || !!unpublishingId || !!deletingId}
            onInstall={() => void handleInstall(tpl)}
            actions={{
              ...(canShare ? { share: () => setShareItem(tpl) } : {}),
              ...(isInstalled && !tpl.teamLocal ? { uninstall: () => void handleUninstall(tpl) } : {}),
              ...(canDelete && mode === 'square' ? { unpublish: () => setConfirmAction({ type: 'unpublish', item: tpl }) } : {}),
              ...(canDelete ? { delete: () => setConfirmAction({ type: 'delete', item: tpl }) } : {}),
              ...(mode === 'shared' && tpl.shareId ? { removeShare: () => setRemoveShareId(tpl.shareId!) } : {}),
            }}
            stats={mode === 'square' ? <CommunityResourceStats
              primaryCount={tpl.peopleCount} secondaryCount={tpl.actionCount} primaryIcon="users" secondaryIcon="link"
              primaryLabel={locale.startsWith('zh') ? '接入人数' : 'Connected users'}
              secondaryLabel={locale.startsWith('zh') ? '接入次数' : 'Connections'} /> : null}
          />;
        })}
      </div>
      {typeof document !== 'undefined' && dialog ? createPortal(dialog, document.body) : dialog}
      {removeShareId ? <RemoveSharedResourceDialog key={removeShareId} shareId={removeShareId} kind="mcp"
        onClose={() => setRemoveShareId(null)}
        onRemoved={() => {
          setTemplates((current) => current.filter((item) => item.shareId !== removeShareId));
          setRemoveShareId(null);
        }}
      /> : null}
      {shareItem ? (
        <ShareResourceDialog
          resourceId={shareItem.resourceId}
          kind="mcp"
          resourceName={shareItem.label}
          homeWorkspaceId={shareItem.homeWorkspaceId ?? workspaceId ?? ''}
          onClose={() => setShareItem(null)}
        />
      ) : null}
    </>
  );
}
