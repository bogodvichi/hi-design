import { PageEmptyState } from './PageEmptyState';
import { ModuleBreadcrumb } from './ModuleBreadcrumb';
// Hi广场 — community plaza surface.
//
// Reached from the nav rail's "Hi广场" item under Community. Mirrors
// PersonalAllView's layout (header + subtitle + type tabs + content
// panel) and reuses TeamSpaceView.module.css so the surface stays
// visually consistent across scope pages. Tabs: 项目 / Skill / MCP / 工具.

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@open-design/components';
import { PreviewModal } from './PreviewModal';
import { PublishDialog, type PublishProjectSelection } from './PublishDialog';
import type { PublishToolSelection } from './PublishDialog';
import type { PublishMcpSelection } from './PublishDialog';
import type { PublishSkillSelection } from './PublishDialog';
import { CloudSkillList } from './CloudSkillList';
import { CloudMcpList } from './CloudMcpList';
import { CloudToolList } from './CloudToolList';
import { CommunityResourceStats } from './CommunityResourceStats';
import { Toast } from './Toast';
import { communityOriginProjectId, communityOriginProjectName, projectFallbackVisual } from './project-cover';
import type { MarketplacePluginEntry, ProjectPublishCommunityResponse } from '@open-design/contracts';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { Icon, type IconName } from './Icon';
import { useI18n, useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { navigate } from '../router';
import { getProject, remixHdwPlugin } from '../state/projects';
import { uploadSkillToCloud, type ProjectFilePreview } from '../providers/registry';
import {
  recordRecentlyOpenedProject,
  updateRecentlyOpenedProjectCover,
} from '../lib/recently-opened-projects';
import { getSharedSpaceMemberId } from '../utils/deterministicId';
import { getStoredUsername } from '../auth/auth';
import { communityTextMatchesQuery } from '../utils/community-search';
import { ellipsisTitleHoverProps } from '../utils/ellipsis-title';
import { recordCommunityStat } from '../utils/community-stats';
import { renderMarkdownToSafeHtml } from '../artifacts/markdown';
import {
  createCommunityReferenceHandoff,
  stashHomePromptHandoff,
} from './home-hero/plugin-authoring';
import styles from './TeamSpaceView.module.css';
import publishStyles from './MyPublishes.module.css';

export type ProjectPublicationStatus = 'published' | 'unpublished';
/** Frontend view model; the owner-list adapter will supply unpublished records. */
export interface PublishedProjectItem {
  entry: MarketplacePluginEntry;
  publicationStatus: ProjectPublicationStatus;
}
type PublicationFilter = 'all' | ProjectPublicationStatus;

type ProjectPublicationAction = 'publish' | 'unpublish' | 'delete';

type MarketplacePluginEntryWithDeletion = MarketplacePluginEntry & {
  deletedAt?: string | null;
};

interface PendingPublishedProject {
  name: string;
  version: string;
  title: string;
}

type SquareTab = 'projects' | 'skill' | 'mcp' | 'tool';

interface TabDef {
  id: SquareTab;
  icon: IconName;
  labelKey: keyof Dict;
}

const TABS: TabDef[] = [
  { id: 'projects', icon: 'folder', labelKey: 'squareScope.tabProjects' },
  { id: 'skill', icon: 'sparkles', labelKey: 'squareScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'squareScope.tabMcp' },
  { id: 'tool', icon: 'puzzle', labelKey: 'squareScope.tabTool' },
];
const COMMUNITY_SKILL_PROVIDERS = 'all';
const PUBLISHED_PROJECT_REFRESH_DELAYS_MS = [0, 400, 800, 1600, 3200] as const;
async function publishResponseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as unknown;
  const record = body && typeof body === 'object'
    ? body as Record<string, unknown>
    : null;
  const topLevelMessage = typeof record?.message === 'string'
    ? record.message.trim()
    : '';
  const rawError = record?.error;

  let errorMessage = '';
  let errorCode = '';
  if (typeof rawError === 'string') {
    errorMessage = rawError.trim();
  } else if (rawError && typeof rawError === 'object') {
    const errorRecord = rawError as Record<string, unknown>;
    if (typeof errorRecord.message === 'string') errorMessage = errorRecord.message.trim();
    if (typeof errorRecord.code === 'string') errorCode = errorRecord.code.trim();
  }

  if (
    fallback === 'Project publish failed'
    && response.status === 404
    && (errorCode === 'FILE_NOT_FOUND' || /file not found|enoent|no such file/i.test(errorMessage))
  ) {
    return new Error('项目暂无可发布内容，请先完成项目内容后再发布。');
  }

  return new Error(
    topLevelMessage
    || errorMessage
    || errorCode
    || `${fallback} (HTTP ${response.status})`,
  );
}

function marketplaceMetric(entry: MarketplacePluginEntry, ...keys: string[]): number | null {
  const record = entry as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function marketplaceUpdatedAt(entry: MarketplacePluginEntry): string | null {
  const record = entry as unknown as Record<string, unknown>;
  for (const key of ['updatedAt', 'updated_at', 'publishedAt', 'published_at']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function formatCommunityDate(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (locale.startsWith('zh')) {
    if (days <= 0) return '今天更新';
    if (days === 1) return '昨天更新';
    if (days < 30) return `${days}天前更新`;
  }
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  return `${Math.max(1, days)}d ago`;
}

function PlaceholderPanel({ icon, label, note }: { icon: IconName; label: string; note: string }) {
  return (
    <div className={styles.panel}>
      <span className={styles.panelIcon} aria-hidden>
        <Icon name={icon} size={32} />
      </span>
      <h2 className={styles.panelTitle}>{label}</h2>
      <p className={styles.panelNote}>{note}</p>
    </div>
  );
}

function ProjectCardMenu({ publicationStatus, onPublish, onUnpublish, onDelete, busy }: {
  publicationStatus?: ProjectPublicationStatus;
  onPublish?: () => void;
  onUnpublish?: () => void;
  onDelete?: () => void;
  busy?: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside, { capture: true });
    return () => document.removeEventListener('pointerdown', closeOutside, { capture: true });
  }, [open]);

  return (
    <div className="recent-projects__card-menu-anchor" ref={containerRef}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
        if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          const items = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? items.length - 1 : index - 1;
          items[(next + items.length) % items.length]?.focus();
        }
      }}>
      <button type="button" className="recent-projects__card-more" ref={triggerRef}
        aria-label={t('designs.menuMore')} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <Icon name="more-horizontal" size={14} aria-hidden />
      </button>
      {open ? (
        <div className="recent-projects__card-menu" role="menu">
          {publicationStatus === 'unpublished' ? (
            <>
              <button type="button" role="menuitem" disabled={!!busy} onClick={() => { setOpen(false); onPublish?.(); }}>
                <Icon name="arrow-up" size={12} aria-hidden /><span>{t('pluginCard.publish')}</span>
              </button>
              <button type="button" role="menuitem" disabled={!!busy} onClick={() => { setOpen(false); onDelete?.(); }}>
                <Icon name="close" size={12} aria-hidden /><span>{t('common.delete')}</span>
              </button>
            </>
          ) : (
            <>
              {publicationStatus === 'published' ? (
                <>
                  <button type="button" role="menuitem" disabled={!!busy} onClick={() => { setOpen(false); onUnpublish?.(); }}>
                    <Icon name="eye-off" size={12} aria-hidden /><span>{t('squareScope.unpublish')}</span>
                  </button>
                  <button type="button" role="menuitem" disabled={!!busy} onClick={() => { setOpen(false); onDelete?.(); }}>
                    <Icon name="close" size={12} aria-hidden /><span>{t('common.delete')}</span>
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Reuse the project type selector's visual contract for publication status.
function PublicationStatusFilter({ value, onChange }: {
  value: PublicationFilter;
  onChange: (value: PublicationFilter) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const options: { value: PublicationFilter; label: string }[] = [
    { value: 'all', label: t('common.all') },
    { value: 'published', label: t('squareScope.published') },
    { value: 'unpublished', label: t('squareScope.unpublished') },
  ];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside, true);
    return () => document.removeEventListener('pointerdown', closeOutside, true);
  }, [open]);

  return (
    <div className={publishStyles.filter} ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) { setOpen(true); return; }
          const items = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? items.length - 1 : index - 1;
          items[(next + items.length) % items.length]?.focus();
        }
      }}>
      <div className="recent-projects__filter-wrap">
        <button type="button" className="recent-projects__filter" ref={triggerRef}
          aria-label={`${t('squareScope.publicationFilter')}：${options.find((option) => option.value === value)?.label}`}
          aria-haspopup="menu" aria-expanded={open}
          onClick={() => setOpen((current) => !current)}>
          {value === 'all' ? t('squareScope.publicationFilter') : options.find((option) => option.value === value)?.label}
          <Icon name="chevron-down" size={13} aria-hidden />
        </button>
        {open ? (
          <div className={`recent-projects__filter-menu ${publishStyles.filterMenu}`} role="menu" aria-label={t('squareScope.publicationFilter')}>
            {options.map((option) => (
              <button type="button" key={option.value} role="menuitemradio" aria-checked={value === option.value}
                className={value === option.value ? 'is-active' : undefined}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProjectsPanel({ refreshKey, onRefresh, username, isMyPublishes, publicationFilter, projectItems, workspaceMemberId, statsWorkspaceId, statsWorkspaceMemberId, statsWorkspaceType, searchQuery = '', pendingPublishedProject, onPendingPublishedProjectVisible }: {
  refreshKey: number;
  onRefresh: () => void;
  username?: string | null;
  isMyPublishes: boolean;
  publicationFilter: PublicationFilter;
  projectItems?: readonly PublishedProjectItem[];
  workspaceMemberId?: string | null;
  statsWorkspaceId?: string | null;
  statsWorkspaceMemberId?: string | null;
  statsWorkspaceType?: string | null;
  searchQuery?: string;
  pendingPublishedProject?: PendingPublishedProject | null;
  onPendingPublishedProjectVisible?: (project: PendingPublishedProject) => void;
}) {
 const t = useT();
 const { locale } = useI18n();
 const [plugins, setPlugins] = useState<MarketplacePluginEntry[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(false);
 const [remixingName, setRemixingName] = useState<string | null>(null);
  const [remixError, setRemixError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailsEntry, setDetailsEntry] = useState<MarketplacePluginEntry | null>(null);
  const [shareOnOpen, setShareOnOpen] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: ProjectPublicationAction;
    name: string;
    title: string;
  } | null>(null);
  const confirmTitleId = useId();
  // Synchronous rapid-click guard: state writes are not synchronous, so a
  // burst of clicks before React re-renders all read the stale
  // `remixingName` and fire N duplicate POST /remix calls. The ref is
  // written the instant the first click is accepted, so every click in the
  // same burst sees the lock immediately. Cleared on success/failure or by
  // the timeout fallback so a card can never get stuck disabled forever.
  const remixingNameRef = useRef<string | null>(null);
  const skipPendingClearRefreshRef = useRef(false);
  useEffect(() => {
    if (!remixingName) return;
    const timer = window.setTimeout(() => {
      remixingNameRef.current = null;
      setRemixingName(null);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [remixingName]);

  useEffect(() => {
    if (skipPendingClearRefreshRef.current && !pendingPublishedProject) {
      skipPendingClearRefreshRef.current = false;
      return;
    }
    let cancelled = false;
    let retryTimer: number | null = null;
    setLoading(true);
    setError(false);
    const url = isMyPublishes && username
      ? `/api/marketplaces/hdw-community/plugins?username=${encodeURIComponent(username)}`
      : '/api/marketplaces/hdw-community/plugins';
    const retryDelays = pendingPublishedProject
      ? PUBLISHED_PROJECT_REFRESH_DELAYS_MS
      : [0] as const;

    void (async () => {
      for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        const delay = retryDelays[attempt] ?? 0;
        if (delay > 0) {
          await new Promise<void>((resolve) => {
            retryTimer = window.setTimeout(resolve, delay);
          });
        }
        if (cancelled) return;
        try {
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) throw new Error('fetch failed');
          const body = await response.json() as { plugins?: MarketplacePluginEntry[] };
          if (cancelled) return;
          const all = body.plugins ?? [];
          setPlugins(all);
          setLoading(false);
          setError(false);

          if (!pendingPublishedProject) return;
          const isVisible = all.some((entry) => (
            entry.name === pendingPublishedProject.name
            && entry.version === pendingPublishedProject.version
          ));
          if (isVisible) {
            if (onPendingPublishedProjectVisible) {
              skipPendingClearRefreshRef.current = true;
              onPendingPublishedProjectVisible(pendingPublishedProject);
            }
            return;
          }
        } catch {
          if (cancelled) return;
          if (attempt === retryDelays.length - 1) {
            setError(true);
            setLoading(false);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
 }, [isMyPublishes, onPendingPublishedProjectVisible, pendingPublishedProject, refreshKey, username]);

  function handleReference(entry: MarketplacePluginEntry) {
    const prompt = String(entry.prompt ?? entry.description ?? '');
    const title = String(entry.title ?? entry.name);
    stashHomePromptHandoff(createCommunityReferenceHandoff(Date.now(), prompt, title));
    navigate({ kind: 'home', view: 'home' });
  }

  async function recordProjectStat(entry: MarketplacePluginEntry, metric: 'preview' | 'action') {
    if (isMyPublishes) return;
    const stats = await recordCommunityStat({
      resourceType: 'project',
      resourceId: entry.name,
      metric,
      workspaceId: statsWorkspaceId ?? null,
      workspaceMemberId: statsWorkspaceMemberId ?? null,
      workspaceType: statsWorkspaceType ?? null,
    });
    if (!stats) return;
    setPlugins((current) => current.map((item) => (
      item.name === entry.name
        ? { ...item, previewUserCount: stats.previewUserCount, actionCount: stats.actionCount }
        : item
    )));
  }

  async function handleRemix(entry: MarketplacePluginEntry) {
    if (remixingNameRef.current) return;
    remixingNameRef.current = entry.name;
    setRemixingName(entry.name);
    setRemixError(null);
    const result = await remixHdwPlugin(entry.name);
    remixingNameRef.current = null;
    setRemixingName(null);
    if (result.ok && result.projectId) {
      void recordProjectStat(entry, 'action');
      if (result.project) {
        recordRecentlyOpenedProject({
          ...result.project,
          createdByWorkspaceMemberId: workspaceMemberId,
          workspaceVisibility: 'personal',
        });
        void (async () => {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const fresh = await getProject(result.projectId!);
            if (fresh?.coverDigest) {
              updateRecentlyOpenedProjectCover(result.projectId!, fresh.coverDigest);
              return;
            }
          }
        })();
      }
      navigate({
        kind: 'project',
        projectId: result.projectId,
        conversationId: result.conversationId ?? null,
        fileName: null,
      });
    } else {
      setRemixError(result.message ?? t('squareScope.remixFailed'));
    }
  }

  async function unpublishPlugin(name: string) {
    setBusyName(name);
    try {
      const res = await fetch(`/api/marketplaces/hdw-community/plugins/${encodeURIComponent(name)}/unpublish`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('unpublish failed', body);
      }
      onRefresh();
    } finally {
      setBusyName(null);
    }
  }

  async function publishPlugin(name: string) {
    setBusyName(name);
    try {
      const res = await fetch(`/api/marketplaces/hdw-community/plugins/${encodeURIComponent(name)}/publish`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('publish failed', body);
      }
      onRefresh();
    } finally {
      setBusyName(null);
    }
  }

  async function deletePlugin(name: string) {
    setBusyName(name);
    setActionError(null);
    try {
      const res = await fetch(`/api/marketplaces/hdw-community/plugins/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        const raw = body?.message || body?.error || '';
        const message =
          raw === 'plugin not found in marketplace'
            ? (locale.startsWith('zh') ? '删除失败：刚发布的数据尚未同步完成，请稍后再试。' : 'Delete failed: the newly published item is still syncing. Please try again.')
            : raw === 'SSO session is required to delete a community plugin'
              ? (locale.startsWith('zh') ? '删除失败：登录状态已失效，请重新登录后再试。' : 'Delete failed: your sign-in session has expired. Please sign in again.')
              : raw === 'not authorized to delete this plugin'
                ? (locale.startsWith('zh') ? '删除失败：只能删除自己发布的项目。' : 'Delete failed: you can only delete projects you published.')
                : (locale.startsWith('zh') ? '删除失败，请稍后重试。' : 'Delete failed. Please try again.');
        setActionError(message);
        return;
      }
      onRefresh();
    } catch {
      setActionError(locale.startsWith('zh') ? '删除失败，请检查网络后重试。' : 'Delete failed. Check your network and try again.');
    } finally {
      setBusyName(null);
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingDot} />
        <span className={styles.loadingDot} />
        <span className={styles.loadingDot} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.pluginCardError}>
        {t('squareScope.loadFailed')}
        <br />
        <button
          type="button"
          className={styles.pluginCardRetry}
          onClick={onRefresh}
        >
          <Icon name="refresh" size={14} />
          {t('preview.retry')}
        </button>
      </div>
    );
  }

  // The existing marketplace contains published entries only. Do not infer
  // unpublished records or persist simulated publication state in the browser.
  const items: readonly PublishedProjectItem[] = isMyPublishes && projectItems
    ? projectItems
    : plugins.map((entry) => ({
        entry,
        publicationStatus: (isMyPublishes && typeof (entry as MarketplacePluginEntryWithDeletion).deletedAt === 'string')
          ? 'unpublished'
          : 'published',
      }));
  const visibleItems = isMyPublishes && publicationFilter !== 'all'
    ? items.filter((item) => item.publicationStatus === publicationFilter)
    : items;
  const searchedItems = searchQuery.trim()
    ? visibleItems.filter(({ entry }) => communityTextMatchesQuery([
        entry.title,
        entry.name,
        entry.description,
        entry.prompt,
        entry.publisher?.displayName,
        entry.publisher?.github,
        entry.publisher?.id,
      ], searchQuery))
    : visibleItems;

  if (searchedItems.length === 0) {
    return <PageEmptyState />;
  }

  return (
    <>
      <div className="recent-projects__row recent-projects__row--grid" data-testid="square-projects-grid">
      {searchedItems.map(({ entry, publicationStatus }) => {
        const title = entry.title ?? entry.name;
        const publisherName = [entry.publisher?.displayName, entry.publisher?.github, entry.publisher?.id]
          .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
          ?.trim() ?? 'HiDesign';
        const updatedAt = marketplaceUpdatedAt(entry);
        const previewPeople = marketplaceMetric(entry, 'previewUserCount');
        const reuseCount = marketplaceMetric(entry, 'reuseCount', 'remixCount', 'actionCount');
        const rawEntry = entry as unknown as Record<string, unknown>;
        const originProjectId = communityOriginProjectId(rawEntry.tags) ?? entry.name;
        const originProjectName = communityOriginProjectName(rawEntry.tags) ?? title;
        const fallbackCover = projectFallbackVisual(originProjectId, originProjectName);
        const isRemixing = remixingName === entry.name;
        const isOwner = isMyPublishes
          ? true
          : typeof entry.publisher?.id === 'string' && entry.publisher.id === username;
        return (
          <div
            key={entry.name}
            role="listitem"
            className={`recent-projects__card ${publishStyles.communityProjectCard}`}
            data-plugin-name={entry.name}
          >
            <button
              type="button"
              className="recent-projects__card-main"
              onClick={() => {
                setShareOnOpen(false);
                setDetailsEntry(entry);
                void recordProjectStat(entry, 'preview');
              }}
            >
              <div
                className={`recent-projects__card-thumb ${entry.coverUrl ? 'recent-projects__card-thumb-image' : 'recent-projects__card-thumb-fallback'}`}
                style={!entry.coverUrl ? fallbackCover.style : undefined}
                aria-hidden
              >
                {entry.coverUrl ? (
                  <img
                    className="recent-projects__thumb-media"
                    src={entry.coverUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="recent-projects__card-glyph">{fallbackCover.initial}</span>
                )}
              </div>
              <div className="recent-projects__card-meta">
                <div className="recent-projects__card-name-row">
                  <span
                    className="recent-projects__card-name"
                    {...ellipsisTitleHoverProps(title)}
                  >
                    {title}
                  </span>
                </div>
                <div className="recent-projects__card-footer">
                  <div className="recent-projects__card-time">
                    <span
                      className="recent-projects__card-owner"
                      style={{ backgroundColor: '#000' }}
                      title={publisherName}
                      aria-hidden
                    >
                      {publisherName}
                    </span>
                    {updatedAt ? (
                      <>
                        <span className="recent-projects__card-sep" aria-hidden>·</span>
                        {formatCommunityDate(updatedAt, locale)}
                      </>
                    ) : null}
                  </div>
                  <CommunityResourceStats
                    primaryCount={previewPeople}
                    secondaryCount={reuseCount}
                    primaryIcon="eye"
                    secondaryIcon="copy"
                    primaryLabel={locale.startsWith('zh') ? '预览人数' : 'Preview users'}
                    secondaryLabel={locale.startsWith('zh') ? '复用次数' : 'Reuses'}
                    align="right"
                  />
                </div>
              </div>
            </button>
            {isMyPublishes && publicationStatus === 'unpublished' ? null : (
              <div className={publishStyles.projectActionLayer}>
                <div className={publishStyles.projectQuickActions}>
                  <button
                    type="button"
                    disabled={isRemixing}
                    aria-label={t('squareScope.remix')}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleRemix(entry);
                    }}
                  >
                    <Icon name="copy" size={13} aria-hidden />
                    {isRemixing ? t('squareScope.remixing') : t('squareScope.remix')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('squareScope.reference')}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleReference(entry);
                    }}
                  >
                    <Icon name="link" size={13} aria-hidden />
                    {t('squareScope.reference')}
                  </button>
                </div>
              </div>
            )}
            {isMyPublishes ? (
              <span
                className={`${publishStyles.publicationBadge} ${
                  publicationStatus === 'published' ? publishStyles['publicationBadge--published'] : ''
                }`}
              >
                {publicationStatus === 'published'
                  ? t('squareScope.published')
                  : t('squareScope.unpublished')}
              </span>
            ) : null}
            {isMyPublishes || isOwner ? (
              <ProjectCardMenu
                publicationStatus={publicationStatus}
                onPublish={() => setConfirmAction({ type: 'publish', name: entry.name, title })}
                onUnpublish={() => setConfirmAction({ type: 'unpublish', name: entry.name, title })}
                onDelete={() => setConfirmAction({ type: 'delete', name: entry.name, title })}
                busy={busyName}
              />
            ) : null}
          </div>
        );
      })}
      {remixError ? (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-text-secondary)', padding: '12px' }}>
          {remixError}
        </div>
      ) : null}
      {actionError ? (
        <div role="alert" style={{ gridColumn: '1 / -1', color: 'var(--danger, #c13b35)', padding: '12px' }}>
          {actionError}
        </div>
      ) : null}
      {detailsEntry ? (
        <SquarePluginPreview
          entry={detailsEntry}
          initialShareOpen={shareOnOpen}
          remixingName={remixingName}
          onClose={() => setDetailsEntry(null)}
          onReference={(entry) => {
            setDetailsEntry(null);
            handleReference(entry);
          }}
          onRemix={(entry) => {
            setDetailsEntry(null);
            handleRemix(entry);
          }}
        />
      ) : null}
      </div>

      {confirmAction ? (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => setConfirmAction(null)}
          closeOnEscape
          ariaLabelledBy={confirmTitleId}
        >
          <DialogTitle id={confirmTitleId}>
            {confirmAction.type === 'publish'
              ? t('squareScope.publishConfirmTitle')
              : confirmAction.type === 'unpublish'
                ? t('squareScope.unpublishConfirmTitle')
                : t('squareScope.deleteConfirmTitle')}
          </DialogTitle>
          <DialogDescription>
            {confirmAction.type === 'publish'
              ? t('squareScope.publishConfirmDesc', { title: confirmAction.title })
              : confirmAction.type === 'unpublish'
                ? t('squareScope.unpublishConfirmDesc', { title: confirmAction.title })
                : t('squareScope.deleteConfirmDesc', { title: confirmAction.title })}
          </DialogDescription>
          <DialogFooter className="row">
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              disabled={busyName === confirmAction.name}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busyName === confirmAction.name}
              onClick={() => {
                const action = confirmAction;
                void (async () => {
                  try {
                    if (action.type === 'publish') await publishPlugin(action.name);
                    else if (action.type === 'unpublish') await unpublishPlugin(action.name);
                    else await deletePlugin(action.name);
                  } finally {
                    setConfirmAction(null);
                  }
                })();
              }}
            >
              {busyName === confirmAction.name ? <Icon name="spinner" size={14} /> : null}
              {confirmAction.type === 'publish'
                ? t('pluginCard.publish')
                : confirmAction.type === 'unpublish'
                  ? t('squareScope.unpublish')
                  : t('common.delete')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </>
  );
}


type CommunityProjectPreviewContent =
  | { kind: 'html'; html: string }
  | { kind: 'markdown'; markdown: string; fileName: string | null }
  | { kind: 'document'; preview: ProjectFilePreview; fileName: string | null };

function communityPreviewFileName(response: Response): string | null {
  const encoded = response.headers.get('x-open-design-preview-file');
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function CommunityMarkdownPreview({ markdown, fileName }: { markdown: string; fileName: string | null }) {
  const html = renderMarkdownToSafeHtml(markdown);
  return (
    <div className={publishStyles.communityPreviewScroll}>
      <div className={publishStyles.communityPreviewDocument}>
        {fileName ? <div className={publishStyles.communityPreviewFileName}>{fileName}</div> : null}
        <article
          className="markdown-rendered"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

function CommunityDocumentPreview({
  preview,
  fileName,
}: {
  preview: ProjectFilePreview;
  fileName: string | null;
}) {
  return (
    <div className={publishStyles.communityPreviewScroll}>
      <div className={publishStyles.communityPreviewDocument}>
        <div className={publishStyles.communityPreviewFileName}>{fileName || preview.title}</div>
        {preview.sections.map((section, index) => (
          <section
            className={publishStyles.communityPreviewSection}
            key={`${section.title}-${index}`}
          >
            <h3>{section.title}</h3>
            {section.lines.map((line, lineIndex) => (
              <p key={`${lineIndex}-${line}`}>{line}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function SquarePluginPreview({
  entry,
  initialShareOpen = false,
  remixingName,
  onClose,
  onReference,
  onRemix,
}: {
  entry: MarketplacePluginEntry;
  initialShareOpen?: boolean;
  remixingName: string | null;
  onClose: () => void;
  onReference: (entry: MarketplacePluginEntry) => void;
  onRemix: (entry: MarketplacePluginEntry) => void;
}) {
  const t = useT();
  const title = entry.title ?? entry.name;
  const publisherName = entry.publisher?.displayName ?? entry.publisher?.github ?? entry.publisher?.id ?? '';
  const meta = publisherName ? publisherName + ' \u00b7 v' + entry.version : 'v' + entry.version;
  const isRemixing = remixingName === entry.name;

  // Fetch the actual project preview from the daemon. Community projects can
  // ship HTML, Markdown, or document-style files such as PDFs; keep one
  // preview surface and switch rendering by response Content-Type.
  const [previewContent, setPreviewContent] = useState<CommunityProjectPreviewContent | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    setPreviewContent(null);
    setPreviewError(null);
    try {
      const resp = await fetch(
        `/api/marketplaces/hdw-community/plugins/${encodeURIComponent(entry.name)}/preview`,
      );
      if (!resp.ok) throw new Error('preview fetch failed');

      const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
      const fileName = communityPreviewFileName(resp);

      if (contentType.includes('text/markdown')) {
        setPreviewContent({
          kind: 'markdown',
          markdown: await resp.text(),
          fileName,
        });
        return;
      }

      if (contentType.includes('application/json')) {
        const preview = await resp.json() as ProjectFilePreview;
        if (preview && Array.isArray(preview.sections)) {
          setPreviewContent({ kind: 'document', preview, fileName });
          return;
        }
        throw new Error('unsupported document preview response');
      }

      setPreviewContent({ kind: 'html', html: await resp.text() });
    } catch {
      setPreviewError(t('squareScope.loadFailed'));
    }
  }, [entry.name, t]);

  const handlePreviewView = useCallback(() => {
    void fetchPreview();
  }, [fetchPreview]);

  const previewCustom = previewContent?.kind === 'markdown'
    ? (
        <CommunityMarkdownPreview
          markdown={previewContent.markdown}
          fileName={previewContent.fileName}
        />
      )
    : previewContent?.kind === 'document'
      ? (
          <CommunityDocumentPreview
            preview={previewContent.preview}
            fileName={previewContent.fileName}
          />
        )
      : undefined;

  const modal = (
    <PreviewModal
      initialShareOpen={initialShareOpen}
      title={title}
      subtitle={meta}
      views={[{
        id: 'preview',
        label: t('squareScope.reference'),
        html: previewContent?.kind === 'html' ? previewContent.html : undefined,
        custom: previewCustom,
        error: previewError,
      }]}
      onView={handlePreviewView}
      exportTitleFor={() => title}
      onClose={onClose}
      primaryAction={{
        label: t('squareScope.remix'),
        onClick: () => onRemix(entry),
        busy: isRemixing,
        busyLabel: t('common.loading'),
        menu: [
          {
            label: t('squareScope.remix'),
            description: t('squareScope.remixDescription'),
            onClick: () => onRemix(entry),
          },
          {
            label: t('squareScope.reference'),
            description: t('preview.replicateContentDesc'),
            onClick: () => onReference(entry),
          },
          {
            label: t('preview.usePluginOnly'),
            description: t('squareScope.useWithoutPromptDescription'),
            // Display only until community plugin loading is connected.
            disabled: true,
            onClick: () => {},
          },
        ],
      }}
    />
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}

export function SquareView({ mode = 'community', tab, projectItems }: {
  mode?: 'community' | 'my-publishes';
  tab?: string;
  /** Presentation input only; does not change marketplace API contracts. */
  projectItems?: readonly PublishedProjectItem[];
}) {
  const t = useT();
  const { locale } = useI18n();
  const myUsername = getStoredUsername();
  const routeTab = tab === 'skill' || tab === 'mcp' || tab === 'tool' ? tab : 'projects';
  const [activeTab, setActiveTab] = useState<SquareTab>(routeTab);

  // Keep the local tab in sync with the URL when the browser back/forward
  // (or an external deep link) changes the route.
  useEffect(() => {
    setActiveTab(routeTab);
  }, [routeTab]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingPublishedProject, setPendingPublishedProject] = useState<PendingPublishedProject | null>(null);
  const [publishSuccessMessage, setPublishSuccessMessage] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publicationFilter, setPublicationFilter] = useState<PublicationFilter>('all');
  const [communitySearchQuery, setCommunitySearchQuery] = useState('');
  const [skillCategoryControlsEl, setSkillCategoryControlsEl] = useState<HTMLElement | null>(null);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceMemberId, setWorkspaceMemberId] = useState<string | null>(null);
  const [workspaceType, setWorkspaceType] = useState<string | null>(null);
  const [selfSharedSpaceMemberId, setSelfSharedSpaceMemberId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/workspace/directory', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as {
          items?: WorkspaceDirectoryItem[];
          activeWorkspaceId?: string | null;
        };
        if (cancelled) return;
        const workspace = body.items?.find((item) => item.workspaceId === body.activeWorkspaceId)
          ?? body.items?.find((item) => item.isDefaultTeam === true);
        setWorkspaceId(workspace?.workspaceId ?? null);
        setWorkspaceMemberId(workspace?.workspaceMemberId ?? null);
        setWorkspaceType(workspace?.workspaceType ?? null);
      } catch {
        // leave workspaceId null
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!myUsername) {
      setSelfSharedSpaceMemberId(null);
      return;
    }
    let cancelled = false;
    void getSharedSpaceMemberId(myUsername).then((id) => {
      if (!cancelled) setSelfSharedSpaceMemberId(id);
    });
    return () => { cancelled = true; };
  }, [myUsername]);

  const isMyPublishes = mode === 'my-publishes';
  const title = isMyPublishes ? t('squareScope.myPublishesTitle') : t('pluginsHome.title');
  const subtitle = isMyPublishes ? t('squareScope.myPublishesSubtitle') : t('squareScope.subtitle');

  const activeDef = TABS.find((tab) => tab.id === activeTab)!;
  const handlePendingPublishedProjectVisible = useCallback((project: PendingPublishedProject) => {
    setPublishSuccessMessage(locale.startsWith('zh')
      ? `${project.title} 已发布为新的社区项目`
      : `${project.title} was published as a new community project`);
    setPendingPublishedProject((current) => (
      current?.name === project.name && current.version === project.version ? null : current
    ));
  }, [locale]);

  return (
    <section className={styles.view} aria-labelledby="square-title" data-testid="square-view">
      {isMyPublishes ? (
        <ModuleBreadcrumb items={[{
          key: 'square',
          label: t('pluginsHome.title'),
          onNavigate: () => navigate({ kind: 'home', view: 'square' }),
        }]} />
      ) : null}
      <header className={`${styles.header} ${isMyPublishes ? styles.secondaryHeader : ''}`}>
        <div className={styles.titleBlock}>
          <h1 id="square-title" className={styles.title}>{title}</h1>
          {!isMyPublishes ? (
            <span className={styles.subtitle}>
              <span className={styles.dot} aria-hidden />
              {subtitle}
            </span>
          ) : null}
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.solidBtn}
            onClick={() => setPublishOpen(true)}
          >
            <Icon name="plus" size={16} aria-hidden />
            <span>{t('squareScope.newPublish')}</span>
          </button>
          {!isMyPublishes ? (
            <button
              type="button"
              className={styles.outlineBtn}
              onClick={() => navigate({ kind: 'home', view: 'my-publishes' })}
            >
              <Icon name="file-text" size={16} aria-hidden />
              <span>{t('squareScope.myPublishes')}</span>
            </button>
          ) : null}
       {publishOpen ? (
         <PublishDialog
             initialCategory={activeTab}
            onClose={() => setPublishOpen(false)}
              onPublish={async (selection: PublishProjectSelection | PublishToolSelection | PublishMcpSelection | PublishSkillSelection) => {
                const headers: Record<string, string> = {};
                if (workspaceId) headers['x-od-workspace-id'] = workspaceId;
                if (workspaceMemberId) headers['x-od-workspace-member-id'] = workspaceMemberId;
                if (workspaceType) headers['x-od-workspace-type'] = workspaceType;
                if ('url' in selection) {
                  const checkRes = await fetch(
                    `/api/workspace/tool/cloud/check?label=${encodeURIComponent(selection.name)}`,
                    { cache: 'no-store', headers },
                  );
                  if (checkRes.ok && ((await checkRes.json()) as { exists?: boolean }).exists) {
                    throw new Error(t('personalScope.mcpDuplicateLabel'));
                  }
                  const response = await fetch('/api/workspace/tool/cloud', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify({
                      metadata: {
                        url: selection.url,
                        name: selection.name,
                        label: selection.name,
                        description: selection.description,
                      },
                      scope: 'public',
                    }),
                  });
                  if (!response.ok) throw await publishResponseError(response, 'Tool publish failed');
                  window.dispatchEvent(new CustomEvent('personal:tool-refresh'));
                  } else if ('config' in selection) {
                    const checkRes = await fetch(
                      `/api/workspace/mcp/cloud/check?label=${encodeURIComponent(selection.label)}`,
                      { cache: 'no-store', headers },
                    );
                    if (checkRes.ok && ((await checkRes.json()) as { exists?: boolean }).exists) {
                      throw new Error(t('personalScope.mcpDuplicateLabel'));
                    }
                    const parsedConfig = JSON.parse(selection.config) as Record<string, unknown>;
                    const rawType = parsedConfig.type as string | undefined;
                    const transport = rawType === 'sse' || rawType === 'http' ? rawType : 'stdio';
                    const template: Record<string, unknown> = {
                      label: selection.label,
                      description: selection.description,
                      ...(selection.logoKey ? { logoKey: selection.logoKey } : {}),
                      transport,
                      category: 'utilities',
                    };
                    if (transport === 'stdio') {
                      template.command = (parsedConfig.command as string) ?? '';
                      const argArr = Array.isArray(parsedConfig.args) ? parsedConfig.args as string[] : [];
                      if (argArr.length > 0) template.args = argArr;
                    } else {
                      template.url = (parsedConfig.url as string) ?? '';
                    }
                    const response = await fetch('/api/workspace/mcp/cloud', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...headers },
                      body: JSON.stringify({ template, scope: 'public' }),
                    });
                    if (!response.ok) throw await publishResponseError(response, 'MCP publish failed');
                    window.dispatchEvent(new CustomEvent('personal:mcp-refresh'));
                } else if ('body' in selection) {
                   if (selection.upload) {
                     const result = await uploadSkillToCloud(
                       selection.upload,
                       selection.workspaceContext,
                       'public',
                       selection.category,
                       selection.logoKey,
                     );
                     if ('error' in result) {
                       throw new Error(result.error.message || 'Skill publish failed');
                     }
                   }
                  window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
                } else {
                  const publishAttemptId = crypto.randomUUID();
                  const publishedAt = new Date().toISOString();
                  const response = await fetch(
                    `/api/projects/${encodeURIComponent(selection.projectId)}/publish-community`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...headers },
                      body: JSON.stringify({
                        title: selection.name,
                        description: selection.description,
                        ...(selection.entryFile ? { entryFile: selection.entryFile } : {}),
                        publishAttemptId,
                        publishedAt,
                      }),
                    },
                  );
                  if (!response.ok) throw await publishResponseError(response, 'Project publish failed');
                  const published = await response.json() as ProjectPublishCommunityResponse;
                  setPendingPublishedProject({
                    name: published.name,
                    version: published.version,
                    title: selection.name,
                  });
                }
                setRefreshKey((key) => key + 1);
             }}
           />
          ) : null}

        </div>
      </header>

      <div className={isMyPublishes ? publishStyles.toolbar : undefined}>
      <div className={`${styles.typeTabs} ${isMyPublishes ? publishStyles.tabs : ''}`} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? styles.tabActive : styles.tab}
          onClick={() => {
            setActiveTab(tab.id);
            navigate(
              { kind: 'home', view: mode === 'my-publishes' ? 'my-publishes' : 'square', tab: tab.id === 'projects' ? undefined : tab.id },
              { replace: true },
            );
          }}
          >
            <Icon name={tab.icon} size={16} aria-hidden />
            <span>{t(tab.labelKey)}</span>
          </button>
        ))}
        {!isMyPublishes ? (
          <div className="recent-projects__controls">
            <div className="recent-projects__search">
              <Icon name="search" size={14} aria-hidden />
              <input
                type="search"
                value={communitySearchQuery}
                onChange={(event) => setCommunitySearchQuery(event.target.value)}
                placeholder={`${t('common.search')} ${t(activeDef.labelKey)}`}
                aria-label={`${t('common.search')} ${t(activeDef.labelKey)}`}
              />
              {communitySearchQuery ? (
                <button
                  type="button"
                  className="recent-projects__search-clear"
                  aria-label={t('common.clear')}
                  onClick={() => setCommunitySearchQuery('')}
                >
                  <Icon name="close" size={12} aria-hidden />
                </button>
              ) : null}
            </div>
            {activeTab === 'skill' ? (
              <span ref={setSkillCategoryControlsEl} style={{ display: 'contents' }} />
            ) : null}
          </div>
        ) : null}
      </div>

      {isMyPublishes && activeTab === 'projects' ? (
        <PublicationStatusFilter value={publicationFilter} onChange={setPublicationFilter} />
      ) : null}
      </div>

      <div className={styles.content} role="tabpanel">
      {activeTab === 'projects' ? (
        <ProjectsPanel
          isMyPublishes={isMyPublishes}
          publicationFilter={publicationFilter}
          projectItems={projectItems}
          refreshKey={refreshKey}
          onRefresh={() => setRefreshKey((k) => k + 1)}
          username={myUsername}
          workspaceMemberId={selfSharedSpaceMemberId ?? workspaceMemberId}
          statsWorkspaceId={workspaceId}
          statsWorkspaceMemberId={workspaceMemberId}
          statsWorkspaceType={workspaceType}
          searchQuery={!isMyPublishes ? communitySearchQuery : ''}
          pendingPublishedProject={pendingPublishedProject}
          onPendingPublishedProjectVisible={handlePendingPublishedProjectVisible}
        />
      ) : activeTab === 'skill' ? (
          <CloudSkillList
            workspaceId={workspaceId}
            workspaceMemberId={workspaceMemberId}
            workspaceType={workspaceType}
            ownerMemberId={isMyPublishes ? workspaceMemberId : null}
            sourceProvider={isMyPublishes ? null : COMMUNITY_SKILL_PROVIDERS}
            mode="square"
            scope="public"
            controlsPortalTarget={!isMyPublishes ? skillCategoryControlsEl : null}
            externalSearchQuery={!isMyPublishes ? communitySearchQuery : undefined}
          />
     ) : activeTab === 'mcp' ? (
         <CloudMcpList workspaceId={workspaceId} workspaceMemberId={workspaceMemberId} workspaceType={workspaceType} ownerMemberId={isMyPublishes ? workspaceMemberId : null} mode="square" scope="public" searchQuery={!isMyPublishes ? communitySearchQuery : ''} />
     ) : activeTab === 'tool' ? (
         <CloudToolList workspaceId={workspaceId} workspaceMemberId={workspaceMemberId} workspaceType={workspaceType} ownerMemberId={isMyPublishes ? workspaceMemberId : null} mode="square" scope="public" searchQuery={!isMyPublishes ? communitySearchQuery : ''} />
     ) : (
          <PlaceholderPanel
            icon={activeDef.icon}
            label={t(activeDef.labelKey)}
            note={t('squareScope.emptyNote')}
          />
      )}
      </div>

      {publishSuccessMessage ? (
        <Toast
          message={publishSuccessMessage}
          tone="success"
          onDismiss={() => setPublishSuccessMessage(null)}
        />
      ) : null}

    </section>
  );
}
