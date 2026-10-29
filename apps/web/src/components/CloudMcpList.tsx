import { responseError, userFacingError } from '../utils/userFacingError';
import { PageEmptyState } from './PageEmptyState';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  publicationSourceType?: 'reference' | 'local_import' | 'legacy';
  communitySourceResourceId?: string | null;
}

// Catalog and share metadata can carry null or an unvalidated logo field.
// Normalize it at the read boundary; stored items retain the shared contract.
type CloudMcpResponseItem = Omit<CloudMcpItem, 'logoKey'> & { logoKey?: unknown };

function normalizeLogoKey(value: unknown): CloudMcpTemplate['logoKey'] {
  return typeof value === 'string' ? value : undefined;
}

// A connected cloud MCP is identified by its source workspace + resource ID,
// not by its template slug, which may be shared by multiple resources.
function cloudInstallKey(homeWorkspaceId: string | null | undefined, resourceId: string): string {
  return JSON.stringify([homeWorkspaceId || '', resourceId]);
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
 memberRole,
 scope,
 searchQuery = '',
 picker = false,
 onBusyChange,
}: {
 workspaceId: string | null;
 workspaceMemberId: string | null;
 workspaceType: string | null;
 ownerMemberId?: string | null;
 mode?: 'personal' | 'shared' | 'square' | 'team';
 memberRole?: 'owner' | 'admin' | 'member' | 'guest';
 scope?: string;
 searchQuery?: string;
 picker?: boolean;
 onBusyChange?: (busy: boolean) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const titleId = useId();
  const [templates, setTemplates] = useState<CloudMcpItem[]>([]);
  const [localTemplateIds, setLocalTemplateIds] = useState<Set<string>>(new Set());
  const localReadGeneration = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
 const [confirmAction, setConfirmAction] = useState<{ type: 'unpublish' | 'delete'; item: CloudMcpItem } | null>(null);
 const [shareItem, setShareItem] = useState<CloudMcpItem | null>(null);
 const [removeShareId, setRemoveShareId] = useState<string | null>(null);

 useEffect(() => {
   onBusyChange?.(installingId !== null);
 }, [installingId, onBusyChange]);

  const loadLocalServers = useCallback(async () => {
    const generation = ++localReadGeneration.current;
    try {
      const res = await fetch('/api/mcp/servers', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
     const ids = new Set<string>(
       ((body.servers ?? []) as Array<{ cloudResourceId?: string; cloudHomeWorkspaceId?: string; workspaceId?: string; ownerMemberId?: string }>)
         .filter((s) => s.cloudResourceId && s.workspaceId === workspaceId && s.ownerMemberId === workspaceMemberId)
         .map((s) => cloudInstallKey(s.cloudHomeWorkspaceId, s.cloudResourceId!)),
     );
      // Ignore reads begun before a confirmed connection mutation.
      if (generation === localReadGeneration.current) setLocalTemplateIds(ids);
    } catch {
      // leave the previous set intact
    }
  }, [workspaceId, workspaceMemberId]);

  const applyConnectionState = useCallback((key: string, connected: boolean) => {
    ++localReadGeneration.current;
    setLocalTemplateIds((current) => {
      const next = new Set(current);
      if (connected) next.add(key);
      else next.delete(key);
      return next;
    });
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
        if (!res.ok) { throw await responseError(res); }
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
        setError(userFacingError(err, t, 'feedback.loadMcpFailed', t('feedback.objectMcp')));
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
      if (!cloudResponse && !localResponse) {
        if (cloudResult.status === 'fulfilled') throw await responseError(cloudResult.value);
        throw cloudResult.reason;
      }

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
          // Cloud-catalog entries remain disconnectable. Only a local-only
          // fallback is read-only; an installed cloud entry is not.
          teamLocal: !existing,
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
    if (!response.ok) throw await responseError(response);
    const body = await response.json();
    // Ownership comes from the cloud catalog. Local connections only supply
    // installed state through loadLocalServers; they never add owned records.
    setTemplates(((body.templates ?? []) as CloudMcpResponseItem[]).map((template) => ({
      ...template, logoKey: normalizeLogoKey(template.logoKey),
    })));
  } catch (err: any) {
     setError(userFacingError(err, t, 'feedback.loadMcpFailed', t('feedback.objectMcp')));
   } finally {
     setLoading(false);
   }
 }, [workspaceId, workspaceMemberId, workspaceType, ownerMemberId, mode, scope]);

 useEffect(() => {
   void Promise.all([loadTemplates(), loadLocalServers()]);
  }, [loadTemplates, loadLocalServers]);

  useEffect(() => {
    const handler = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.source === 'cloud-mcp-list') {
        if (event.detail.instanceId === titleId) return;
        if (event.detail.action === 'install' || event.detail.action === 'uninstall') {
          if (event.detail.workspaceId === workspaceId && event.detail.workspaceMemberId === workspaceMemberId) {
            applyConnectionState(event.detail.installKey, event.detail.action === 'install');
          }
          return;
        }
      }
      void loadTemplates();
      void loadLocalServers();
    };
    window.addEventListener('personal:mcp-refresh', handler);
    return () => window.removeEventListener('personal:mcp-refresh', handler);
  }, [titleId, workspaceId, workspaceMemberId, applyConnectionState, loadTemplates, loadLocalServers]);

  async function handleInstall(tpl: CloudMcpItem) {
    setInstallingId(tpl.resourceId);
    setError(null);
    try {
      const installUrl = '/api/workspace/mcp/cloud/' + encodeURIComponent(tpl.resourceId) + '/install'
        + (tpl.homeWorkspaceId ? '?home_workspace_id=' + encodeURIComponent(tpl.homeWorkspaceId) : '');
      const res = await fetch(installUrl, {
        method: 'POST',
        headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
      });
      if (!res.ok) {
        throw await responseError(res);
      }
      const installKey = cloudInstallKey(tpl.homeWorkspaceId || workspaceId, tpl.resourceId);
      applyConnectionState(installKey, true);
      window.dispatchEvent(new CustomEvent('personal:mcp-refresh', {
        detail: { source: 'cloud-mcp-list', instanceId: titleId, action: 'install', installKey, workspaceId, workspaceMemberId },
      }));
      if (mode === 'square' && scope === 'public') {
        // Metrics are best-effort and must not hold the button in a busy state.
        void recordCommunityStat({
          resourceType: 'mcp',
          resourceId: tpl.resourceId,
          metric: 'action',
          workspaceId,
          workspaceMemberId,
          workspaceType,
        }).then((stats) => {
          if (stats) {
            setTemplates((current) => current.map((item) => (
              item.resourceId === tpl.resourceId
                ? { ...item, peopleCount: stats.actionUserCount, actionCount: stats.actionCount }
                : item
            )));
          }
        });
      }
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.connectFailed', t('feedback.objectMcp')));
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
         throw await responseError(res);
       }
     const installKey = cloudInstallKey(tpl.homeWorkspaceId || workspaceId, tpl.resourceId);
     applyConnectionState(installKey, false);
     window.dispatchEvent(new CustomEvent('personal:mcp-refresh', {
        detail: { source: 'cloud-mcp-list', instanceId: titleId, action: 'uninstall', installKey, workspaceId, workspaceMemberId },
      }));
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.disconnectFailed', t('feedback.objectMcp')));
    } finally {
      setUninstallingId(null);
    }
  }

  async function handleDelete(tpl: CloudMcpItem) {
    setDeletingId(tpl.resourceId);
    try {
      const res = await fetch(
        '/api/workspace/mcp/cloud/' + encodeURIComponent(tpl.resourceId) + (mode === 'square' ? '?community=1' : ''),
        {
          method: 'DELETE',
           // Team deletion never targets the home workspace of an external link.
           headers: mode === 'team'
             ? workspaceHeaders(workspaceId, workspaceMemberId, workspaceType)
             : workspaceHeaders(tpl.homeWorkspaceId ?? workspaceId, tpl.homeWorkspaceMemberId ?? workspaceMemberId, tpl.homeWorkspaceType ?? workspaceType),
        },
      );
      if (!res.ok) {
        throw await responseError(res);
      }
      await loadTemplates();
      window.dispatchEvent(new CustomEvent('personal:mcp-refresh', {
        detail: { source: 'cloud-mcp-list', instanceId: titleId },
      }));
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.deleteFailed', t('feedback.objectMcp')));
    } finally {
      setDeletingId(null);
      setConfirmAction(null);
    }
  }


  async function handleUpdatePublication(tpl: CloudMcpItem) {
    setUpdatingId(tpl.resourceId);
    setError(null);
    try {
      const res = await fetch('/api/workspace/mcp/cloud/' + encodeURIComponent(tpl.resourceId) + '/update-publication', {
        method: 'POST',
        headers: workspaceHeaders(tpl.homeWorkspaceId ?? workspaceId,
          tpl.homeWorkspaceMemberId ?? workspaceMemberId, tpl.homeWorkspaceType ?? workspaceType),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || 'Update publication failed');
      }
      await loadTemplates();
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.updatePublicationFailed', t('feedback.objectMcp')));
    } finally {
      setUpdatingId(null);
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
        throw await responseError(res);
      }
      await loadTemplates();
      window.dispatchEvent(new CustomEvent('personal:mcp-refresh', {
        detail: { source: 'cloud-mcp-list', instanceId: titleId },
      }));
    } catch (err: any) {
      setError(userFacingError(err, t, 'feedback.unpublishFailed', t('feedback.objectMcp')));
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
           ? (locale.startsWith('zh')
             ? `取消发布后，「${confirmAction.item.label}」将从社区和我的发布中移除。${confirmAction.item.publicationSourceType === 'reference' || confirmAction.item.communitySourceResourceId ? '个人或团队中的源资源保留。' : confirmAction.item.publicationSourceType === 'local_import' ? '本地导入的社区资源将被移除。' : '历史资源的源记录将安全保留。'}如需重新发布请从源路径重新选择。`
             : `Unpublishing removes "${confirmAction.item.label}" from Community and My Publications. Existing local connections remain. To publish again, choose the source again.`)
          : mode === 'square'
            ? t('squareScope.deleteConfirmDesc' as any, { title: confirmAction.item.label })
            : mode === 'team'
              ? (locale.startsWith('zh')
                ? `确定删除团队 MCP「${confirmAction.item.label}」吗？团队成员已有的连接及项目引用可能受到影响。`
                : `Delete team MCP "${confirmAction.item.label}"? Existing connections and project references may stop working.`)
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
          // Cloud identity includes the source workspace; equal slugs can belong to different users.
          const isInstalled = tpl.teamLocal || localTemplateIds.has(cloudInstallKey(tpl.homeWorkspaceId || workspaceId, tpl.resourceId));
          const isResourceOwner = tpl.canManage ?? tpl.ownerMemberId === workspaceMemberId;
          const hasCloudRecord = !tpl.resourceId.startsWith('local:');
          const isTeamManager = mode === 'team' && (memberRole === 'owner' || memberRole === 'admin');
          const isTeamNative = (tpl.homeWorkspaceId ?? workspaceId) === workspaceId;
          const canDelete = hasCloudRecord && mode !== 'shared' && memberRole !== 'guest'
            && (mode === 'team' ? isTeamNative && (isResourceOwner || isTeamManager) : isResourceOwner);
          // Public cards are discoverable by everyone, but only the cloud
          // owner may share them. Preserve the existing shared-with-me
          // forwarding entry; the server remains authoritative for grants.
          const canShare = hasCloudRecord && (isResourceOwner || mode === 'shared' || (mode === 'team' && memberRole != null && memberRole !== 'guest'));
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
            busy={!!installingId || !!uninstallingId || !!unpublishingId || !!updatingId || !!deletingId}
            onInstall={() => void handleInstall(tpl)}
             canConnect={mode !== 'team' || (memberRole != null && memberRole !== 'guest')}
            actions={picker ? {} : {
              ...(canShare ? { share: () => setShareItem(tpl) } : {}),
              ...(isInstalled && !tpl.teamLocal ? { uninstall: () => void handleUninstall(tpl) } : {}),
              ...(canDelete && mode === 'square' ? { unpublish: () => setConfirmAction({ type: 'unpublish', item: tpl }) } : {}),
              ...(canDelete && mode === 'square' && (tpl.publicationSourceType === 'reference' || !!tpl.communitySourceResourceId) ? { updatePublication: () => void handleUpdatePublication(tpl) } : {}),
              ...(canDelete && mode !== 'square' ? { delete: () => setConfirmAction({ type: 'delete', item: tpl }) } : {}),
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
        resourceName={templates.find((item) => item.shareId === removeShareId)?.label ?? t('feedback.objectMcp')}
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
