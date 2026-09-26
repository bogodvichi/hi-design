// Plugins discovery section on Home.
//
// Renders an artifact-kind bar over the plugin catalog: Prototype ·
// Slides · Image · Video · HyperFrames · Audio. Prototype, Slides,
// Image, and Video can reveal scene buckets from the user-prompt
// taxonomy; HyperFrames and Audio stay flat. A small Saved chip
// sits orthogonal to the rows for quick access to user-saved picks.
//
// The category list is curated — finer metadata (surface, role tags,
// scenario domains) lives on each plugin card and detail surface.
//
// Derivation, catalog building and category-based filtering live in
// `./plugins-home/facets.ts`; selection state and the Saved
// override live in `./plugins-home/usePluginFacets.ts`. This file
// owns layout only.

import { Button, Input } from '@open-design/components';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { useI18n, useT } from '../i18n';
import type { PluginShareAction } from '../state/projects';
import { Icon } from './Icon';
import { PluginCard } from './plugins-home/PluginCard';
import { isFeaturedPlugin, type FacetOption } from './plugins-home/facets';
import { localizePluginTitle } from './plugins-home/localization';
import { usePluginFacets } from './plugins-home/usePluginFacets';
import { pluginSubfacetLabel } from './plugins-home/subfacetLabel';
import { useSavedPluginIds } from './plugins-home/savedPlugins';
import type { PluginSortOrder } from './plugins-home/sortOrder';
import type { PluginUseAction } from './plugins-home/useActions';
import { Toast } from './Toast';
import { AnimatePresence, motion } from 'motion/react';
import { popoverIn } from '../motion';
import { AI_BUILDER_WEB_PREX } from './workspace-context';
import { useAuth } from '../auth/LoginGate';
import {
  HtmlProjectCoverFrame
} from "./project-cover";

const RICH_PLUGIN_RENDER_LIMIT = 60;
const RICH_PLUGIN_RENDER_BATCH_SIZE = 60;
const GALLERY_PLUGIN_RENDER_LIMIT = 12;
const GALLERY_PLUGIN_RENDER_BATCH_SIZE = 12;

interface Props {
  iuxTemplates?: unknown[];
  plugins: InstalledPluginRecord[];
  loading: boolean;
  activePluginId: string | null;
  pendingApplyId: string | null;
  pendingDuplicateId?: string | null;
  pendingShareAction?: { pluginId: string; action: PluginShareAction } | null;
  onCreateProject?: (input: any) => Promise<boolean> | boolean | void | undefined;
  onUse: (record: InstalledPluginRecord, action: PluginUseAction) => void;
  onDuplicate?: (record: InstalledPluginRecord) => void;
  onOpenDetails: (record: InstalledPluginRecord) => void;
  onPluginShareAction?: (
    record: InstalledPluginRecord,
    action: PluginShareAction,
  ) => void;
  onBrowseRegistry?: () => void;
  onCancelShare?: (record: TemplateRecord) => void;
  onToggleIux?: () => void;
  preferDefaultFacet?: boolean;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  // 'gallery' renders each card as a minimal live example.html preview
  // tile (Community); 'rich' keeps the hover-overlay metadata card.
  cardLayout?: 'rich' | 'gallery';
}

