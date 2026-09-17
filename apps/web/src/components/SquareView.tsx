import { PageEmptyState } from './PageEmptyState';
import { ModuleBreadcrumb } from './ModuleBreadcrumb';
// Hi广场 — community plaza surface.
//
// Reached from the nav rail's "Hi广场" item under Community. Mirrors
// PersonalAllView's layout (header + subtitle + type tabs + content
// panel) and reuses TeamSpaceView.module.css so the surface stays
// visually consistent across scope pages. Tabs: 项目 / Skill / MCP / 工具.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { PreviewModal } from './PreviewModal';
import { PublishDialog, type PublishProjectSelection } from './PublishDialog';
import type { PublishToolSelection } from './PublishDialog';
import type { PublishMcpSelection } from './PublishDialog';
import type { PublishSkillSelection } from './PublishDialog';
import { CloudSkillList } from './CloudSkillList';
import { CloudMcpList } from './CloudMcpList';
import { CloudToolList } from './CloudToolList';
import type { MarketplacePluginEntry } from '@open-design/contracts';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { navigate } from '../router';
import { remixHdwPlugin } from '../state/projects';
import { getStoredUsername } from '../auth/auth';
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
const TEMPLATE_ACCENTS = [
  '#4164f4', '#d46342', '#111827', '#0f9f6e', '#353535', '#ea580c', '#0284c7',
  '#4f46e5', '#db2777', '#16a34a', '#475569', '#f59e0b', '#0f172a', '#1A74FF',
  '#be123c', '#0d9488', '#0891b2', '#ec4899', '#64748b', '#8b5cf6', '#334155',
];

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function templateAccent(id: string): string {
  return TEMPLATE_ACCENTS[hashString(id) % TEMPLATE_ACCENTS.length]!;
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

function ProjectCardMenu({ publicationStatus, onShare }: {
  publicationStatus?: ProjectPublicationStatus;
  onShare: () => void;
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
              <button type="button" role="menuitem" disabled>
                <Icon name="arrow-up" size={12} aria-hidden /><span>{t('pluginCard.publish')}</span>
              </button>
              <button type="button" role="menuitem" className="danger" disabled>
                <Icon name="close" size={12} aria-hidden /><span>{t('common.delete')}</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onShare(); }}>
                <Icon name="share" size={12} aria-hidden /><span>{t('preview.shareMenu')}</span>
              </button>
              {publicationStatus === 'published' ? (
                <button type="button" role="menuitem" disabled>
                  <Icon name="eye-off" size={12} aria-hidden /><span>{t('squareScope.unpublish')}</span>
                </button>
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

function ProjectsPanel({ refreshKey, onRefresh, username, isMyPublishes, publicationFilter, projectItems }: {
  refreshKey: number;
  onRefresh: () => void;
  username?: string | null;
  isMyPublishes: boolean;
  publicationFilter: PublicationFilter;
  projectItems?: readonly PublishedProjectItem[];
}) {
  const t = useT();
  const [plugins, setPlugins] = useState<MarketplacePluginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [remixingName, setRemixingName] = useState<string | null>(null);
  const [remixError, setRemixError] = useState<string | null>(null);
  const [detailsEntry, setDetailsEntry] = useState<MarketplacePluginEntry | null>(null);
  const [shareOnOpen, setShareOnOpen] = useState(false);
  // Synchronous rapid-click guard: state writes are not synchronous, so a
  // burst of clicks before React re-renders all read the stale
  // `remixingName` and fire N duplicate POST /remix calls. The ref is
  // written the instant the first click is accepted, so every click in the
  // same burst sees the lock immediately. Cleared on success/failure or by
  // the timeout fallback so a card can never get stuck disabled forever.
  const remixingNameRef = useRef<string | null>(null);
  useEffect(() => {
    if (!remixingName) return;
    const timer = window.setTimeout(() => {
      remixingNameRef.current = null;
      setRemixingName(null);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [remixingName]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const url = username
      ? `/api/marketplaces/hdw-community/plugins?username=${encodeURIComponent(username)}`
      : '/api/marketplaces/hdw-community/plugins';
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fetch failed'))))
      .then((d: { plugins?: MarketplacePluginEntry[] }) => {
        if (cancelled) return;
        const all = d.plugins ?? [];
        setPlugins(all);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function handleReference(entry: MarketplacePluginEntry) {
    const prompt = String(entry.prompt ?? entry.description ?? '');
    const title = String(entry.title ?? entry.name);
    stashHomePromptHandoff(createCommunityReferenceHandoff(Date.now(), prompt, title));
    navigate({ kind: 'home', view: 'home' });
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
    : plugins.map((entry) => ({ entry, publicationStatus: 'published' }));
  const visibleItems = isMyPublishes && publicationFilter !== 'all'
    ? items.filter((item) => item.publicationStatus === publicationFilter)
    : items;

  if (visibleItems.length === 0) {
    return <PageEmptyState />;
  }

  return (
    <div className="community-template-grid" data-testid="square-projects-grid">
      {visibleItems.map(({ entry, publicationStatus }) => {
        const title = entry.title ?? entry.name;
        const publisherName = entry.publisher?.displayName ?? entry.publisher?.github ?? entry.publisher?.id ?? '';
        const meta = publisherName ? publisherName + ' · v' + entry.version : 'v' + entry.version;
        const accent = templateAccent(entry.name);
        const isRemixing = remixingName === entry.name;
        return (
          <article
            key={entry.name}
            className={`community-template-card is-clickable ${publishStyles.card}`}
            data-plugin-name={entry.name}
            tabIndex={0}
            aria-label={title}
            onClick={() => { setShareOnOpen(false); setDetailsEntry(entry); }}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                setShareOnOpen(false);
                setDetailsEntry(entry);
              }
            }}
          >
           <div
             className="community-template-card__preview"
             style={{ '--template-accent': accent } as CSSProperties}
             aria-hidden
           >
             {entry.coverUrl ? (
               <img
                 src={entry.coverUrl}
                 alt={title}
                 loading="lazy"
                 style={{ width: '100%', height: '100%', objectFit: 'cover' }}
               />
             ) : null}
           </div>
            {isMyPublishes && publicationStatus === 'unpublished' ? (
              <span className={publishStyles.unpublishedBadge}>{t('squareScope.unpublished')}</span>
            ) : null}
            <ProjectCardMenu
              publicationStatus={isMyPublishes ? publicationStatus : undefined}
              onShare={() => { setShareOnOpen(true); setDetailsEntry(entry); }}
            />
            <footer className="community-template-card__foot">
              <span>{meta}</span>
              {isMyPublishes && publicationStatus === 'unpublished' ? null : <div className="community-template-card__actions">
                <button
                  type="button"
                  disabled={isRemixing}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemix(entry);
                  }}
                >
                  {isRemixing ? t('common.loading') : t('squareScope.remix')}
                </button>
                <button
                  type="button"
                  className="community-template-card__prompt-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleReference(entry);
                  }}
                >
                  {t('squareScope.reference')}
                </button>
              </div>}
            </footer>
          </article>
        );
      })}
      {remixError ? (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-text-secondary)', padding: '12px' }}>
          {remixError}
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

  // Fetch the actual preview HTML from the daemon's preview endpoint, which
  // downloads the archive and serves the real content — not a synthetic
  // page built from the prompt text.
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    setPreviewHtml(null);
    setPreviewError(null);
    try {
      const resp = await fetch(
        `/api/marketplaces/hdw-community/plugins/${encodeURIComponent(entry.name)}/preview`,
      );
      if (!resp.ok) throw new Error('preview fetch failed');
      const html = await resp.text();
      setPreviewHtml(html);
    } catch {
      setPreviewError(t('squareScope.loadFailed'));
    }
  }, [entry.name, t]);

  useEffect(() => {
    void fetchPreview();
  }, [fetchPreview]);

  const modal = (
    <PreviewModal
      initialShareOpen={initialShareOpen}
      title={title}
      subtitle={meta}
      views={[{
        id: 'preview',
        label: t('squareScope.reference'),
        html: previewHtml,
        error: previewError,
      }]}
      onView={() => { void fetchPreview(); }}
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
  const myUsername = getStoredUsername();
  const routeTab = tab === 'skill' || tab === 'mcp' || tab === 'tool' ? tab : 'projects';
  const [activeTab, setActiveTab] = useState<SquareTab>(routeTab);

  // Keep the local tab in sync with the URL when the browser back/forward
  // (or an external deep link) changes the route.
  useEffect(() => {
    setActiveTab(routeTab);
  }, [routeTab]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publicationFilter, setPublicationFilter] = useState<PublicationFilter>('all');

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceMemberId, setWorkspaceMemberId] = useState<string | null>(null);
  const [workspaceType, setWorkspaceType] = useState<string | null>(null);

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

  const isMyPublishes = mode === 'my-publishes';
  const title = isMyPublishes ? t('squareScope.myPublishesTitle') : t('pluginsHome.title');
  const subtitle = isMyPublishes ? t('squareScope.myPublishesSubtitle') : t('squareScope.subtitle');

  const activeDef = TABS.find((tab) => tab.id === activeTab)!;

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
        <button
          type="button"
          className={styles.solidBtn}
          onClick={() => setPublishOpen(true)}
        >
          <Icon name="plus" size={16} aria-hidden />
          <span>{t('squareScope.newPublish')}</span>
        </button>
       {publishOpen ? (
         <PublishDialog
             initialCategory={activeTab}
            onClose={() => setPublishOpen(false)}
              onPublish={(selection: PublishProjectSelection | PublishToolSelection | PublishMcpSelection | PublishSkillSelection) => {
                if ('url' in selection) {
                  void (async () => {
                    try {
                     const headers: Record<string, string> = {};
                     if (workspaceId) headers['x-od-workspace-id'] = workspaceId;
                     if (workspaceMemberId) headers['x-od-workspace-member-id'] = workspaceMemberId;
                     if (workspaceType) headers['x-od-workspace-type'] = workspaceType;
                      // Check for duplicate label before publishing.
                      try {
                        const checkRes = await fetch(
                          `/api/workspace/tool/cloud/check?label=${encodeURIComponent(selection.name)}`,
                          { cache: 'no-store', headers },
                        );
                        if (checkRes.ok) {
                          const checkBody = await checkRes.json();
                          if (checkBody.exists) {
                            alert(t('personalScope.mcpDuplicateLabel'));
                            return;
                          }
                        }
                      } catch {
                        // If the check fails, proceed and let the server reject.
                      }
                      await fetch('/api/workspace/tool/cloud', {
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
                      window.dispatchEvent(new CustomEvent('personal:tool-refresh'));
                    } catch {
                      // best-effort
                    }
                    setRefreshKey((k) => k + 1);
                  })();
                  } else if ('config' in selection) {
                    void (async () => {
                      try {
                        const headers: Record<string, string> = {};
                        if (workspaceId) headers['x-od-workspace-id'] = workspaceId;
                        if (workspaceMemberId) headers['x-od-workspace-member-id'] = workspaceMemberId;
                        if (workspaceType) headers['x-od-workspace-type'] = workspaceType;
                        // Check for duplicate label before publishing.
                        try {
                          const checkRes = await fetch(
                            `/api/workspace/mcp/cloud/check?label=${encodeURIComponent(selection.label)}`,
                            { cache: 'no-store', headers },
                          );
                          if (checkRes.ok) {
                            const checkBody = await checkRes.json();
                            if (checkBody.exists) {
                              alert(t('personalScope.mcpDuplicateLabel'));
                              return;
                            }
                          }
                        } catch {
                          // If the check fails, proceed and let the server reject.
                        }
                        let parsedConfig: Record<string, unknown> = {};
                        try {
                          parsedConfig = JSON.parse(selection.config) as Record<string, unknown>;
                       } catch {
                         return;
                       }
                       const rawType = parsedConfig.type as string | undefined;
                       const transport = rawType === 'sse' || rawType === 'http' ? rawType : 'stdio';
                       const template: Record<string, unknown> = {
                         label: selection.label,
                         description: selection.displayName,
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
                       await fetch('/api/workspace/mcp/cloud', {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json', ...headers },
                         body: JSON.stringify({ template, scope: 'public' }),
                       });
                     window.dispatchEvent(new CustomEvent('personal:mcp-refresh'));
                    } catch {
                      // best-effort
                    }
                    setRefreshKey((k) => k + 1);
                  })();
                } else if ('body' in selection) {
                  window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
                  setRefreshKey((k) => k + 1);
                } else {
                  console.info('[publish] project selection:', selection);
                  setRefreshKey((k) => k + 1);
                }
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
      </div>

      {isMyPublishes && activeTab === 'projects' ? (
        <PublicationStatusFilter value={publicationFilter} onChange={setPublicationFilter} />
      ) : null}
      </div>

      <div className={styles.content} role="tabpanel">
      {activeTab === 'projects' ? (
        <ProjectsPanel isMyPublishes={isMyPublishes} publicationFilter={publicationFilter} projectItems={projectItems} refreshKey={refreshKey} onRefresh={() => setRefreshKey((k) => k + 1)} username={isMyPublishes ? myUsername : null} />
      ) : activeTab === 'skill' ? (
          <CloudSkillList
            workspaceId={workspaceId}
            workspaceMemberId={workspaceMemberId}
            workspaceType={workspaceType}
            ownerMemberId={isMyPublishes ? workspaceMemberId : null}
            sourceProvider={isMyPublishes ? null : COMMUNITY_SKILL_PROVIDERS}
            mode="square"
            scope="public"
          />
     ) : activeTab === 'mcp' ? (
         <CloudMcpList workspaceId={workspaceId} workspaceMemberId={workspaceMemberId} workspaceType={workspaceType} ownerMemberId={isMyPublishes ? workspaceMemberId : null} mode="square" scope="public" />
     ) : activeTab === 'tool' ? (
         <CloudToolList workspaceId={workspaceId} workspaceMemberId={workspaceMemberId} workspaceType={workspaceType} ownerMemberId={isMyPublishes ? workspaceMemberId : null} mode="square" scope="public" />
     ) : (
          <PlaceholderPanel
            icon={activeDef.icon}
            label={t(activeDef.labelKey)}
            note={t('squareScope.emptyNote')}
          />
      )}
      </div>

    </section>
  );
}