export function PluginsHomeSection({
  iuxTemplates,
  plugins,
  loading,
  activePluginId,
  pendingApplyId,
  pendingDuplicateId = null,
  pendingShareAction = null,
  onCreateProject,
  onUse,
  onDuplicate,
  onOpenDetails,
  onPluginShareAction,
  onBrowseRegistry,
  onCancelShare,
  onToggleIux,
  preferDefaultFacet = true,
  title,
  subtitle,
  emptyMessage,
  cardLayout = 'rich',
}: Props) {
  const { locale, t } = useI18n();
  const { savedPluginIds, savePluginId } = useSavedPluginIds();
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const initialRenderLimit =
    cardLayout === 'gallery' ? GALLERY_PLUGIN_RENDER_LIMIT : RICH_PLUGIN_RENDER_LIMIT;
  const renderBatchSize =
    cardLayout === 'gallery' ? GALLERY_PLUGIN_RENDER_BATCH_SIZE : RICH_PLUGIN_RENDER_BATCH_SIZE;
  const loadMoreRootMargin = cardLayout === 'gallery' ? '900px' : '640px';
  const [renderLimit, setRenderLimit] = useState(initialRenderLimit);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const {
    visiblePlugins,
    savedList,
    filtered,
    catalog,
    selection,
    pickCategory,
    pickSubcategory,
    clearFacets,
    mode,
    setMode,
    query,
    setQuery,
    sortOrder,
    setSortOrder,
    totalVisible,
  } = usePluginFacets({
    iuxTemplates,
    plugins,
    savedPluginIds,
    preferDefaultFacet: cardLayout === 'gallery' ? false : preferDefaultFacet,
    locale,
  });
  const renderedPlugins = useMemo(
    () => filtered.slice(0, renderLimit),
    [filtered, renderLimit],
  );
  const hasMorePlugins = renderLimit < filtered.length;
  const handlePickCategory = (slug: string | null): void => {
    pickCategory(slug);
  };

  useEffect(() => {
    setRenderLimit(initialRenderLimit);
  }, [filtered, initialRenderLimit]);

  useEffect(() => {
    if (!hasMorePlugins) return;
    const node = loadMoreRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setRenderLimit(filtered.length);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setRenderLimit((limit) =>
          Math.min(filtered.length, limit + renderBatchSize),
        );
      },
      { rootMargin: loadMoreRootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [filtered.length, hasMorePlugins, loadMoreRootMargin, renderBatchSize]);

  function handleSavePlugin(record: InstalledPluginRecord): void {
    const result = savePluginId(record.id);
    const title = localizePluginTitle(locale, record);
    if (result === 'saved') {
      setSaveToast(`Saved ${title}.`);
    } else if (result === 'already-saved') {
      setSaveToast(`${title} is already saved.`);
    } else {
      setSaveToast('Could not save this plugin in this browser.');
    }
  }

  return (
    <section className="plugins-home" data-testid="plugins-home-section">
      <header className="plugins-home__head">
        <div className="plugins-home__heading">
          <h2 className="plugins-home__title">{title ?? t('pluginsHome.title')}</h2>
          {subtitle ? (
            <p className="plugins-home__subtitle">{subtitle}</p>
          ) : null}
        </div>
        <div className="plugins-home__head-tools">
          {onBrowseRegistry ? (
            <button
              type="button"
              className="plugins-home__linkbtn"
              onClick={onBrowseRegistry}
              data-testid="plugins-home-browse-registry"
            >
              {t('pluginsHome.browseRegistry')}
            </button>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="plugins-home__empty">{t('pluginsHome.loadingCatalog')}</div>
      ) : visiblePlugins.length === 0 ? (
        <div className="plugins-home__empty">
          {emptyMessage ?? t('pluginsHome.emptyCatalog')}
        </div>
      ) : (
        <>
          <div
            className="plugins-home__facets"
            role="group"
            aria-label="Plugin filters"
          >
            <CategoryRow
              options={catalog.category}
              selectedSlug={selection.category}
              totalVisible={totalVisible}
              // The Saved collection lives on the rich management surface
              // (PluginsView). The minimal Community gallery has no per-card
              // save affordance, so the orthogonal Saved chip is hidden there.
              showSaved={false}
              showIux
              iuxCount={Number(iuxTemplates?.length)}
              iuxActive={mode === 'iux'}
              savedCount={savedList.length}
              savedActive={mode === 'saved'}
              onToggleSaved={() =>
                setMode(mode === 'saved' ? 'all' : 'saved')
              }
              onToggleIux={() => {
                //setMode(mode === 'iux' ? 'all' : 'iux')
                handlePickCategory(null);
                setMode('iux');
                onToggleIux?.();
              }}
              showAll
              query={query}
              onQueryChange={setQuery}
              sortOrder={sortOrder}
              onSortOrderChange={setSortOrder}
              onPick={handlePickCategory}
            />
            {selection.category ? (
              <SubcategoryRow
                parent={catalog.category.find((opt) => opt.slug === selection.category)}
                options={catalog.subcategory[selection.category] ?? []}
                selectedSlug={selection.subcategory}
                onPick={pickSubcategory}
              />
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <div className="plugins-home__empty plugins-home__empty--filtered">
              {t('pluginsHome.emptyFiltered')}{' '}
              <button
                type="button"
                className="plugins-home__linkbtn"
                onClick={clearFacets}
              >
                {t('pluginsHome.clearFilters')}
              </button>
            </div>
          ) : filtered?.[0].files ? (
            <div
              className={`plugins-home__grid${cardLayout === 'gallery' ? ' plugins-home__grid--gallery' : ''}`}
              role="list"
            >
              {renderedPlugins.map((t: any) => (
                <TemplateCard
                  key={t.id}
                  record={t}
                  isActive={activePluginId === t.id}
                  onCreateProject={onCreateProject}
                  onOpenDetails={onOpenDetails}
                  onSave={handleSavePlugin}
                  onCancelShare={onCancelShare}
                  layout={cardLayout}
                />
              ))}
            </div>
          ) : (
            <div
              className={`plugins-home__grid${cardLayout === 'gallery' ? ' plugins-home__grid--gallery' : ''}`}
              role="list"
            >
              {renderedPlugins.map((p: any) => (
                <PluginCard
                  key={p.id}
                  record={p}
                  isActive={activePluginId === p.id}
                  isPending={pendingApplyId === p.id}
                  pendingAny={pendingApplyId !== null}
                  isDuplicatePending={pendingDuplicateId === p.id}
                  pendingDuplicateAny={pendingDuplicateId !== null}
                  pendingShareAction={pendingShareAction}
                  isFeatured={isFeaturedPlugin(p)}
                  isSaved={savedPluginIds.has(p.id)}
                  onUse={onUse}
                  onDuplicate={onDuplicate}
                  onOpenDetails={onOpenDetails}
                  onSave={handleSavePlugin}
                  onShareAction={onPluginShareAction}
                  layout={cardLayout}
                />
              ))}
              {hasMorePlugins ? (
                <div
                  ref={loadMoreRef}
                  className="plugins-home__load-more-sentinel"
                  aria-hidden
                />
              ) : null}
            </div>

          )
          }
        </>
      )}
      <AnimatePresence>
        {saveToast ? (
          <Toast
            message={saveToast}
            ttlMs={2200}
            onDismiss={() => setSaveToast(null)}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

interface CategoryRowProps {
  options: FacetOption[];
  selectedSlug: string | null;
  totalVisible: number;
  onPick: (slug: string | null) => void;
  // The Saved override chip only renders on the rich management surface
  // (PluginsView); the minimal Community gallery hides it.
  showIux: boolean;
  iuxCount: number;
  iuxActive: boolean;
  showSaved: boolean;
  savedCount: number;
  savedActive: boolean;
  onToggleSaved: () => void;
  onToggleIux: () => void;
  showAll: boolean;
  query: string;
  onQueryChange: (next: string) => void;
  sortOrder: PluginSortOrder;
  onSortOrderChange: (next: PluginSortOrder) => void;
}

// Single combined filter bar: an optional Saved override chip + category
// pills on the left, sort toggle + search field on the right. The "All"
// pill doubles as a clear-filters affordance, so a separate `X / Y`
// counter and `Clear` link would just repeat what the pill strip already
// shows.
function CategoryRow({
  options,
  selectedSlug,
  totalVisible,
  onPick,
  showIux,
  iuxCount,
  iuxActive,
  showSaved,
  savedCount,
  savedActive,
  onToggleSaved,
  onToggleIux,
  showAll,
  query,
  onQueryChange,
  sortOrder,
  onSortOrderChange,
}: CategoryRowProps) {
  const t = useT();
  if (options.length === 0) return null;
  return (
    <div
      className="plugins-home__facet-row plugins-home__facet-row--inline"
      data-testid="plugins-home-row-category"
    >
      <div
        className="plugins-home__facet-pills"
        role="tablist"
        aria-label={t('pluginsHome.categoryFilterAria')}
      >
        {showIux ? (
          <button
            type="button"
            className={[
              'plugins-home__pill',
              iuxActive ? 'is-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={onToggleIux}
            aria-pressed={savedActive}
            data-testid="plugins-home__pill-iux"
          >
            <Icon name="star" size={11} />
            <span>
              用户体验部
              {/* {t('pluginsHome.featured')} */}
            </span>
            <span className="plugins-home__pill-count">{iuxCount}</span>
          </button>
        ) : null}
        {!showIux && showSaved ? (
          <button
            type="button"
            className={[
              'plugins-home__chip',
              'plugins-home__chip--saved',
              savedActive ? 'is-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={onToggleSaved}
            aria-pressed={savedActive}
            data-testid="plugins-home-chip-saved"
          >
            <Icon name="star" size={11} />
            <span>{t('pluginsHome.featured')}</span>
            <span className="plugins-home__chip-count">{savedCount}</span>
          </button>
        ) : null}
        {/* {showAll ? (
          <CategoryPill
            slug={null}
            label={t('common.all')}
            count={totalVisible}
            active={selectedSlug === null}
            onPick={onPick}
            variant="all"
          />
        ) : null} */}
        {options.map((opt) => (
          <CategoryPill
            key={opt.slug}
            slug={opt.slug}
            label={opt.label}
            count={opt.count}
            active={selectedSlug === opt.slug}
            onPick={onPick}
          />
        ))}
      </div>
      <div className="plugins-home__facet-tools">
        <SortToggle value={sortOrder} onChange={onSortOrderChange} />
        <SearchInput value={query} onChange={onQueryChange} />
      </div>
    </div>
  );
}

interface SubcategoryRowProps {
  parent: FacetOption | undefined;
  options: FacetOption[];
  selectedSlug: string | null;
  onPick: (slug: string | null) => void;
}

function SubcategoryRow({ parent, options, selectedSlug, onPick }: SubcategoryRowProps) {
  const t = useT();
  if (!parent || options.length === 0) return null;
  return (
    <div
      className="plugins-home__facet-row plugins-home__facet-row--inline plugins-home__facet-row--sub"
      data-testid={`plugins-home-row-subcategory-${parent.slug}`}
    >
      <div
        className="plugins-home__facet-pills"
        role="tablist"
        aria-label={t('pluginsHome.subcategoryFilterAria', { label: parent.label })}
      >
        <CategoryPill
          slug={null}
          label={t('pluginsHome.allCategory', { label: pluginFacetLabel(parent.slug, parent.label, t) })}
          count={parent.count}
          active={selectedSlug === null}
          onPick={onPick}
          variant="sub-all"
          testId={`plugins-home-pill-subcategory-${parent.slug}-all`}
        />
        {options.map((opt) => (
          <CategoryPill
            key={opt.slug}
            slug={opt.slug}
            label={opt.label}
            count={opt.count}
            active={selectedSlug === opt.slug}
            onPick={onPick}
            testId={`plugins-home-pill-subcategory-${parent.slug}-${opt.slug}`}
          />
        ))}
      </div>
    </div>
  );
}

interface CategoryPillProps {
  slug: string | null;
  label: string;
  count: number;
  active: boolean;
  variant?: 'all' | 'sub-all';
  testId?: string;
  onPick: (slug: string | null) => void;
}

function CategoryPill({ slug, label, count, active, variant, testId, onPick }: CategoryPillProps) {
  const t = useT();
  const displayLabel = slug ? pluginFacetLabel(slug, label, t) : label;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={[
        'plugins-home__pill',
        active ? 'is-active' : '',
        variant === 'all' ? 'plugins-home__pill--all' : '',
        variant === 'sub-all' ? 'plugins-home__pill--sub-all' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onPick(slug)}
      // Planned child buckets stay visible even before the catalog
      // has examples for each scene. The `data-empty` flag gives
      // those zero-count buckets a lighter treatment without adding
      // placeholder cards to the starter grid.
      data-empty={count === 0 ? 'true' : 'false'}
      data-testid={testId ?? `plugins-home-pill-category-${slug ?? 'all'}`}
    >
      <span>{displayLabel}</span>
      <span className="plugins-home__pill-count">{count}</span>
    </button>
  );
}

function pluginFacetLabel(slug: string, fallback: string, t: ReturnType<typeof useT>): string {
  switch (slug) {
    case 'import': return t('pluginsHome.facet.import');
    case 'create': return t('pluginsHome.facet.create');
    case 'export': return t('pluginsHome.facet.export');
    case 'share': return t('pluginsHome.facet.share');
    case 'deploy': return t('pluginsHome.facet.deploy');
    case 'refine': return t('pluginsHome.facet.refine');
    case 'extend': return t('pluginsHome.facet.extend');
    case 'from-figma': return t('pluginsHome.facet.figma');
    case 'from-github': return t('pluginsHome.facet.github');
    case 'from-code': return t('pluginsHome.facet.codeFolder');
    case 'from-url': return t('pluginsHome.facet.url');
    case 'from-screenshot': return t('pluginsHome.facet.screenshot');
    case 'from-pdf': return t('pluginsHome.facet.pdf');
    case 'from-pptx': return t('pluginsHome.facet.pptx');
    case 'from-framer': return t('pluginsHome.facet.framer');
    case 'from-webflow': return t('pluginsHome.facet.webflow');
    case 'prototype': return t('homeHero.chip.prototype');
    case 'deck': return t('pluginsHome.facet.slides');
    case 'design-system': return t('entry.navDesignSystems');
    case 'hyperframes': return t('homeHero.chip.hyperframes');
    case 'image': return t('homeHero.chip.image');
    case 'video': return t('homeHero.chip.video');
    case 'audio': return t('homeHero.chip.audio');
    case 'public-link': return t('pluginsHome.facet.publicLink');
    case 'github-pr': return t('pluginsHome.facet.githubPr');
    case 'github-gist': return t('pluginsHome.facet.githubGist');
    // Subcategory pills render through the same CategoryPill, so unknown
    // top-level slugs fall through to the subfacet table before giving up.
    default: return pluginSubfacetLabel(slug, fallback, t);
  }
}

interface SortToggleProps {
  value: PluginSortOrder;
  onChange: (next: PluginSortOrder) => void;
}

// Hot / newest ordering toggle that lives next to the search field.
// Rendered as a compact two-segment radio group: "hot" keeps the
// visual-appeal ranking the gallery leads with today, "newest" re-ranks
// by record freshness. The picked order persists per browser via the
// hook (`sortOrder.ts`).
function SortToggle({ value, onChange }: SortToggleProps) {
  const t = useT();
  const segments: Array<{ order: PluginSortOrder; label: string }> = [
    { order: 'hot', label: t('pluginsHome.sortHot') },
    { order: 'newest', label: t('pluginsHome.sortNewest') },
  ];
  return (
    <div
      className="plugins-home__sort"
      role="radiogroup"
      aria-label={t('pluginsHome.sortAria')}
      data-testid="plugins-home-sort"
    >
      {segments.map((segment) => (
        <button
          key={segment.order}
          type="button"
          role="radio"
          aria-checked={value === segment.order}
          className={`plugins-home__sort-segment${value === segment.order ? ' is-active' : ''}`}
          onClick={() => onChange(segment.order)}
          data-testid={`plugins-home-sort-${segment.order}`}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}

interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
}

// Compact search field that lives in the section head. Search composes
// with the category selection via AND inside the hook, so a query
// narrows whatever category the user has already picked rather than
// discarding the category context. We keep the UI a single text input
// with an optional clear button so it sits inside the existing head
// row without a heavyweight toolbar.
function SearchInput({ value, onChange }: SearchInputProps) {
  const t = useT();
  return (
    <div className="plugins-home__search">
      <Icon name="search" size={12} className="plugins-home__search-icon" />
      <Input
        type="search"
        className="plugins-home__search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('pluginsHome.searchPlaceholder')}
        aria-label={t('pluginsHome.searchAria')}
        data-testid="plugins-home-search"
        spellCheck={false}
        autoComplete="off"
      />
      {value ? (
        <Button
          variant="subtle"
          className="plugins-home__search-clear"
          onClick={() => onChange('')}
          aria-label={t('pluginsHome.clearSearch')}
          data-testid="plugins-home-search-clear"
        >
          <Icon name="close" size={12} />
        </Button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// Template card (mirrors PluginCard for template records with `files`)
// ------------------------------------------------------------------

interface TemplateRecord {
  id: string;
  name: string;
  sourceProjectId: string;
  files: Array<{ name: string }>;
  createdAt: number;
  username?: string;
}

interface TemplateCardProps {
  record: TemplateRecord;
  isActive: boolean;
  onCreateProject?: (input: any) => Promise<boolean> | boolean | void | undefined;
  onOpenDetails?: (record: any,type?:string) => void;
  onSave?: (record: any) => void;
  onCancelShare?: (record: TemplateRecord) => void;
  layout?: 'rich' | 'gallery';
}

function TemplateCard({
  record,
  isActive,
  onCreateProject,
  onOpenDetails,
  onSave,
  onCancelShare,
  layout = 'rich',
}: TemplateCardProps) {
  const { t } = useI18n();
  const { username } = useAuth();
  const [cancelToast, setCancelToast] = useState<string | null>(null);
  const [cancelToastTone, setCancelToastTone] = useState<'success' | 'error'>('success');
  const title = record.name;
  const fileCount = record.files.length;
  const isFinished = useRef(false);
  const homeFile: any =
    record.files?.find((f: any) => f.home) || record.files?.[0] || null;

  async function handleCreateIuxTemplate() {
    const input = {
      "name": record.name,
      "skillId": null,
      "designSystemId": null,//"default",
      "metadata": {
        "kind": "template",
        "platform": "responsive",
        "platformTargets": [
          "responsive"
        ],
        "animations": false,
        "templateId": record.id,
        "templateLabel": record.name,
        "nameSource": "user",
        "group":"iux"
      },
      "pluginId": "od-new-generation",
      "pluginInputs": {
        "artifactKind": "artifact based on a saved template",
        "audience": "product and design reviewers",
        "topic": record.name
      }
    }
    isFinished.current = true;
    let status = await onCreateProject?.(input);
    isFinished.current = false;
    // console.log('我拿到创建函数参数了吗？', input);
  }

  async function handleCancelShare(event: React.MouseEvent) {
    event.stopPropagation();
    try {
      const resp = await fetch(`${AI_BUILDER_WEB_PREX}/webapi/v1/od/template`, {
        method: 'POST',
        body: JSON.stringify({
          sourceProjectId: record.sourceProjectId,
          isDelete: true,
          username,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (resp.ok) {
        setCancelToast('取消分享成功!');
        setCancelToastTone('success');
        onCancelShare?.(record);
      } else {
        setCancelToast('取消分享失败!');
        setCancelToastTone('error');
      }
    } catch (err) {
      console.warn('[handleCancelShare] cancel failed:', err);
      setCancelToast('取消分享失败!');
      setCancelToastTone('error');
    }
  }
  if (layout === 'gallery') {
    return (
      <article
        role="listitem"
        className={[
          'plugins-home__card',
          'plugins-home__card--gallery',
          isActive ? 'is-active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-template-id={record.id}
        onClick={() => {
          onOpenDetails?.(record,'iux')
        }
        }
      >
        <div className="recent-projects__card-thumb">
          {/* <div className="plugins-home__gallery-preview-placeholder">
            <Icon name="file" size={24} />
            <span className="plugins-home__gallery-preview-label">
              {fileCount} files
            </span>
          </div> */}
          {record.username && record.username === username && (
            <div className="plugins-home__card-owner-badge">
              <span className="plugins-home__card-owner-text">我</span>
            </div>
          )}
          {homeFile && (
            <HtmlProjectCoverFrame
              src={AI_BUILDER_WEB_PREX + homeFile.path}
              initial={homeFile.initial}
              iframeClassName="recent-projects__thumb-iframe"
              glyphClassName="project-thumb-glyph"
              diagnostic="unknown"
            />
          )}
          <div className="plugins-home__gallery-actions"
            style={{ justifyContent: 'center' }}
          >
            
            <button
              style={{ width: "50%", flex: 'none' }}
              type="button"
              className="plugins-home__action plugins-home__action--primary"
              disabled={isFinished.current}
              onClick={(event) => {
                event.stopPropagation();
                //pickUseAction('use');
                handleCreateIuxTemplate();
              }}
            >
              <Icon name={isFinished.current ? 'spinner' : 'play'} size={12} />
              <span>{isFinished.current?'正在创建':'立刻使用'}</span>
            </button>
            {record.username && record.username === username && (
            <button
              style={{ width: "50%", flex: 'none' }}
              type="button"
              className="plugins-home__action"
              disabled={isFinished.current}
              onClick={handleCancelShare}
            >
              <Icon name={isFinished.current ? 'spinner' : 'close'} size={12} />
              <span>取消分享</span>
            </button>
            )}
          </div>
        </div>

        <div className="plugins-home__gallery-bar">
          <div className="plugins-home__gallery-bar-row">
            <span className="plugins-home__gallery-dot" aria-hidden />
            <button
              type="button"
              className="plugins-home__gallery-name"
              title={title}
              onClick={(event) => {
                event.stopPropagation();
                //onOpenDetails?.(record);
              }}
            >
              {title}
            </button>
          </div>
          <p className="plugins-home__gallery-desc" title={record.name}>
            {record.name}
          </p>
        </div>
        <AnimatePresence>
          {cancelToast ? (
            <Toast
              message={cancelToast}
              tone={cancelToastTone}
              ttlMs={2200}
              onDismiss={() => setCancelToast(null)}
            />
          ) : null}
        </AnimatePresence>
      </article>
    );
  }

  return (
    <article
      role="listitem"
      className={[
        'plugins-home__card',
        isActive ? 'is-active' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-template-id={record.id}
    >
      <div className="plugins-home__card-overlay">
        <div className="plugins-home__card-overlay-top">
          <span className="plugins-home__overlay-title" title={title}>
            {title}
          </span>
        </div>
        <div className="plugins-home__card-overlay-body">
          <p className="plugins-home__overlay-desc">
            {homeFile?.name}
            {fileCount > 1 ? ` +${fileCount - 1}` : ''}
          </p>
        </div>
        <div className="plugins-home__overlay-actions">
          <button
            type="button"
            className="plugins-home__action plugins-home__action--secondary"
            onClick={() =>
              onOpenDetails?.(record as unknown as InstalledPluginRecord)
            }
          >
            <Icon name="eye" size={12} />
            <span>{t('pluginCard.details')}</span>
          </button>
          <button
            type="button"
            className="plugins-home__action plugins-home__action--primary"
            onClick={() =>
              onOpenDetails?.(record as unknown as InstalledPluginRecord)
            }
          >
            <Icon name="play" size={12} />
            <span>{t('pluginCard.use')}</span>
          </button>
        </div>
      </div>

      <div className="plugins-home__card-foot">
        <button
          type="button"
          className="plugins-home__card-save"
          onClick={() => onSave?.(record as unknown as InstalledPluginRecord)}
          aria-label={t('common.save')}
        >
          <Icon name="star" size={12} />
        </button>
        <span className="plugins-home__card-title" title={title}>
          <span className="plugins-home__card-title-text">{title}</span>
        </span>
      </div>
    </article>
  );
}
