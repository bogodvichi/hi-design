import { PageEmptyState } from './PageEmptyState';
// Horizontal "Recent projects" rail for the Home view.
//
// Mirrors the strip Lovart shows under its hero: a small set of
// recent project cards with a "View all" link that switches to the
// full Projects view. We keep the data shape narrow (Project[] +
// onOpen / onViewAll) so the strip can be reused later by other
// surfaces (e.g. an in-project quick-switcher pane).

import type { CSSProperties, ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';

import { useT } from '../i18n';
import { avatarColorForDisplayName } from '../utils/avatarColor';
import { getStoredUsername } from '../auth/auth';
import { getSharedSpaceMemberId, getTeamMemberId } from '../utils/deterministicId';
import { MoveToTeamTreeDialog, type TeamTreeSelection } from './MoveToTeamTreeDialog';
import {
  fetchProjectFiles,
  fetchProjectFileText,
  invalidateProjectFilesCache,
} from '../providers/registry';
import type { DesignSystemSummary, Project, ProjectDisplayStatus, ProjectFile } from '../types';
import { Icon } from './Icon';
import { UnifiedShareDialog } from './UnifiedShareDialog';
import { InviteDialog } from './InviteDialog';
import { STATUS_LABEL_KEYS } from './DesignsTab';
import { isDesignSystemProject, isPublishedDesignSystemProject } from './design-system-project';
import type { SharedProjectPredicate } from '../collab/all-projects-list';
import {
  notifyTeamProjectsChanged,
  resolveBoundProjectWorkspaceContext,
  useWorkspaceContext,
  useSharedSpaceTeamId,
} from '../collab/useWorkspaceContext';
import {
  canAccessWorkspaceInviteFlow,
  resolveWorkspaceInviteTarget,
} from './EntryNavRail';
import {
  copyProjectToPersonal,
  moveWorkspaceProject,
  workspaceProjectMoveErrorCode,
} from '../state/projects';
import {
  workspaceContextHasTeamIdentity,
  type WorkspaceCollabContext,
  type WorkspaceProjectSummary,
} from '@open-design/contracts';
import { currentUserDirectoryEntry, useTeamMembers } from '../collab/useTeamMembers';
import { useWorkspaceInvalidation } from '../collab/workspace-events';
import {
  THUMBNAIL_OVERSCAN_MARGIN,
  resumeThumbnailLoads,
  suspendThumbnailLoads,
  useThumbnailLoadSlot,
} from '../lib/thumbnail-load-gate';
import {
  getProjectCoverSnapshot,
  invalidateProjectCoverSnapshots,
  projectCoverSnapshotKey,
  setProjectCoverSnapshot,
} from '../lib/project-cover-cache';
import { useInView } from './plugins-home/useInView';
import { resolveFloatingMenuHorizontalAlign } from '../utils/floating-menu-placement';
import { ellipsisTitleHoverProps } from '../utils/ellipsis-title';
import { Toast } from './Toast';
import {
  workspaceIdentityCacheKey,
  workspaceProjectHeaders,
} from '../collab/workspace-identity';
import { useAnalytics } from '../analytics/provider';
import {
  trackProjectCollectionClick,
  trackWorkspaceProjectActionResult,
  trackWorkspaceSharedProjectOpenResult,
} from '../analytics/events';
import {
  countBucket,
  stableAnalyticsRequestErrorCode,
  workspaceAnalyticsDimensions,
} from '../analytics/workspace';
import type { ProjectCollectionClickProps } from '@open-design/contracts/analytics';
import {
  clearProjectLocationTarget,
  readProjectLocationTarget,
} from '../lib/recently-opened-projects';

/** Which project space this strip renders. Drives the per-card 共享 badge
 *  (hidden in the all-shared team space) and the "{creator}创建" line: 'recent'
 *  = home's mixed private/shared, 'drafts' = the member's own private list
 *  (still shows the self-owner chip on the bottom-left), 'team' = the全部项目
 *  grid where every card is a team-shared project. */
export type SpaceKind = 'recent' | 'drafts' | 'team';
/** Operator identity for HDW-backed team spaces. When provided, resolveCreator
 *  uses this memberId/role instead of the OpenDesign workspace-collab context,
 *  because HDW team projects carry HDW member IDs that do not match the
 *  OpenDesign collab workspace member ID. */
export interface TeamSpaceOperator {
  memberId: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
}

/** Lets a parent-owned collection (for example folder cards rendered above
 * this strip) participate in the same multi-select session and bulk bar. */
export interface CollectionSelectionExtension {
  selectedCount: number;
  selectedLabels?: readonly string[];
  /** Lets a parent-owned selection explicitly block the shared move action
   * when that collection type cannot participate in the requested move. */
  blocksMove?: boolean;
  /** Keep failed personal-folder selections available for a recovery attempt. */
  preserveFailedMoveSelection?: boolean;
  onMoveSelected?: (
    action: 'to-team' | 'to-personal',
    options?: { targetWorkspaceId?: string; targetFolderId?: string | null },
  ) => Promise<number>;
  moveTreeMode?: 'team' | 'personal-folders' | 'tabbed' | 'unified';
  canMoveToTeam?: boolean;
  canMoveToPersonal?: boolean;
  restrictMoveToWorkspaceId?: string | null;
  disabledMoveKeys?: ReadonlySet<string>;
  moveDialogTitle?: string;
  moveTreeDescription?: string;
  moveRootSelectedLabel?: string;
  /** Hide bulk delete when the parent-owned selection contains non-deletable items. */
  hideDelete?: boolean;
  /** Delete the parent-owned selected items and return how many succeeded. */
  onDeleteSelected?: () => Promise<number>;
  onModeChange?: (active: boolean) => void;
  onClear?: () => void;
}
import {
  coverFromProjectFile,
  projectCoverUrl,
  projectFallbackVisual,
  selectProjectFileCover,
  type ProjectCoverOverride,
} from './project-cover';

interface Props {
  projects: Project[];
  /** Used only to show a "Published" status for design-system projects whose
   *  backing system is published (independent of the project's run status). */
  designSystems?: DesignSystemSummary[];
  /** Retained for call-site compatibility; the strip skips rendering
   *  while the list is loading so we never need a loading state. */
  loading?: boolean;
  /** Optional page-specific empty content; controls remain mounted. */
  emptyContent?: ReactNode;
  /** Full-page project grids render their own title + controls. The Home strip
   *  omits this and keeps the compact "最近项目 / 查看全部" header. */
 heading?: string;
 description?: string;
  /** The workspace ID this strip's projects belong to. Required for
   * "分享" to know the project's home workspace. */
  homeWorkspaceId?: string | null;
  /** Return false when opening failed and the grid stayed mounted, so aborted
   * background cover work can resume after the foreground attempt finishes. */
  onOpen: (id: string) => boolean | void | Promise<boolean | void>;
  onViewAll?: () => void;
  /** Recent-projects-only: navigate to the project's current owning folder. */
  onOpenLocation?: (id: string) => boolean | void | Promise<boolean | void>;
  /** Recent-projects-only: remove only the recent-history record. */
  onRemoveRecent?: (id: string) => void;
  onDelete?: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicate?: (id: string) => Promise<void> | void;
  onRename?: (id: string, name: string) => void;
  limit?: number;
  /** The one shared-state answer for a card: true → 共享 badge + "已在团队空间",
   *  and the card cannot be re-shared. Owned by the caller, because the SAME
   *  answer decides which of the 全部项目 / 草稿 grids the project belongs to —
   *  see {@link createSharedProjectPredicate}. This strip must not re-derive it;
   *  a strip-local optimistic set is exactly how the badge and the grids drifted
   *  apart. Defaults to "nothing is shared" when a caller has no sharing surface. */
  isSharedProject?: SharedProjectPredicate;
  /** Reported after a successful share/unshare so the caller can fold the change
   *  into its optimistic layer before the team-projects poll catches up. */
  onProjectShared?: (project: WorkspaceProjectSummary) => void;
  /** Clears any optimistic owner proof when a share did not commit. */
  onProjectShareFailed?: (projectId: string) => void;
  onProjectUnshared?: (projectId: string) => void;
  /** Which space this strip renders (see {@link SpaceKind}). Defaults to
   *  'recent' (home). 'team' hides the per-card 共享 badge since every card
   *  there is already a team-shared project. */
  space?: SpaceKind;
  /** Forces the top-left project badge without changing the space's ownership
   *  or mutation behavior. Shared-with-me reuses team-series cards but every
   *  item is still shared with the viewer. */
  badgeOverride?: 'shared';
  /** Shared-with-me rows can originate from different owner workspaces. Resolve
   *  each project's source workspace for link sharing without pretending the
   *  viewer is a member of that workspace. */
  sharedWithMeHomeWorkspaceId?: (projectId: string) => string | null;
  /** Remove only the viewer's shared-with-me access record. This is deliberately
   *  separate from onDelete, which deletes a project resource. */
  onRemoveSharedWithMe?: (projectId: string) => void;
  /** projectId → the sharing member's workspaceMemberId, for team-shared
   *  projects (from the team hub). Used to resolve the creator name against the
   *  member directory; a project absent from this map is a local project owned
   *  by the current member ("我创建"). */
 projectOwnerMemberIds?: ReadonlyMap<string, string>;
 /** projectId → the owning member's display name, for team-shared projects
  *  (from the team hub). Used to show the real owner's name on cards the
  *  current user did not create. */
 projectOwnerDisplayNames?: ReadonlyMap<string, string>;
 /** Project currently being materialized before it can open (a member's
   *  first click on a team-shared card triggers a full content pull). The
   *  card shows a spinner overlay and further clicks are ignored — without
   *  this the pull looked like a dead click for its whole duration. */
  openingProjectId?: string | null;
  collaborationEnabled?: boolean;
  canAssignInviteRoles?: boolean;
  canManageProjectCollection?: boolean;
  /** Whether this mounted strip is visible. EntryShell keeps Home mounted while
   * other views are active, so hidden strips must not occupy browser connection
   * slots with background cover probes. */
 isActive?: boolean;
 /** When true, only the title/description block is hidden — the controls
  *  (multi-select, filters, sort, view toggle) remain visible. */
hideTitle?: boolean;
/** When true, the controls bar shows only the search input and the
 *  grid/list view toggle plus sort — multi-select and owner filter are
 *  hidden. Used by /share-me where the viewer has read-only access. */
minimalControls?: boolean;
/** External search query. When provided, the strip uses this value instead
 *  of its internal search state (used with hideHeader to move search to the
 *  parent view's header). */
externalSearchQuery?: string;
/** The workspace ID the current view belongs to. Used to compute the
 *  disabled tree node when moving within the same workspace (so the
 *  current folder/root cannot be selected as its own destination). */
currentWorkspaceId?: string | null;
/** The folder ID the current view is inside, or null/undefined for the
 *  workspace root. Used together with currentWorkspaceId to disable the
 *  current location in the move-to tree dialog. */
currentFolderId?: string | null;
/** When provided, the controls (search, filters, sort, view toggle) are
 *  portaled into this element instead of rendering inside the strip's
 *  own header. Used by full-page views (personal-all, team) to place
 *  controls inline with the type tabs row. */
controlsPortalTarget?: HTMLElement | null;
/** When provided, the multi-select toolbar renders in this parent-owned slot.
 * Full-page folder views use it to keep the toolbar directly below the page
 * controls and above folder cards. */
bulkbarPortalTarget?: HTMLElement | null;
/** HDW team-space operator identity (member ID + role). When provided,
 *  resolveCreator uses this instead of the OpenDesign workspace-collab context
 *  to determine ownership and mutation rights, because HDW team projects carry
 *  HDW member IDs that do not match the OpenDesign collab member ID. */
operator?: TeamSpaceOperator | null;
/** Optional sibling collection that shares this strip's selection toolbar. */
selectionExtension?: CollectionSelectionExtension;
}

const EMPTY_DESIGN_SYSTEMS: DesignSystemSummary[] = [];
const EMPTY_MEMBER_MAP: ReadonlyMap<string, string> = new Map();
/** Fallback for a caller with no sharing surface (no workspace, no grids). */
const NOTHING_SHARED: SharedProjectPredicate = () => false;
type DictKey = Parameters<ReturnType<typeof useT>>[0];

type OwnerFilter = 'all' | 'mine' | 'others';
type ProjectSort = 'recentViewed' | 'updatedDesc' | 'updatedAsc' | 'nameAsc';

const OWNER_FILTER_OPTIONS: Array<{ id: OwnerFilter; labelKey: DictKey }> = [
  { id: 'all', labelKey: 'recentProjects.ownerAll' },
  { id: 'mine', labelKey: 'recentProjects.ownerMine' },
  { id: 'others', labelKey: 'recentProjects.ownerOthers' },
];

const SORT_OPTIONS: Array<{ id: ProjectSort; labelKey: DictKey }> = [
  { id: 'updatedDesc', labelKey: 'recentProjects.sortNewest' },
  { id: 'updatedAsc', labelKey: 'recentProjects.sortOldest' },
  { id: 'nameAsc', labelKey: 'recentProjects.sortName' },
];
const RECENT_SORT_OPTIONS: Array<{ id: ProjectSort; labelKey: DictKey }> = [
  { id: 'recentViewed', labelKey: 'recentProjects.sortRecentlyViewed' },
  ...SORT_OPTIONS,
];


const DECK_PREVIEW_WIDTH = 1280;
const DECK_PREVIEW_HEIGHT = 720;
// Deck covers are fetched once per artifact URL and shared by every card that
// points at it: the parsed srcDoc is cached, and concurrent mounts join the
// same in-flight request instead of re-fetching.
const deckCoverCache = new Map<string, string>();
const deckCoverInflight = new Map<string, Promise<string>>();
const DEFAULT_RECENT_PROJECT_LIMIT = 6;
const WIDE_RECENT_PROJECT_LIMIT = 7;
const PROJECT_MENU_GAP = 6;
const PROJECT_MENU_VIEWPORT_MARGIN = 24;
// Card covers are background decoration. Browsers commonly allow only six
// concurrent connections per origin, so an unbounded All Projects scan can
// occupy every slot and queue the project file list/preview the user just
// opened. Two cover probes keep the grid moving while reserving capacity for
// foreground reads.
const MAX_BACKGROUND_COVER_REQUESTS = 2;
// 7 * 180px cards + 6 * 12px gaps, matching recent-projects.css.
const WIDE_RECENT_PROJECT_MIN_ROW_WIDTH = 1332;

type BackgroundTask<T> = {
  controller: AbortController;
  run: () => Promise<T>;
  resolve: (value: T | undefined) => void;
  reject: (reason: unknown) => void;
  started: boolean;
  released: boolean;
  settled: boolean;
};

class BackgroundTaskQueue {
  private active = 0;
  private readonly pending: BackgroundTask<unknown>[] = [];
  private pauseDepth = 0;

  constructor(private readonly concurrency: number) {}

  schedule<T>(
    controller: AbortController,
    run: () => Promise<T>,
    priority = false,
  ): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      const task: BackgroundTask<T> = {
        controller,
        run,
        resolve,
        reject,
        started: false,
        released: false,
        settled: false,
      };
      const abort = () => {
        if (task.settled) return;
        task.settled = true;
        task.resolve(undefined);
        this.release(task);
        this.drain();
      };
      controller.signal.addEventListener('abort', abort, { once: true });
      // Store listener cleanup on the promise path without expanding the
      // queue's public contract. A settled task's one-shot abort listener is
      // harmless, but removing it avoids retaining component closures.
      task.run = async () => {
        try {
          return await run();
        } finally {
          controller.signal.removeEventListener('abort', abort);
        }
      };
      if (priority) {
        this.pending.unshift(task as BackgroundTask<unknown>);
      } else {
        this.pending.push(task as BackgroundTask<unknown>);
      }
      this.drain();
    });
  }

  withoutDraining(run: () => void): void {
    this.pauseDepth += 1;
    try {
      run();
    } finally {
      this.pauseDepth -= 1;
      this.drain();
    }
  }

  private release<T>(task: BackgroundTask<T>): void {
    if (task.started && !task.released) {
      task.released = true;
      this.active -= 1;
      return;
    }
    if (!task.started) {
      const index = this.pending.indexOf(task as BackgroundTask<unknown>);
      if (index >= 0) this.pending.splice(index, 1);
    }
  }

  private drain(): void {
    if (this.pauseDepth > 0) return;
    while (this.active < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift()!;
      if (task.settled || task.controller.signal.aborted) continue;
      task.started = true;
      this.active += 1;
      void task.run().then(
        (value) => {
          if (task.settled) return;
          task.settled = true;
          task.resolve(value);
          this.release(task);
          this.drain();
        },
        (error) => {
          if (task.settled) return;
          task.settled = true;
          task.reject(error);
          this.release(task);
          this.drain();
        },
      );
    }
  }
}

export function RecentProjectsStrip({
  projects,
  loading = false,
  emptyContent,
  designSystems = EMPTY_DESIGN_SYSTEMS,
  heading,
  description,
  homeWorkspaceId,
  onOpen,
  onViewAll,
  onOpenLocation,
  onRemoveRecent,
  onDelete,
  onDuplicate,
  onRename,
  limit,
  isSharedProject,
  onProjectShared,
  onProjectShareFailed,
  onProjectUnshared,
  space = 'recent',
  badgeOverride,
  sharedWithMeHomeWorkspaceId,
  onRemoveSharedWithMe,
 projectOwnerMemberIds,
 projectOwnerDisplayNames,
 openingProjectId = null,
  collaborationEnabled,
  canAssignInviteRoles,
 canManageProjectCollection,
isActive = true,
hideTitle = false,
minimalControls = false,
externalSearchQuery,
currentWorkspaceId,
currentFolderId,
controlsPortalTarget,
bulkbarPortalTarget,
operator,
selectionExtension,
}: Props) {
  const t = useT();
  const analytics = useAnalytics();
  const analyticsPage = space === 'drafts' ? 'drafts' : space === 'team' ? 'all_projects' : 'home';
  const rowRef = useRef<HTMLDivElement | null>(null);
  const {
    context: workspaceContext,
    loading: workspaceContextLoading,
  } = useWorkspaceContext();
  const { resolve: resolveTeamMember } = useTeamMembers(
    currentUserDirectoryEntry(workspaceContext),
  );
  const sharedSpaceTeamId = useSharedSpaceTeamId();
  // A cover request captures the complete identity at dispatch. A mutable ref
  // keeps the queue callbacks stable without letting an in-flight read drift
  // to whichever Workspace a different render happens to select later.
  const workspaceContextRef = useRef(workspaceContext);
  workspaceContextRef.current = workspaceContext;
  const workspaceContextLoadingRef = useRef(workspaceContextLoading);
  workspaceContextLoadingRef.current = workspaceContextLoading;
  const workspaceIdentity = workspaceIdentityCacheKey(workspaceContext);
  const workspaceDimensions = workspaceAnalyticsDimensions(workspaceContext);
  function trackCollection(
    element: ProjectCollectionClickProps['element'],
    properties: Partial<Omit<ProjectCollectionClickProps, 'page_name' | 'area' | 'element'>> = {},
    requestId?: string,
  ) {
    trackProjectCollectionClick(analytics.track, {
      page_name: analyticsPage,
      area: 'project_collection',
      element,
      ...workspaceDimensions,
      ...properties,
    }, requestId ? { requestId } : undefined);
  }
  const selfMemberId = workspaceContext?.workspaceMemberId ?? null;
  const contextWorkspaceId = workspaceContext?.workspaceId ?? null;
  // Team-project ownership uses HDW deterministic member IDs, while
  // WorkspaceCollabContext can expose a different member-ID namespace.
  // Resolve the current user's owner ID in the same namespace as each
  // project's createdByWorkspaceMemberId before comparing ownership.
  const [selfOwnerMemberIdsByWorkspace, setSelfOwnerMemberIdsByWorkspace] = useState<
    ReadonlyMap<string, string>
  >(EMPTY_MEMBER_MAP);
  useEffect(() => {
    const username = getStoredUsername()?.trim();
    if (!username) {
      setSelfOwnerMemberIdsByWorkspace(EMPTY_MEMBER_MAP);
      return;
    }
    const workspaceIds = new Set<string>();
    for (const project of projects) {
      const wid = project.workspaceId?.trim();
      if (wid) workspaceIds.add(wid);
    }
    if (sharedSpaceTeamId) workspaceIds.add(sharedSpaceTeamId);
    if (workspaceIds.size === 0) {
      setSelfOwnerMemberIdsByWorkspace(EMPTY_MEMBER_MAP);
      return;
    }
    let cancelled = false;
    void (async () => {
      const resolved = new Map<string, string>();
      await Promise.all([...workspaceIds].map(async (wid) => {
        try {
          const memberId = wid === sharedSpaceTeamId
            ? await getSharedSpaceMemberId(username)
            : await getTeamMemberId(wid, username);
          if (memberId) resolved.set(wid, memberId);
        } catch {
          // Leave unresolved; ownership then stays fail-closed.
        }
      }));
      if (!cancelled) setSelfOwnerMemberIdsByWorkspace(resolved);
    })();
    return () => { cancelled = true; };
  }, [projects, sharedSpaceTeamId]);
  // Resolve the current user's owner ID for the project's own workspace.
  // operator is already HDW-scoped and remains the authority in team views.
  const resolveProjectMemberId = useCallback(
    (project: Project): string | null => {
      if (operator?.memberId) return operator.memberId;
      const wid = project.workspaceId?.trim();
      if (wid) {
        return selfOwnerMemberIdsByWorkspace.get(wid)
          ?? (wid === contextWorkspaceId ? selfMemberId : null);
      }
      if (sharedSpaceTeamId) {
        return selfOwnerMemberIdsByWorkspace.get(sharedSpaceTeamId) ?? selfMemberId;
      }
      return selfMemberId;
    },
    [
      contextWorkspaceId,
      operator?.memberId,
      selfMemberId,
      selfOwnerMemberIdsByWorkspace,
      sharedSpaceTeamId,
    ],
  );
  // `canShareProjects` alone is a ROLE permission ("could this member share IF
  // a team existed"), not a "does a team exist" signal — a purely personal
  // workspace's owner still gets `canShareProjects: true`. Without also
  // requiring `workspaceContextHasTeamIdentity`, this stayed true for a
  // personal-only workspace and the move-to-team menu item rendered a button
  // the daemon can only ever 403 (recvqfZsR901YQ "无法共享方案了" /
  // recvqgif6Xa7Wb "隐藏非 Team workspace 分享到团队的入口") — the exact class
  // of bug `workspaceContextHasTeamIdentity`'s own doc comment warns about:
  // "Deriving it twice is how a UI grows a button that can only ever fail."
  const collaborationAvailable =
    collaborationEnabled ??
    (workspaceContextHasTeamIdentity(workspaceContext) &&
      workspaceContext?.permissions.canShareProjects === true);
  const canAccessInviteFlow = canAccessWorkspaceInviteFlow(workspaceContext);
  const inviteTarget = resolveWorkspaceInviteTarget(workspaceContext);
  const canManageCollection =
    canManageProjectCollection ??
    (workspaceContext?.permissions.canManageSharedResources === true ||
      workspaceContext?.permissions.canShareProjects === true);
  const [responsiveLimit, setResponsiveLimit] = useState(DEFAULT_RECENT_PROJECT_LIMIT);
  const resolvedLimit = limit ?? responsiveLimit;
  const hasRecentProjects = projects.length > 0;
  const fullPageGrid = heading !== undefined || description !== undefined || space !== 'recent';
  const showOwnerFilter = space !== 'drafts';
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  // The home recent feed is already sorted by true openedAt timestamps upstream.
  // Expose that order as an explicit default sort option without changing other lists.
  const sortOptions = space === 'recent' ? RECENT_SORT_OPTIONS : SORT_OPTIONS;
  const [sort, setSort] = useState<ProjectSort>(() =>
    space === 'recent' ? 'recentViewed' : 'updatedDesc',
  );
 const [searchQuery, setSearchQuery] = useState('');
 const effectiveSearchQuery = externalSearchQuery ?? searchQuery;
  const [openHeaderMenu, setOpenHeaderMenu] = useState<'owner' | 'sort' | null>(null);
  const [headerMenuAlign, setHeaderMenuAlign] = useState<'start' | 'end'>('start');
  const ownerFilterWrapRef = useRef<HTMLDivElement | null>(null);
  const sortFilterWrapRef = useRef<HTMLDivElement | null>(null);
  const headerMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  useLayoutEffect(() => {
    if (!openHeaderMenu) return;
    const anchor = openHeaderMenu === 'owner'
      ? ownerFilterWrapRef.current
      : sortFilterWrapRef.current;
    const menu = headerMenuPanelRef.current;
    const trigger = anchor?.querySelector<HTMLElement>(':scope > button');
    if (!anchor || !menu || !trigger) return;

    const measure = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      setHeaderMenuAlign(resolveFloatingMenuHorizontalAlign({
        triggerLeft: triggerRect.left,
        triggerRight: triggerRect.right,
        menuWidth: menuRect.width,
        viewportWidth: window.innerWidth || document.documentElement.clientWidth,
        preferred: openHeaderMenu === 'sort' ? 'end' : 'start',
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
  }, [openHeaderMenu]);

  useEffect(() => {
    if (limit !== undefined) return;

    const update = () => {
      const rowWidth = rowRef.current?.getBoundingClientRect().width;
      if (rowWidth === undefined) {
        setResponsiveLimit(DEFAULT_RECENT_PROJECT_LIMIT);
        return;
      }
      setResponsiveLimit(
        rowWidth >= WIDE_RECENT_PROJECT_MIN_ROW_WIDTH
          ? WIDE_RECENT_PROJECT_LIMIT
          : DEFAULT_RECENT_PROJECT_LIMIT,
      );
    };

    update();
    const node = rowRef.current;
    if (node && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update);
      observer.observe(node);
      return () => observer.disconnect();
    }

    if (typeof window === 'undefined') return;

    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [hasRecentProjects, limit]);

  const sortedProjects = useMemo(() => {
    if (sort === 'recentViewed') return projects;
    return [...projects].sort((a, b) => {
      if (sort === 'updatedAsc') return a.updatedAt - b.updatedAt;
      if (sort === 'nameAsc') return a.name.localeCompare(b.name);
      return b.updatedAt - a.updatedAt;
    });
  }, [projects, sort]);
  const [coverByProject, setCoverByProject] = useState<
    Record<string, ProjectCoverOverride | null>
  >({});
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<'down' | 'up'>('down');
 const [renameTarget, setRenameTarget] = useState<{ id: string; original: string } | null>(null);
 const [renameInput, setRenameInput] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<Project | null>(null);
  const [sharedSpaceTarget, setSharedSpaceTarget] = useState<Project | null>(null);
  const [copyToPersonalTarget, setCopyToPersonalTarget] = useState<Project | null>(null);
  const [copyPendingId, setCopyPendingId] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [locationTargetId, setLocationTargetId] = useState<string | null>(null);
  // recvqbh189zBY6: commitDelete used to await onDelete and drop the result on
  // the floor either way — a 403/network failure closed the dialog exactly
  // like a success, leaving the project right where it was with no signal
  // that anything went wrong. Track failure so the dialog can stay open and
  // say so instead of silently doing nothing.
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  // Project → team-space sharing (the project card entry). The daemon gates on
  // `canShareProjects` (403 off-team / no rights), so we only badge on success.
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [unsharingId, setUnsharingId] = useState<string | null>(null);
  const [shareErrorProjectId, setShareErrorProjectId] = useState<string | null>(null);
  // 'owner-conflict' is the daemon's TEAM_PROJECT_OWNER_CONFLICT refusal: the
  // team hub already registers this project under another member's ownership.
  // That state is permanent until the registered owner unshares, so it gets
  // its own message instead of the retryable 'share' hint.
  const [shareErrorKind, setShareErrorKind] = useState<'share' | 'unshare' | 'owner-conflict'>('share');
  // Whether a card is team-shared is decided upstream, not here — the grids'
  // 全部项目 / 草稿 partition reads the very same predicate, so the badge and the
  // card's grid can no longer disagree.
const isShared = isSharedProject ?? NOTHING_SHARED;
// The card owner avatar: first character of the owner display name with a
// deterministic background colour. The HDW backend JOIN provides
// ownerDisplayName directly; the UI shows "我" for self-owned projects.
  const resolveCreator = (project: Project): {
    name: string;
    initial: string;
    avatarUrl: string | null;
    ownedBySelf: boolean;
    canMutate: boolean;
    canAdmin: boolean;
  } => {
    const isAdmin = operator
      ? operator.role === 'admin' || operator.role === 'owner'
      : workspaceContext?.role === 'admin';
    const ownerMemberId = project.createdByWorkspaceMemberId
      ?? projectOwnerMemberIds?.get(project.id)
      ?? null;
    const effectiveMemberId = resolveProjectMemberId(project);
    const ownerDisplayName = project.ownerDisplayName?.trim()
      || projectOwnerDisplayNames?.get(project.id)?.trim()
      || resolveTeamMember(ownerMemberId)?.displayName?.trim()
      || null;
    const legacyPersonalSelf = Boolean(
      !operator
      && workspaceContext?.isDefaultTeam
      && !isShared(project.id)
      && !ownerMemberId,
    );
    const ownedBySelf = Boolean(
      ownerMemberId
      && effectiveMemberId
      && ownerMemberId === effectiveMemberId,
    ) || legacyPersonalSelf;
    const name = ownerDisplayName
      || (ownedBySelf ? workspaceContext?.displayName?.trim() : null)
      || t('recentProjects.teamMemberCreator');
    const initial = (Array.from(name.trim())[0] ?? (ownedBySelf ? 'M' : 'T')).toUpperCase();
    return {
      name,
      initial,
      avatarUrl: ownedBySelf ? workspaceContext?.avatarUrl?.trim() || null : null,
      ownedBySelf,
      canMutate: ownedBySelf,
      canAdmin: !ownedBySelf && isAdmin,
    };
  };
  const visibleProjects = useMemo(
    () => sortedProjects
     .map((project) => ({ project, creator: resolveCreator(project) }))
      .filter(({ project, creator }) => {
        const ownerMatches =
          !showOwnerFilter ||
          ownerFilter === 'all' ||
          (ownerFilter === 'mine' && creator.ownedBySelf) ||
          (ownerFilter === 'others' && !creator.ownedBySelf);
      const trimmedSearch = effectiveSearchQuery.trim().toLowerCase();
       const searchMatches = !trimmedSearch || (typeof project.name === 'string' && project.name.toLowerCase().includes(trimmedSearch));
       return ownerMatches && searchMatches;
     })
     .slice(0, resolvedLimit),
   [
    ownerFilter,
    projectOwnerMemberIds,
    projectOwnerDisplayNames,
    resolveTeamMember,
    resolvedLimit,
   selfMemberId,
   showOwnerFilter,
    resolveProjectMemberId,
   effectiveSearchQuery,
   sortedProjects,
     t,
     workspaceContext?.avatarUrl,
     workspaceContext?.displayName,
   ],
  );
  const visibleProjectIdsKey = visibleProjects.map(({ project }) => project.id).join('|');
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isActive) return;
    const projectId = readProjectLocationTarget();
    if (!projectId || !visibleProjects.some(({ project }) => project.id === projectId)) return;

    setLocationTargetId(projectId);
    clearProjectLocationTarget(projectId);
    const frame = window.requestAnimationFrame(() => {
      const cards = rowRef.current?.querySelectorAll<HTMLElement>('[data-project-id]');
      const card = cards ? Array.from(cards).find((item) => item.dataset.projectId === projectId) : null;
      card?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    });
    const timer = window.setTimeout(() => {
      setLocationTargetId((current) => current === projectId ? null : current);
    }, 2500);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [isActive, visibleProjectIdsKey]);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameTitleId = useId();
  const confirmTitleId = useId();
  const bulkDeleteTitleId = useId();
 // When set, the tree selector is open for a single-project move to team.
const [moveToTeamTarget, setMoveToTeamTarget] = useState<Project | null>(null);
// Tree dialog mode for the current move: 'tabbed' in team space, 'personal-folders'
 // for personal-space folder moves, 'team' for the legacy move-to-team flow.
 const [moveToTreeMode, setMoveToTreeMode] = useState<'team' | 'personal-folders' | 'tabbed' | 'unified'>('unified');
// When set, the tree selector is open for a bulk move to team.
const [bulkMoveToTeamOpen, setBulkMoveToTeamOpen] = useState(false);
const [bulkMovePending, setBulkMovePending] = useState(false);
const bulkMovePendingRef = useRef(false);
// Disabled tree-node keys for the move-to dialog. When moving within the
// same workspace (personal-folders mode), the current folder/root is
// disabled so a project cannot be moved into its own current location.
const disabledKeys = useMemo(() => {
  const keys = new Set(selectionExtension?.disabledMoveKeys ?? []);
  if (currentWorkspaceId) {
    keys.add(`${currentWorkspaceId}:${currentFolderId ?? 'root'}`);
  }
  return keys.size > 0 ? keys : undefined;
}, [currentWorkspaceId, currentFolderId, selectionExtension?.disabledMoveKeys]);
 function requestMove(project: Project, action: 'to-team' | 'to-personal') {
   trackCollection(action === 'to-team' ? 'move_to_team' : 'move_to_personal', {
     project_key: project.id,
     project_relation: resolveCreator(project).ownedBySelf ? 'self' : 'other',
   });
   setMenuOpenId(null);
   setMoveToTreeMode('unified');
   setMoveToTeamTarget(project);
}
 function handleMoveToTeamConfirm(selection: TeamTreeSelection) {
   const project = moveToTeamTarget;
   setMoveToTeamTarget(null);
   if (!project) return;
   if (selection.isDefaultTeam) {
     void handleUnshareFromTeam(project, {
       targetWorkspaceId: selection.workspaceId,
       targetFolderId: selection.folderId,
     });
   } else {
     void handleShareToTeam(project, {
       targetWorkspaceId: selection.workspaceId,
       targetFolderId: selection.folderId,
     });
   }
 }
 function handleBulkMoveToTeamConfirm(selection: TeamTreeSelection) {
   setBulkMoveToTeamOpen(false);
   const action = selection.isDefaultTeam ? 'to-personal' : 'to-team';
   void commitBulkMove(action, {
     targetWorkspaceId: selection.workspaceId,
     targetFolderId: selection.folderId,
   });
 }
 const isSharedWithMeCollection = badgeOverride === 'shared';
 const isRecentCollection = space === 'recent';
 const actionsAvailable = Boolean(
   homeWorkspaceId
   || onDelete
   || onDuplicate
   || onRename
   || onOpenLocation
   || onRemoveRecent
   || onRemoveSharedWithMe
   || sharedWithMeHomeWorkspaceId
   || collaborationAvailable
 );
 // Guests have no mutation rights in team spaces — hide the entire card menu
 // (copy-to-personal, move, rename, delete, share) so a guest never sees
 // actions they cannot perform. The effective role comes from the HDW
 // operator (team view) or the OpenDesign collab workspace context.
 const isGuest = operator
   ? operator.role === 'guest'
   : workspaceContext?.role === 'guest';
 const isTeamProjectCollection = space === 'team' && badgeOverride !== 'shared';
 const canShowCardActions = actionsAvailable && (isRecentCollection || isSharedWithMeCollection || !isGuest);

  useEffect(() => {
    if (!copyToast) return;
    const timer = window.setTimeout(() => setCopyToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [copyToast]);

 // Bulk-action state for the 多选 bar. Every action below is the batch form of
  // an action the per-card ⋯ menu already offers (move in/out of the team
  // space, delete); nothing new is exposed here that a single card cannot do.
  const selectedProjects = visibleProjects.filter(({ project }) => selectedProjectIds.has(project.id));
  const extensionSelectedCount = selectionExtension?.selectedCount ?? 0;
  const selectedCount = selectedProjectIds.size + extensionSelectedCount;
  // Same gate as the per-card menu: only the owner can rename, delete, or
  // duplicate. Admins can move but not delete, so the bulk toolbar needs two
  // disabled states — one for move (admins allowed) and one for delete
  // (owner only).
  const selectionHasForeignProject = selectedProjects.some(({ creator }) => !creator.canMutate);
  const selectionHasNonAdminProject = selectedProjects.some(({ creator }) => !(creator.canMutate || creator.canAdmin));
  const bulkMoveDisabled = selectedCount === 0
    || bulkMovePending
    || selectionHasNonAdminProject
    || selectionExtension?.blocksMove === true
    || (extensionSelectedCount > 0 && !selectionExtension?.onMoveSelected);
  const bulkDeleteDisabled = selectedCount === 0
    || bulkMovePending
    || selectionHasForeignProject
    || (extensionSelectedCount > 0 && !selectionExtension?.onDeleteSelected);
  const selectedLabels = [
    ...selectedProjects.map(({ project }) => project.name),
    ...(selectionExtension?.selectedLabels ?? []),
  ];
  const bulkMoveTitle = selectionHasNonAdminProject
    ? t('recentProjects.ownOnlyMutation')
    : selectedLabels.join('、') || undefined;
  const bulkDeleteTitle = selectionHasForeignProject
    ? t('recentProjects.ownOnlyMutation')
    : selectedLabels.join('、') || undefined;
  const canBulkMoveToTeam = collaborationAvailable && space !== 'team';
  const canBulkMove = collaborationAvailable && space === 'team';

  useEffect(() => {
    setSelectedProjectIds((current) => {
      if (current.size === 0) return current;
      const visibleIds = new Set(visibleProjects.map(({ project }) => project.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleProjects]);

  useEffect(() => {
    if (!menuOpenId) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && menuContainerRef.current?.contains(target)) return;
      setMenuOpenId(null);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpenId]);

  useEffect(() => {
    if (!openHeaderMenu) return;
    const activeContainer = openHeaderMenu === 'owner'
      ? ownerFilterWrapRef.current
      : sortFilterWrapRef.current;
    function handleHeaderFilterPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && activeContainer?.contains(target)) return;
      setOpenHeaderMenu(null);
    }
    document.addEventListener('pointerdown', handleHeaderFilterPointerDown);
    return () => document.removeEventListener('pointerdown', handleHeaderFilterPointerDown);
  }, [openHeaderMenu]);

  useLayoutEffect(() => {
    if (!menuOpenId) return;
    const anchor = menuContainerRef.current;
    const menu = menuRef.current;
    const trigger = anchor?.querySelector<HTMLElement>('.recent-projects__card-more');
    if (!anchor || !menu || !trigger) return;

    const measureMenuPlacement = () => {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
      const scrollBoundary = anchor.closest<HTMLElement>('.entry-main--scroll');
      const scrollRect = scrollBoundary?.getBoundingClientRect();
      const visibleTop = Math.max(0, scrollRect?.top ?? 0);
      const visibleBottom = Math.min(viewportHeight, scrollRect?.bottom ?? viewportHeight);
      const triggerRect = trigger.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const spaceBelow =
        visibleBottom - triggerRect.bottom - PROJECT_MENU_GAP - PROJECT_MENU_VIEWPORT_MARGIN;
      const spaceAbove =
        triggerRect.top - visibleTop - PROJECT_MENU_GAP - PROJECT_MENU_VIEWPORT_MARGIN;
      const nextPlacement =
        spaceBelow < menuHeight && spaceAbove > spaceBelow ? 'up' : 'down';

      setMenuPlacement((current) => (current === nextPlacement ? current : nextPlacement));
    };

    measureMenuPlacement();
    window.addEventListener('resize', measureMenuPlacement);
    window.addEventListener('scroll', measureMenuPlacement, true);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measureMenuPlacement);
    if (observer) {
      observer.observe(anchor);
      observer.observe(menu);
    }
    return () => {
      window.removeEventListener('resize', measureMenuPlacement);
      window.removeEventListener('scroll', measureMenuPlacement, true);
      observer?.disconnect();
    };
  }, [menuOpenId]);

  // Cover fetching must key off the *set of project ids and their readiness*, not the
  // `visibleProjects` array reference. That reference changes on every render
  // (upstream props/derived lists are recreated, and a 2s poll re-renders the
  // shell), and depending on it re-ran this effect — and re-fetched every
  // project's files — on every render (observed ~23× per project in a trace).
  // A catalog placeholder can materialize without changing id or updatedAt,
  // though, so include that one transition to start its first real scan.
  const coverFetchKey = visibleProjects
    .map(({ project }) =>
      `${project.id}:${project.metadata?.sharedProjectPlaceholderAt == null ? 'ready' : 'placeholder'}`,
    )
    .join('|');
  const visibleProjectsRef = useRef(new Map<string, Project>());
  visibleProjectsRef.current = new Map(
    visibleProjects.map(({ project }) => [project.id, project]),
  );
  const coverGenerationRef = useRef(new Map<string, number>());
  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const coverQueueRef = useRef<BackgroundTaskQueue | null>(null);
  if (!coverQueueRef.current) {
    coverQueueRef.current = new BackgroundTaskQueue(MAX_BACKGROUND_COVER_REQUESTS);
  }
  const coverQueue = coverQueueRef.current;
  const coverInFlightRef = useRef(
    new Map<string, {
      controller: AbortController;
      generation: number;
      promise: Promise<void>;
    }>(),
  );
  // Resolves one project's cover decision. Returns:
  // - a cover override when the project has a renderable cover,
  // - `null` as the *authoritative* "this project has no cover" answer
  //   (safe to snapshot until the project version changes), and
  // - `undefined` for transient outcomes (abort, network failure) that must
  //   not be cached or written into state.
  const loadProjectCover = useCallback(async (
    project: Project,
    signal: AbortSignal,
    requestWorkspaceContext: WorkspaceCollabContext | null,
    freshFiles = false,
  ): Promise<ProjectCoverOverride | null | undefined> => {
    // Catalog-only Team projects intentionally have no local directory until
    // the first open materializes them. Probing `/files` here can only produce
    // a noisy 404. This is transient rather than an authoritative no-cover
    // decision: hydration can clear the stamp without changing id/updatedAt,
    // at which point coverFetchKey starts the first real scan.
    if (project.metadata?.sharedProjectPlaceholderAt != null) return undefined;
    const designSystemProject = isDesignSystemProject(project);
    if (project.metadata?.entryFile && !designSystemProject) return null;
    let files: Awaited<ReturnType<typeof fetchProjectFiles>>;
    try {
      files = await fetchProjectFiles(project.id, {
        signal,
        workspaceContext: requestWorkspaceContext,
        ...(freshFiles ? { fresh: true } : {}),
      });
    } catch {
      return undefined;
    }
    if (signal.aborted) return undefined;
    if (designSystemProject) {
      return (await findDesignSystemCover(
        project.id,
        files,
        signal,
        requestWorkspaceContext,
      )) ?? null;
    }
    const cover = selectProjectFileCover(files);
    if (cover?.kind !== 'html') return cover;

    const src = projectCoverUrl(
      project.id,
      cover.name,
      cover.mtime,
      requestWorkspaceContext,
    );
    const diagnostic = `${project.id}:${cover.name}`;
    if (project.metadata?.kind === 'deck') {
      try {
        await loadDeckCover(src, signal, requestWorkspaceContext);
        return signal.aborted ? undefined : cover;
      } catch (err) {
        if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return undefined;
        console.warn('[project-cover] failed to load HTML cover:', diagnostic, err);
        return undefined;
      }
    }

    try {
      const response = await fetch(src, {
        method: 'HEAD',
        cache: 'no-store',
        signal,
        ...(requestWorkspaceContext
          ? { headers: workspaceProjectHeaders(requestWorkspaceContext) }
          : {}),
      });
      if (signal.aborted) return undefined;
      if (response.ok || response.status === 304) return cover;
      console.warn(
        `[project-cover] HTML cover unavailable (${response.status} ${response.statusText}):`,
        diagnostic,
      );
      // The server answered: the cover file is not readable. That decision is
      // cacheable; the card renders its glyph until the project changes.
      return null;
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return undefined;
      console.warn('[project-cover] failed to verify HTML cover:', diagnostic, err);
      return undefined;
    }
  }, []);

  const requestProjectCover = useCallback((
    project: Project,
    options: { force?: boolean } = {},
  ): Promise<void> => {
    if (!activeRef.current) return Promise.resolve();
    if (workspaceContextLoadingRef.current) return Promise.resolve();
    const requestWorkspaceContext = workspaceContextRef.current;
    const snapshotKey = projectCoverSnapshotKey(
      workspaceIdentityCacheKey(requestWorkspaceContext),
      project.id,
      project.updatedAt,
    );
    if (!options.force) {
      // Serve the last successful decision for this exact workspace/project/
      // version instead of re-running the files scan + probe on every
      // remount. Stale versions miss the key; content-ready events
      // invalidate explicitly (Batch A §4.2).
      const snapshot = getProjectCoverSnapshot(snapshotKey);
      if (snapshot !== undefined) {
        if (visibleProjectsRef.current.has(project.id)) {
          setCoverByProject((current) =>
            current[project.id] === snapshot.cover
              ? current
              : { ...current, [project.id]: snapshot.cover },
          );
        }
        return Promise.resolve();
      }
    }
    const existing = coverInFlightRef.current.get(project.id);
    if (existing && !options.force) return existing.promise;
    const generation = (coverGenerationRef.current.get(project.id) ?? 0) + 1;
    coverGenerationRef.current.set(project.id, generation);
    const controller = new AbortController();
    const promise = coverQueue.schedule(
      controller,
      () => loadProjectCover(
        project,
        controller.signal,
        requestWorkspaceContext,
        options.force === true,
      ),
      options.force,
    )
      .then((cover) => {
        if (controller.signal.aborted) return;
        if (cover === undefined) return;
        if (coverGenerationRef.current.get(project.id) !== generation) return;
        setProjectCoverSnapshot(snapshotKey, cover);
        if (!visibleProjectsRef.current.has(project.id)) return;
        setCoverByProject((current) => ({ ...current, [project.id]: cover }));
      })
      .finally(() => {
        // Generation values can be reused after a StrictMode synthetic cleanup
        // clears the maps. Only the exact request that installed this entry may
        // remove it; otherwise late settlement from replay A can erase replay
        // B, leaving the real unmount with no controller to abort.
        if (coverInFlightRef.current.get(project.id)?.controller === controller) {
          coverInFlightRef.current.delete(project.id);
        }
      });
    coverInFlightRef.current.set(project.id, { controller, generation, promise });
    // Install the replacement first so a force-refresh enters the front of the
    // queue before aborting its stale predecessor releases a slot.
    existing?.controller.abort();
    return promise;
  }, [coverQueue, loadProjectCover]);

  const abortBackgroundCoverRequests = useCallback(() => {
    coverQueue.withoutDraining(() => {
      for (const request of coverInFlightRef.current.values()) {
        request.controller.abort();
      }
    });
    coverInFlightRef.current.clear();
  }, [coverQueue]);

  // Cards report themselves through a per-card viewport sentinel; only cards
  // that have actually been near the viewport ever start cover work
  // (Batch A §4.2). The set is per-mount on purpose: a fresh strip instance
  // re-discovers visibility, while resolved decisions come from the snapshot
  // cache.
  const coverSentinelSeenRef = useRef(new Set<string>());
  useEffect(() => {
    abortBackgroundCoverRequests();
    setCoverByProject({});
    if (workspaceContextLoading) return;
    for (const project of visibleProjectsRef.current.values()) {
      if (!coverSentinelSeenRef.current.has(project.id)) continue;
      void requestProjectCover(project);
    }
  }, [
    abortBackgroundCoverRequests,
    requestProjectCover,
    workspaceContextLoading,
    workspaceIdentity,
  ]);
  const handleCoverCardVisible = useCallback((projectId: string) => {
    if (coverSentinelSeenRef.current.has(projectId)) return;
    coverSentinelSeenRef.current.add(projectId);
    if (workspaceContextLoadingRef.current) return;
    const project = visibleProjectsRef.current.get(projectId);
    if (!project) return;
    void requestProjectCover(project);
  }, [requestProjectCover]);

  const resumeBackgroundCoverRequests = useCallback(() => {
    if (!activeRef.current) return;
    resumeThumbnailLoads();
    for (const project of visibleProjectsRef.current.values()) {
      if (!coverSentinelSeenRef.current.has(project.id)) continue;
      void requestProjectCover(project);
    }
  }, [requestProjectCover]);

  useEffect(() => {
    return () => {
      // Cover probes are background-only. Do not let them survive navigation
      // away from Home and occupy the connections needed by the reopened
      // project's file list and preview source.
      abortBackgroundCoverRequests();
      coverGenerationRef.current.clear();
    };
  }, [abortBackgroundCoverRequests]);

  const refreshProjectCover = useCallback((projectId: string) => {
    // A content-ready event is authoritative: the stored cover decision (any
    // version) and any pre-materialization file-list read are void even if the
    // card is currently offscreen or unlisted. Invalidate the exact Workspace
    // authority before the forced scan so another force refresh in the same
    // burst cannot make the file-list layer reuse its earlier [] response.
    invalidateProjectCoverSnapshots(projectId);
    invalidateProjectFilesCache(projectId, workspaceContextRef.current);
    const project = visibleProjectsRef.current.get(projectId);
    if (!project) return;
    if (!coverSentinelSeenRef.current.has(projectId)) return;
    // Supersedes an older initial scan that may still be resolving against
    // the pre-pull filesystem.
    void requestProjectCover(project, { force: true });
  }, [requestProjectCover]);

  useWorkspaceInvalidation(
    {
      'team-project-content-ready': ({ projectId, workspaceId }) => {
        if (!activeRef.current) return;
        if (workspaceContext?.workspaceId !== workspaceId) return;
        void refreshProjectCover(projectId);
      },
    },
    {
      workspaceContext,
      // Thin SSE events are not replayed. On reconnect/focus, retry only cards
      // whose initial scan found no local cover, closing a missed-ready gap
      // without re-fetching every already-resolved card in the grid.
      onActive: () => {
        if (!activeRef.current) return;
        for (const { project } of visibleProjects) {
          if (!coverSentinelSeenRef.current.has(project.id)) continue;
          if (coverByProject[project.id] == null) {
            if (coverInFlightRef.current.has(project.id)) continue;
            // `null` is normally a cacheable no-cover decision. Reconnect is
            // specifically the missed-invalidation recovery path, so bypass
            // that snapshot and re-probe the exact current Workspace.
            void requestProjectCover(project, { force: true });
          }
        }
      },
    },
  );

  useEffect(() => {
    const visibleIds = new Set(visibleProjects.map(({ project }) => project.id));
    if (!isActive) {
      abortBackgroundCoverRequests();
      return;
    }
    const staleRequests = [...coverInFlightRef.current.entries()]
      .filter(([projectId]) => !visibleIds.has(projectId));
    coverQueue.withoutDraining(() => {
      for (const [projectId, request] of staleRequests) {
        request.controller.abort();
        coverInFlightRef.current.delete(projectId);
        coverGenerationRef.current.delete(projectId);
      }
    });
    if (visibleProjects.length === 0) {
      setCoverByProject({});
      return;
    }
    setCoverByProject((current) => {
      const entries = Object.entries(current).filter(([projectId]) => visibleIds.has(projectId));
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries);
    });
    for (const { project } of visibleProjects) {
      if (!coverSentinelSeenRef.current.has(project.id)) continue;
      void requestProjectCover(project);
    }
    // Intentionally keyed on the id set (coverFetchKey), not visibleProjects,
    // so re-renders that don't change which projects are shown don't re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abortBackgroundCoverRequests, coverFetchKey, coverQueue, isActive, requestProjectCover]);

function startRename(project: Project) {
  const creator = resolveCreator(project);
   if (!creator.canMutate) return;
   trackCollection('rename', {
     project_key: project.id,
     project_relation: 'self',
   });
   setMenuOpenId(null);
   setRenameTarget({ id: project.id, original: project.name });
   setRenameInput(project.name);
 }

  function cancelRename() {
    setRenameTarget(null);
    setRenameInput('');
  }

  function commitRename() {
    if (!renameTarget || !onRename) return;
    const trimmed = renameInput.trim();
    if (trimmed && trimmed !== renameTarget.original) {
      onRename(renameTarget.id, trimmed);
    }
    cancelRename();
  }

function requestDelete(project: Project) {
  const creator = resolveCreator(project);
   if (!creator.canMutate) return;
   trackCollection('delete', {
     project_key: project.id,
     project_relation: 'self',
   });
   setMenuOpenId(null);
   setDeleteFailed(false);
   setConfirmTarget(project);
 }

  // Promote/demote a project through the same workspace move endpoint used by
  // the full project grid so cards and in-file sharing cannot drift.
 async function handleShareToTeam(
   project: Project,
   options?: { targetWorkspaceId?: string; targetFolderId?: string | null },
 ) {
   const startedAt = performance.now();
   setShareErrorProjectId(null);
   setMenuOpenId(project.id);
   setSharingId(project.id);
   try {
     const movedProject = await moveWorkspaceProject({
       projectId: project.id,
       visibility: 'team',
       workspaceContext,
       targetWorkspaceId: options?.targetWorkspaceId,
       targetFolderId: options?.targetFolderId ?? null,
     });
     onProjectShared?.(movedProject);
     notifyTeamProjectsChanged();
     window.dispatchEvent(new CustomEvent('personal:folders-updated'));
     window.dispatchEvent(
       new CustomEvent('hdw:folders-updated', {
         detail: { teamId: workspaceContext?.workspaceId },
       }),
     );
     window.dispatchEvent(
       new CustomEvent('hdw:subfolders-updated', {
         detail: { teamId: workspaceContext?.workspaceId },
       }),
     );
     setMenuOpenId(null);
     trackWorkspaceProjectActionResult(analytics.track, {
       page_name: analyticsPage,
       area: 'project_collection',
       action: 'move_to_team',
        result: 'success',
        requested_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        duration_ms: Math.round(performance.now() - startedAt),
        ...workspaceDimensions,
      });
    } catch (err) {
      onProjectShareFailed?.(project.id);
      console.warn('[RecentProjectsStrip] share project to team failed:', err);
      setShareErrorProjectId(project.id);
      setShareErrorKind(
        workspaceProjectMoveErrorCode(err) === 'TEAM_PROJECT_OWNER_CONFLICT'
          ? 'owner-conflict'
          : 'share',
      );
      setMenuOpenId(project.id);
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'move_to_team',
        result: 'failed',
        requested_count: 1,
        succeeded_count: 0,
        failed_count: 1,
        duration_ms: Math.round(performance.now() - startedAt),
        error_code: workspaceProjectMoveErrorCode(err) ?? 'request_failed',
        ...workspaceDimensions,
      });
    } finally {
      setSharingId(null);
    }
  }

  async function handleUnshareFromTeam(
    project: Project,
    options?: { targetWorkspaceId?: string; targetFolderId?: string | null },
  ) {
    const startedAt = performance.now();
    setShareErrorProjectId(null);
    setMenuOpenId(project.id);
    setUnsharingId(project.id);
    try {
      await moveWorkspaceProject({
        projectId: project.id,
        visibility: 'personal',
        workspaceContext,
        targetWorkspaceId: options?.targetWorkspaceId,
        targetFolderId: options?.targetFolderId ?? null,
      });
     onProjectUnshared?.(project.id);
     notifyTeamProjectsChanged();
     window.dispatchEvent(new CustomEvent('personal:folders-updated'));
     window.dispatchEvent(
       new CustomEvent('hdw:folders-updated', {
         detail: { teamId: workspaceContext?.workspaceId },
       }),
     );
     window.dispatchEvent(
       new CustomEvent('hdw:subfolders-updated', {
         detail: { teamId: workspaceContext?.workspaceId },
       }),
     );
     setMenuOpenId(null);
     trackWorkspaceProjectActionResult(analytics.track, {
       page_name: analyticsPage,
       area: 'project_collection',
        action: 'move_to_personal',
        result: 'success',
        requested_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        duration_ms: Math.round(performance.now() - startedAt),
        ...workspaceDimensions,
      });
    } catch (err) {
      console.warn('[RecentProjectsStrip] unshare project from team failed:', err);
      setShareErrorProjectId(project.id);
      setShareErrorKind('unshare');
      setMenuOpenId(project.id);
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'move_to_personal',
        result: 'failed',
        requested_count: 1,
        succeeded_count: 0,
        failed_count: 1,
        duration_ms: Math.round(performance.now() - startedAt),
        error_code: workspaceProjectMoveErrorCode(err) ?? 'request_failed',
        ...workspaceDimensions,
      });
    } finally {
      setUnsharingId(null);
    }
  }

  function requestDuplicate(project: Project) {
    if (!onDuplicate) return;
    const creator = resolveCreator(project);
    // Team projects are readable/copyable by every active non-guest member;
    // personal and shared-with-me surfaces keep their existing owner-only
    // duplicate rule.
    if (!creator.canMutate && !isTeamProjectCollection && !isSharedWithMeCollection) return;
    if (isGuest && !isSharedWithMeCollection) return;
    trackCollection('duplicate', {
      project_key: project.id,
      project_relation: creator.ownedBySelf ? 'self' : 'other',
    });
    setMenuOpenId(null);
    const startedAt = performance.now();
    void Promise.resolve(onDuplicate(project.id)).then(() => {
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'duplicate',
        result: 'success',
        requested_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        duration_ms: Math.round(performance.now() - startedAt),
        ...workspaceDimensions,
      });
    }).catch((err) => {
      console.warn('[RecentProjectsStrip] duplicate project failed:', err);
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'duplicate',
        result: 'failed',
        requested_count: 1,
        succeeded_count: 0,
        failed_count: 1,
        duration_ms: Math.round(performance.now() - startedAt),
        error_code: 'request_failed',
        ...workspaceDimensions,
      });
    });
  }

  function requestCopyToPersonal(project: Project) {
    trackCollection('copy_to_personal', {
      project_key: project.id,
      project_relation: 'other',
    });
    setMenuOpenId(null);
    setCopyToPersonalTarget(project);
  }

  async function handleCopyToPersonalConfirm(selection: TeamTreeSelection) {
    const project = copyToPersonalTarget;
    if (!project || copyPendingId) return;
    const startedAt = performance.now();
    setCopyToPersonalTarget(null);
    setCopyPendingId(project.id);
    setCopyToast(null);
    try {
      const sourceWorkspaceContext = await resolveBoundProjectWorkspaceContext(
        project.workspaceId?.trim() ?? '',
      );
      if (!sourceWorkspaceContext) throw new Error('source workspace unavailable');
      await copyProjectToPersonal(project.id, sourceWorkspaceContext, {
        targetFolderId: selection.folderId,
      });
      notifyTeamProjectsChanged();
      window.dispatchEvent(new CustomEvent('personal:folders-updated'));
      window.dispatchEvent(new CustomEvent('shared:projects-refresh'));
      setCopyToast({ message: t('recentProjects.copyToPersonalSuccess'), tone: 'success' });
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'copy_to_personal',
        result: 'success',
        requested_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        duration_ms: Math.round(performance.now() - startedAt),
        ...workspaceDimensions,
      });
    } catch (err) {
      console.warn('[RecentProjectsStrip] copy project to personal failed:', err);
      setCopyToast({ message: t('recentProjects.copyToPersonalFailed'), tone: 'error' });
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'copy_to_personal',
        result: 'failed',
        requested_count: 1,
        succeeded_count: 0,
        failed_count: 1,
        error_code: 'request_failed',
        duration_ms: Math.round(performance.now() - startedAt),
        ...workspaceDimensions,
      });
    } finally {
      setCopyPendingId(null);
    }
  }

  async function commitDelete() {
    if (!confirmTarget || !onDelete || deletePending) return;
    const target = confirmTarget;
    const startedAt = performance.now();
    setDeleteFailed(false);
    setDeletePending(true);
    try {
      const result = await onDelete(target.id);
      // A falsy result (false, or void from a caller that never resolves the
      // promise either way) means the daemon refused or the request failed —
      // keep the dialog open with a visible reason instead of closing it as
      // if the project were gone (recvqbh189zBY6).
      if (result === false) {
        trackWorkspaceProjectActionResult(analytics.track, {
          page_name: analyticsPage,
          area: 'project_collection',
          action: 'delete',
          result: 'failed',
          requested_count: 1,
          succeeded_count: 0,
          failed_count: 1,
          duration_ms: Math.round(performance.now() - startedAt),
          error_code: 'request_failed',
          ...workspaceDimensions,
        });
        setDeleteFailed(true);
        return;
      }
      setConfirmTarget(null);
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'delete',
        result: 'success',
        requested_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        duration_ms: Math.round(performance.now() - startedAt),
        ...workspaceDimensions,
      });
    } catch (err) {
      console.warn('[RecentProjectsStrip] delete project failed:', err);
      setDeleteFailed(true);
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'delete',
        result: 'failed',
        requested_count: 1,
        succeeded_count: 0,
        failed_count: 1,
        duration_ms: Math.round(performance.now() - startedAt),
        error_code: stableAnalyticsRequestErrorCode(err),
        ...workspaceDimensions,
      });
    } finally {
      setDeletePending(false);
    }
  }

  function toggleSelection(projectId: string) {
    if (bulkMovePendingRef.current) return;
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  function exitSelectionMode() {
    if (bulkMovePendingRef.current) return;
    setSelectionMode(false);
    setSelectedProjectIds(new Set());
    selectionExtension?.onClear?.();
    selectionExtension?.onModeChange?.(false);
  }

 function requestBulkMove(action: 'to-team' | 'to-personal') {
    if (bulkMoveDisabled) return;
   trackCollection(action === 'to-team' ? 'bulk_move_to_team' : 'bulk_move_to_personal', {
     selection_count_bucket: countBucket(selectedCount),
   });
   setBulkMoveToTeamOpen(true);
 }

 /** Batch form of the per-card 转入/移出团队空间 action: the very same
  *  `moveWorkspaceProject` call, once per selected project. Failures are
  *  reported per project and never abort the rest of the batch. */
 async function commitBulkMove(
   action: 'to-team' | 'to-personal',
   options?: { targetWorkspaceId?: string; targetFolderId?: string | null },
 ) {
   if (bulkMovePendingRef.current) return;
   const ids = selectedProjects.map(({ project }) => project.id);
   const extensionCount = extensionSelectedCount;
   const moveExtensionItems = selectionExtension?.onMoveSelected;
   const startedAt = performance.now();
   const preserveFailedSelection = extensionCount > 0 && selectionExtension?.preserveFailedMoveSelection === true;
   if (ids.length === 0 && extensionCount === 0) return;
   if (!preserveFailedSelection) exitSelectionMode();
   bulkMovePendingRef.current = true;
   setBulkMovePending(true);
   try {
   const visibility = action === 'to-team' ? 'team' : 'personal';
   const moved = await Promise.all(
     ids.map(async (id) => {
       try {
         const project = await moveWorkspaceProject({
           projectId: id,
           visibility,
           workspaceContext,
           targetWorkspaceId: options?.targetWorkspaceId,
           targetFolderId: options?.targetFolderId ?? null,
         });
         return { id, project };
        } catch (err) {
          if (action === 'to-team') onProjectShareFailed?.(id);
          console.warn('[RecentProjectsStrip] bulk move project failed:', err);
          return null;
        }
      }),
    );
    const succeeded = moved.filter(
      (result): result is { id: string; project: WorkspaceProjectSummary } => result !== null,
    );
    for (const result of succeeded) {
      if (action === 'to-team') onProjectShared?.(result.project);
      else onProjectUnshared?.(result.id);
    }
   let extensionSucceededCount = 0;
   if (extensionCount > 0 && moveExtensionItems) {
     try {
       extensionSucceededCount = await moveExtensionItems(action, options);
     } catch (err) {
       console.warn('[RecentProjectsStrip] bulk move collection item failed:', err);
     }
   }
   if (succeeded.length > 0 || extensionSucceededCount > 0) notifyTeamProjectsChanged();
   if (succeeded.length > 0 || extensionSucceededCount > 0) {
     window.dispatchEvent(new CustomEvent('personal:folders-updated'));
     window.dispatchEvent(
       new CustomEvent('hdw:folders-updated', {
         detail: { teamId: workspaceContext?.workspaceId },
       }),
     );
     window.dispatchEvent(
       new CustomEvent('hdw:subfolders-updated', {
         detail: { teamId: workspaceContext?.workspaceId },
       }),
     );
   }
   const requestedCount = ids.length + extensionCount;
   const succeededCount = succeeded.length + extensionSucceededCount;
   const failedCount = requestedCount - succeededCount;
   bulkMovePendingRef.current = false;
   setBulkMovePending(false);
   if (preserveFailedSelection) {
     if (failedCount === 0) exitSelectionMode();
     else {
       const succeededIds = new Set(succeeded.map((item) => item.id));
       setSelectedProjectIds((current) => new Set([...current].filter((id) => !succeededIds.has(id))));
     }
   }
    trackWorkspaceProjectActionResult(analytics.track, {
      page_name: analyticsPage,
      area: 'project_collection',
      action: action === 'to-team' ? 'bulk_move_to_team' : 'bulk_move_to_personal',
      result: failedCount === 0 ? 'success' : succeededCount > 0 ? 'partial_success' : 'failed',
      requested_count: requestedCount,
      succeeded_count: succeededCount,
      failed_count: failedCount,
      duration_ms: Math.round(performance.now() - startedAt),
      ...(failedCount > 0 ? { error_code: 'one_or_more_failed' } : {}),
      ...workspaceDimensions,
    });
   } finally {
     bulkMovePendingRef.current = false;
     setBulkMovePending(false);
   }
  }

  async function commitBulkDelete() {
    const ids = selectedProjects.map(({ project }) => project.id);
    const extensionCount = extensionSelectedCount;
    const deleteExtensionItems = selectionExtension?.onDeleteSelected;
    const startedAt = performance.now();
    setBulkDeleteOpen(false);
    exitSelectionMode();
    if (ids.length === 0 && extensionCount === 0) return;
    const deleted = onDelete ? await Promise.all(
      ids.map(async (id) => {
        try {
          const result = await onDelete(id);
          return result === false ? null : id;
        } catch (err) {
          console.warn('[RecentProjectsStrip] bulk delete project failed:', err);
          return null;
        }
      }),
    ) : [];
    let extensionSucceededCount = 0;
    if (extensionCount > 0 && deleteExtensionItems) {
      try {
        extensionSucceededCount = await deleteExtensionItems();
      } catch (err) {
        console.warn('[RecentProjectsStrip] bulk delete collection item failed:', err);
      }
    }
    const requestedCount = ids.length + extensionCount;
    const succeededCount = deleted.filter((id): id is string => id !== null).length + extensionSucceededCount;
    const failedCount = requestedCount - succeededCount;
    trackWorkspaceProjectActionResult(analytics.track, {
      page_name: analyticsPage,
      area: 'project_collection',
      action: 'bulk_delete',
      result: failedCount === 0 ? 'success' : succeededCount > 0 ? 'partial_success' : 'failed',
      requested_count: requestedCount,
      succeeded_count: succeededCount,
      failed_count: failedCount,
      duration_ms: Math.round(performance.now() - startedAt),
      ...(failedCount > 0 ? { error_code: 'one_or_more_failed' } : {}),
      ...workspaceDimensions,
    });
  }

  const controlsEl = (
         <div className="recent-projects__controls">
           {/* {space === 'team' &&
           canAccessInviteFlow &&
           inviteTarget.kind !== 'unavailable' ? (
             <button
               type="button"
               className="recent-projects__invite"
               onClick={() => {
                 trackCollection('invite_teammates');
                 if (inviteTarget.kind === 'vela') {
                   window.open(inviteTarget.url, '_blank', 'noopener,noreferrer');
                 } else if (inviteTarget.kind === 'local') {
                   setInviteOpen(true);
                 }
               }}
             >
               <Icon name="share" size={15} /> {t('recentProjects.inviteTeammates')}
             </button>
          ) : null} */}
          {externalSearchQuery === undefined ? (
          <div className="recent-projects__search">
            <Icon name="search" size={14} />
            <input
              type="text"
              value={effectiveSearchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('recentProjects.searchPlaceholder')}
              aria-label={t('recentProjects.searchPlaceholder')}
            />
             {effectiveSearchQuery ? (
               <button
                 type="button"
                 className="recent-projects__search-clear"
                 aria-label={t('recentProjects.clearFilters')}
                 onClick={() => setSearchQuery('')}
               >
                 <Icon name="close" size={12} />
               </button>
             ) : null}
          </div>
     ) : null}
         <>
         {!minimalControls && canManageCollection ? (
        <button
              type="button"
              className={`recent-projects__select-toggle${selectionMode ? ' is-active' : ''}`}
                aria-pressed={selectionMode}
                disabled={bulkMovePending}
                onClick={() => {
                  if (bulkMovePendingRef.current) return;
                  trackCollection('multi_select_toggle', {
                    selection_count_bucket: countBucket(selectedCount),
                  });
                  const nextMode = !selectionMode;
                  setSelectionMode(nextMode);
                  setSelectedProjectIds(new Set());
                  selectionExtension?.onClear?.();
                  selectionExtension?.onModeChange?.(nextMode);
                  setMenuOpenId(null);
                }}
              >
                {t('recentProjects.multiSelect')}
              </button>
            ) : null}
            {!minimalControls && showOwnerFilter ? (
              <div ref={ownerFilterWrapRef} className="recent-projects__filter-wrap">
                <button
                  type="button"
                  className="recent-projects__filter"
                  aria-expanded={openHeaderMenu === 'owner'}
                  onClick={() => setOpenHeaderMenu((current) => current === 'owner' ? null : 'owner')}
                >
                  {t(OWNER_FILTER_OPTIONS.find((option) => option.id === ownerFilter)?.labelKey ?? 'recentProjects.ownerAll')}
                  <Icon name="chevron-down" size={13} />
                </button>
                {openHeaderMenu === 'owner' ? (
                  <div
                    ref={headerMenuPanelRef}
                    className={`recent-projects__filter-menu is-align-${headerMenuAlign}`}
                    role="menu"
                  >
                    {OWNER_FILTER_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={ownerFilter === option.id ? 'is-active' : undefined}
                        onClick={() => {
                          trackCollection('filter', {
                            filter_type: 'owner',
                            filter_value: option.id,
                          });
                          setOwnerFilter(option.id);
                          setOpenHeaderMenu(null);
                        }}
                      >
                        {t(option.labelKey)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div ref={sortFilterWrapRef} className="recent-projects__filter-wrap">
              <button
                type="button"
                className="recent-projects__view-btn"
                aria-label={t('recentProjects.sortAria')}
                aria-expanded={openHeaderMenu === 'sort'}
                onClick={() => setOpenHeaderMenu((current) => current === 'sort' ? null : 'sort')}
              >
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7h6M3 12h10M3 17h14M17 4v8m0 0 3-3m-3 3-3-3" />
                </svg>
              </button>
              {openHeaderMenu === 'sort' ? (
                <div
                  ref={headerMenuPanelRef}
                  className={`recent-projects__filter-menu is-align-${headerMenuAlign}`}
                  role="menu"
                >
                  {sortOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={sort === option.id ? 'is-active' : undefined}
                      onClick={() => {
                        trackCollection('sort', {
                          sort_value:
                            option.id === 'recentViewed'
                              ? 'recent_viewed'
                              : option.id === 'updatedAsc'
                                ? 'updated_asc'
                                : option.id === 'nameAsc'
                                  ? 'name_asc'
                                  : 'updated_desc',
                        });
                        setSort(option.id);
                        setOpenHeaderMenu(null);
                      }}
                    >
                      {t(option.labelKey)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="recent-projects__view" role="group" aria-label={t('designs.viewToggleAria')}>
              <button
                type="button"
                className={`recent-projects__view-btn${view === 'grid' ? ' is-active' : ''}`}
                aria-pressed={view === 'grid'}
                aria-label={t('designs.viewGrid')}
                onClick={() => {
                  if (view !== 'grid') {
                    trackCollection('view_toggle', { view_value: 'grid' });
                    setView('grid');
                  }
                }}
              >
                <Icon name="grid" size={15} />
              </button>
              <button
                type="button"
                className={`recent-projects__view-btn${view === 'list' ? ' is-active' : ''}`}
                aria-pressed={view === 'list'}
                aria-label={t('recentProjects.viewList')}
                onClick={() => {
                  if (view !== 'list') {
                    trackCollection('view_toggle', { view_value: 'list' });
                    setView('list');
                  }
                }}
              >
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
                </svg>
             </button>
          </div>
          </>
        </div>
 );

  return (
    <section className="recent-projects" data-testid="recent-projects-strip">
      {fullPageGrid ? (
        controlsPortalTarget && hideTitle ? (
          createPortal(controlsEl, controlsPortalTarget)
        ) : (
          <header className="recent-projects__head">
            {hideTitle ? null : (
              <div className="recent-projects__title-block">
                <h2 className="recent-projects__heading">{heading ?? t('recentProjects.title')}</h2>
                {description ? (
                  <p className="recent-projects__description">{description}</p>
                ) : null}
              </div>
            )}
            {controlsEl}
          </header>
        )
      ) : (
        <header className="recent-projects__head">
          <h2 className="recent-projects__title">{t('recentProjects.title')}</h2>
          {onViewAll ? (
            <button
              type="button"
              className="recent-projects__view-all"
              onClick={onViewAll}
              data-testid="recent-projects-view-all"
            >
              <span>{t('recentProjects.viewAll')}</span>
              <Icon name="chevron-right" size={12} />
            </button>
          ) : null}
          {controlsEl}
        </header>
      )}
      {selectionMode ? (bulkbarPortalTarget ? createPortal(
        <div
          className="recent-projects__bulkbar"
          role="toolbar"
          aria-label={t('recentProjects.multiSelect')}
        >
          <span className="recent-projects__bulkbar-count">
            {t('designs.selectedCount', { n: selectedCount })}
          </span>
          <div className="recent-projects__bulkbar-actions">
            {canBulkMove || canBulkMoveToTeam || space === 'drafts' ? (
              <button
                type="button"
                disabled={bulkMoveDisabled}
                title={bulkMoveTitle}
                onClick={() => requestBulkMove('to-team')}
              >
                <Icon name="move" size={14} /> {t('recentProjects.moveTo')}
              </button>
            ) : null}
            {!selectionExtension?.hideDelete && (onDelete || selectionExtension?.onDeleteSelected) ? (
              <button
                type="button"
                className="danger"
                disabled={bulkDeleteDisabled}
                title={bulkDeleteTitle}
                onClick={() => {
                  trackCollection('bulk_delete', {
                    selection_count_bucket: countBucket(selectedCount),
                  });
                  setBulkDeleteOpen(true);
                }}
              >
                <Icon name="trash" size={14} /> {t('designs.deleteSelected')}
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={exitSelectionMode}>
              {t('designs.cancelSelect')}
            </button>
          </div>
        </div>,
        bulkbarPortalTarget,
      ) : (
        <div
          className="recent-projects__bulkbar"
          role="toolbar"
          aria-label={t('recentProjects.multiSelect')}
        >
          <span className="recent-projects__bulkbar-count">
            {t('designs.selectedCount', { n: selectedCount })}
          </span>
          <div className="recent-projects__bulkbar-actions">
            {canBulkMove || canBulkMoveToTeam || space === 'drafts' ? (
              <button type="button" disabled={bulkMoveDisabled} title={bulkMoveTitle} onClick={() => requestBulkMove('to-team')}>
                <Icon name="move" size={14} /> {t('recentProjects.moveTo')}
              </button>
            ) : null}
            {!selectionExtension?.hideDelete && (onDelete || selectionExtension?.onDeleteSelected) ? (
              <button
                type="button"
                className="danger"
                disabled={bulkDeleteDisabled}
                title={bulkDeleteTitle}
                onClick={() => {
                  trackCollection('bulk_delete', { selection_count_bucket: countBucket(selectedCount) });
                  setBulkDeleteOpen(true);
                }}
              >
                <Icon name="trash" size={14} /> {t('designs.deleteSelected')}
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={exitSelectionMode}>
              {t('designs.cancelSelect')}
            </button>
          </div>
        </div>
      )) : null}
      <div
        ref={rowRef}
        className={`recent-projects__row${fullPageGrid ? ` recent-projects__row--${view}` : ''}${menuOpenId ? ' recent-projects__row--menu-open' : ''}${selectionMode ? ' is-selecting' : ''}`}
       role="list"
     >
       {loading ? (
         <div className="recent-projects__empty" role="status">{t('common.loading')}</div>
       ) : visibleProjects.length === 0 ? (
         emptyContent !== undefined && !effectiveSearchQuery.trim() && ownerFilter === 'all'
           ? emptyContent == null ? null : <div className="recent-projects__empty-content">{emptyContent}</div>
           : <PageEmptyState search={Boolean(effectiveSearchQuery.trim()) || ownerFilter !== 'all'} />
       ) : null}
       {(loading ? [] : visibleProjects).map(({ project, creator }) => {
          const cover = projectCover(
            project,
            coverByProject[project.id] ?? null,
            workspaceContext,
            sharedSpaceTeamId,
          );
          const designSystemProject = isDesignSystemProject(project);
          const status: ProjectDisplayStatus = project.status?.value ?? 'not_started';
          const publishedDesignSystem = isPublishedDesignSystemProject(project, designSystems);
          const isActive =
            !publishedDesignSystem &&
            (status === 'running' ||
              status === 'queued' ||
              status === 'awaiting_input' ||
              // Incomplete is terminal but needs attention; show the status dot so
              // it reads as "not done", not a static success pill (#1247 / #1060).
              status === 'incomplete');
          const shared = isShared(project.id);
         const selected = selectedProjectIds.has(project.id);
         const locationTarget = locationTargetId === project.id;
         const opening = openingProjectId === project.id;
         const sharedWithMeWorkspaceId = sharedWithMeHomeWorkspaceId?.(project.id) ?? null;
         const recentSharedWithMe = isRecentCollection && sharedWithMeWorkspaceId !== null;
         const recentTeamProject = isRecentCollection
           && !recentSharedWithMe
           && project.workspaceVisibility === 'team';
         const projectHomeWorkspaceId = isSharedWithMeCollection || recentSharedWithMe
           ? sharedWithMeWorkspaceId
           : isRecentCollection
             ? project.workspaceId?.trim() || null
             : homeWorkspaceId;
         // Team cards use the explicit role matrix: every non-guest member can
         // share/copy; only creators can rename/delete; creators and Team
         // owner/admin members can move. Other surfaces keep their prior rules.
         const canOpenLocation = Boolean(isRecentCollection && onOpenLocation);
         const canRemoveRecent = Boolean(isRecentCollection && onRemoveRecent);
         const canShareProject = Boolean(
           projectHomeWorkspaceId
           && (
             isSharedWithMeCollection
             || recentSharedWithMe
             || (isTeamProjectCollection || recentTeamProject ? !isGuest : (creator.canMutate || creator.canAdmin))
           ),
         );
         const canDuplicateProject = Boolean(
           onDuplicate
           && (
             isSharedWithMeCollection
             || recentSharedWithMe
             || (isTeamProjectCollection || recentTeamProject ? !isGuest : creator.canMutate)
           ),
         );
         const canCopyToPersonal = Boolean(
           homeWorkspaceId
           && space !== 'drafts'
           && !isTeamProjectCollection
           && !isSharedWithMeCollection,
         );
         const canRenameProject = Boolean(
           !isSharedWithMeCollection
           && !recentSharedWithMe
           && onRename
           && creator.canMutate
           && (!recentTeamProject || !isGuest),
         );
         const canMoveProject = Boolean(
           !isRecentCollection
           && !isSharedWithMeCollection
           && (collaborationAvailable || space === 'drafts')
           && (creator.canMutate || creator.canAdmin),
         );
         const canDeleteProject = Boolean(
           !isRecentCollection && !isSharedWithMeCollection && onDelete && creator.canMutate,
         );
         const canRemoveSharedWithMe = Boolean(isSharedWithMeCollection && onRemoveSharedWithMe);
         const hasShareOrCopyActions = canShareProject || canDuplicateProject || canCopyToPersonal;
         const hasManagementActions =
           canRenameProject || canMoveProject || canDeleteProject || canRemoveSharedWithMe;
         const hasRecentActions = canOpenLocation || canRemoveRecent;
         // HDW team-series views always present cards as team-owned with the
         // person who created the project in the bottom-left owner pill.
         const isTeamSeriesView = space === 'team' && Boolean(operator);
         const isSharedBadgeOverride = badgeOverride === 'shared';
         // Explicit self-ownership by the current workspace member always
         // reads as a personal project in this view, even if the project is
         // team-visible or shared with the current user.
         const isSelfOwnedForDisplay = Boolean(
           project.createdByWorkspaceMemberId &&
           project.createdByWorkspaceMemberId === selfMemberId,
         );
         // Project type badge: determined solely by the project's workspaceId.
         // workspaceId === sharedSpaceTeamId (or absent) -> personal workspace:
         //   ownedBySelf -> "personal", otherwise -> "shared".
         // workspaceId !== sharedSpaceTeamId -> team workspace -> "team".
         const projectType = isSharedBadgeOverride
           ? 'shared-with-me' as const
           : isTeamSeriesView
             ? 'team' as const
             : isSelfOwnedForDisplay
               ? 'personal' as const
               : (project.workspaceId == null || project.workspaceId === sharedSpaceTeamId)
                 ? (creator.ownedBySelf ? 'personal' as const : 'shared-with-me' as const)
                 : 'team' as const;
         return (
           <div
             key={project.id}
             role="listitem"
             className={`recent-projects__card${designSystemProject ? ' is-design-system-project' : ''}${shared ? ' is-shared' : ''}${projectType ? ` is-${projectType}` : ''}${menuOpenId === project.id ? ' is-menu-open' : ''}${selected ? ' is-selected' : ''}${locationTarget ? ' is-location-target' : ''}${opening ? ' is-opening' : ''}`}
             data-project-id={project.id}
            >
              {selectionMode ? (
                <button
                  type="button"
                  className="recent-projects__select-check"
                  aria-pressed={selected}
                  aria-label={project.name}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSelection(project.id);
                  }}
                >
                  <span aria-hidden>
                    {selected ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width={16}
                        height={16}
                        style={{ display: 'block' }}
                      >
                        <path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z" />
                      </svg>
                    ) : null}
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                className="recent-projects__card-main"
                onClick={() => {
                  if (selectionMode) {
                    toggleSelection(project.id);
                    return;
                  }
                  if (opening) return;
                  const openStartedAt = performance.now();
                  const openRequestId = analytics.newRequestId();
                  const projectRelation = creator.ownedBySelf ? 'self' : 'other';
                  const materialization =
                    project.metadata?.sharedProjectPlaceholderAt != null ? 'required' : 'warm';
                  trackCollection('project_open', {
                    project_key: project.id,
                    project_relation: projectRelation,
                  }, openRequestId);
                  const trackSharedOpenResult = (opened: boolean) => {
                    if (!shared && space !== 'team') return;
                    trackWorkspaceSharedProjectOpenResult(analytics.track, {
                      page_name: analyticsPage,
                      area: 'project_collection',
                      result: opened ? 'success' : 'failed',
                      project_relation: projectRelation,
                      materialization,
                      duration_ms: Math.round(performance.now() - openStartedAt),
                      ...(!opened ? { error_code: 'open_failed' } : {}),
                      ...workspaceDimensions,
                    }, { requestId: openRequestId });
                  };
                  // Release every background cover slot before the project view
                  // starts its foreground files/content reads. Waiting for the
                  // entry shell to unmount is too late: navigation itself needs
                  // those same browser connections. Suspending the thumbnail
                  // gate also unmounts still-loading preview iframes so their
                  // document loads stop competing immediately (Batch A §4.2);
                  // already-loaded frames stay rendered.
                  abortBackgroundCoverRequests();
                  suspendThumbnailLoads();
                  try {
                    const result = onOpen(project.id);
                    if (result && typeof result === 'object' && 'then' in result) {
                      void Promise.resolve(result).then(
                        (opened) => {
                          trackSharedOpenResult(opened !== false);
                          if (opened === false) resumeBackgroundCoverRequests();
                        },
                        () => {
                          trackSharedOpenResult(false);
                          resumeBackgroundCoverRequests();
                        },
                      );
                    } else if (result === false) {
                      trackSharedOpenResult(false);
                      resumeBackgroundCoverRequests();
                    } else {
                      trackSharedOpenResult(true);
                    }
                  } catch {
                    trackSharedOpenResult(false);
                    resumeBackgroundCoverRequests();
                  }
                }}
                aria-busy={opening ? true : undefined}
              >
                {opening ? (
                  <span className="recent-projects__card-opening" aria-hidden>
                    <Icon name="spinner" size={20} />
                  </span>
                ) : null}
                <div
                  className={`recent-projects__card-thumb recent-projects__card-thumb-${cover.kind}`}
                  style={cover.style}
                  aria-hidden
                >
                  <CoverVisibilitySentinel
                    projectId={project.id}
                    onVisible={handleCoverCardVisible}
                  />
                  {(cover.kind === 'image' || cover.kind === 'logo') && cover.src ? (
                    <img
                      className="recent-projects__thumb-media"
                      src={cover.src}
                      alt=""
                      loading="lazy"
                    />
                  ) : cover.kind === 'video' && cover.src ? (
                    <video
                      className="recent-projects__thumb-media"
                      src={cover.src}
                      muted
                      preload="metadata"
                      playsInline
                    />
                  ) : cover.kind === 'html' && cover.src ? (
                    <RecentProjectHtmlThumb
                      src={cover.src}
                      initial={cover.initial}
                      diagnostic={`${project.id}:${cover.name ?? 'unknown'}`}
                      deckCoverOnly={project.metadata?.kind === 'deck'}
                      workspaceContext={workspaceContext}
                    />
                  ) : (
                    <span className="recent-projects__card-glyph">{cover.initial}</span>
                  )}
                  {sharingId === project.id ? (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(255,255,255,0.55)',
                        borderRadius: 'inherit',
                      }}
                    >
                      <Icon name="spinner" size={18} />
                    </span>
                 ) : projectType && view !== 'list' ? (
                  // Grid's thumb has room for the badge as a floating overlay
                  // (hover-revealed, see recent-projects.css); list view's
                  // thumb is far too small (128x52) for it — the inline
                  // variant next to the name below covers that case instead.
                   <span className={`recent-projects__card-badge recent-projects__card-badge--${projectType}${isTeamSeriesView || isSharedBadgeOverride ? ' recent-projects__card-badge--always' : ''}`}>
                     <Icon name={projectType === 'personal' ? 'lock' : projectType === 'team' ? 'users' : 'share'} size={11} />
                     {projectType === 'personal'
                       ? t('recentProjects.personalBadge')
                       : projectType === 'team'
                         ? t('recentProjects.teamBadge')
                         : t('recentProjects.sharedBadge')}
                   </span>
                 ) : null}
               </div>
               <div className="recent-projects__card-meta">
                 <div className="recent-projects__card-name-row">
                   <span
                     className="recent-projects__card-name"
                     {...ellipsisTitleHoverProps(project.name)}
                   >
                     {project.name}
                   </span>
                   {projectType && view === 'list' ? (
                     <span className={`recent-projects__card-badge recent-projects__card-badge--${projectType} recent-projects__card-badge--inline`}>
                       <Icon name={projectType === 'personal' ? 'lock' : projectType === 'team' ? 'users' : 'share'} size={11} />
                       {projectType === 'personal'
                         ? t('recentProjects.personalBadge')
                         : projectType === 'team'
                           ? t('recentProjects.teamBadge')
                           : t('recentProjects.sharedBadge')}
                     </span>
                   ) : null}
                 </div>
                <div className="recent-projects__card-footer">
                  <div className="recent-projects__card-time">
                    <>
                      {creator.ownedBySelf ? (
                        <span
                          className="recent-projects__card-owner"
                          style={{ backgroundColor: '#000' }}
                          aria-hidden
                        >
                          {t('recentProjects.selfCreator')}
                        </span>
                      ) : (
                        <span
                          className="recent-projects__card-owner"
                          title={creator.name}
                          style={{
                            backgroundColor: avatarColorForDisplayName(creator.name),
                          }}
                          aria-hidden
                        >
                          {creator.name}
                        </span>
                      )}
                      <span className="recent-projects__card-sep" aria-hidden>·</span>
                    </>
                    {relativeTime(project.updatedAt, t)}
                  </div>
                </div>
               </div>
              </button>
              {canShowCardActions && !selectionMode && (hasShareOrCopyActions || hasManagementActions || hasRecentActions) ? (
               <div
                 className="recent-projects__card-menu-anchor"
                  ref={menuOpenId === project.id ? menuContainerRef : undefined}
                >
                  <button
                    type="button"
                  className="recent-projects__card-more"
                  aria-label={t('designs.menuMore')}
                  aria-haspopup="menu"
                  aria-expanded={menuOpenId === project.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      trackCollection('more_menu', {
                        project_key: project.id,
                        project_relation: creator.ownedBySelf ? 'self' : 'other',
                      });
                      setShareErrorProjectId(null);
                      setMenuOpenId((current) => current === project.id ? null : project.id);
                    }}
                  >
                    <Icon name="more-horizontal" size={14} />
                  </button>
                  {menuOpenId === project.id ? (
                    <div
                      className="recent-projects__card-menu"
                      data-placement={menuPlacement}
                      ref={menuRef}
                      role="menu"
                      onClick={(event) => event.stopPropagation()}
                    >
                     {canOpenLocation ? (
                       <button
                         type="button"
                         role="menuitem"
                         onClick={() => {
                           setMenuOpenId(null);
                           try {
                             const result = onOpenLocation?.(project.id);
                             if (result && typeof result === 'object' && 'then' in result) {
                               void Promise.resolve(result).then(
                                 (opened) => {
                                   if (opened === false) {
                                     setCopyToast({ message: t('project.missing'), tone: 'error' });
                                   }
                                 },
                                 () => setCopyToast({ message: t('project.missing'), tone: 'error' }),
                               );
                             } else if (result === false) {
                               setCopyToast({ message: t('project.missing'), tone: 'error' });
                             }
                           } catch {
                             setCopyToast({ message: t('project.missing'), tone: 'error' });
                           }
                         }}
                       >
                         <Icon name="folder" size={12} />
                         <span>{t('recentProjects.openLocation')}</span>
                       </button>
                     ) : null}
                     {canOpenLocation && (hasShareOrCopyActions || hasManagementActions) ? (
                       <div className="recent-projects__card-menu-separator" role="separator" />
                     ) : null}
                     {canShareProject ? (
                       <button
                         type="button"
                         role="menuitem"
                         onClick={() => {
                           setSharedSpaceTarget(project);
                           setMenuOpenId(null);
                         }}
                       >
                         <Icon name="share" size={12} />
                         <span>{t('sharedSpace.shareToSharedSpace')}</span>
                       </button>
                     ) : null}
                     {canDuplicateProject ? (
                       <button
                         type="button"
                         role="menuitem"
                         onClick={() => requestDuplicate(project)}
                       >
                         <Icon name="copy" size={12} />
                         <span>{space === 'recent' ? t('recentProjects.copyAndOpen') : t('designs.menuDuplicate')}</span>
                       </button>
                     ) : null}
                     {canCopyToPersonal ? (
                       <button
                         type="button"
                         role="menuitem"
                         disabled={copyPendingId === project.id}
                         onClick={() => requestCopyToPersonal(project)}
                       >
                         <Icon name="copy" size={12} />
                         <span>
                           {copyPendingId === project.id
                             ? t('recentProjects.shareInProgress')
                             : t('recentProjects.copyToPersonal')}
                         </span>
                       </button>
                     ) : null}
                     {hasShareOrCopyActions && hasManagementActions ? (
                       <div className="recent-projects__card-menu-separator" role="separator" />
                     ) : null}
                     {canRenameProject ? (
                       <button
                         type="button"
                         role="menuitem"
                         disabled={!creator.canMutate}
                         title={creator.canMutate ? undefined : t('recentProjects.ownOnlyMutation')}
                         onClick={() => startRename(project)}
                       >
                         <Icon name="pencil" size={12} />
                         <span>{t('designs.menuRename')}</span>
                       </button>
                     ) : null}
                     {canMoveProject ? (
                       <button
                         type="button"
                         role="menuitem"
                         disabled={sharingId === project.id || unsharingId === project.id}
                         onClick={() => requestMove(project, 'to-team')}
                       >
                         <Icon name="move" size={12} />
                         <span>
                           {sharingId === project.id || unsharingId === project.id
                             ? t('recentProjects.shareInProgress')
                             : t('recentProjects.moveTo')}
                         </span>
                       </button>
                     ) : null}
                     {shareErrorProjectId === project.id ? (
                        <div className="recent-projects__card-menu-error" role="alert">
                          {t(
                            shareErrorKind === 'unshare'
                              ? 'recentProjects.unshareFailed'
                              : shareErrorKind === 'owner-conflict'
                                ? 'recentProjects.shareOwnerConflict'
                                : 'recentProjects.shareFailed',
                          )}
                        </div>
                      ) : null}
                     {canDeleteProject ? (
                       <button
                         type="button"
                         role="menuitem"
                         disabled={!creator.canMutate}
                         title={creator.canMutate ? undefined : t('recentProjects.ownOnlyMutation')}
                         onClick={() => requestDelete(project)}
                       >
                         <Icon name="close" size={12} />
                         <span>{t('designs.menuDelete')}</span>
                       </button>
                     ) : null}
                     {canRemoveSharedWithMe ? (
                       <button
                         type="button"
                         role="menuitem"
                         onClick={() => {
                           setMenuOpenId(null);
                           onRemoveSharedWithMe?.(project.id);
                         }}
                       >
                         <Icon name="close" size={12} />
                         <span>{t('sharedSpace.removeFromSharedWithMe')}</span>
                       </button>
                     ) : null}
                     {canRemoveRecent ? (
                       <>
                         <button
                           type="button"
                           role="menuitem"
                           onClick={() => {
                             setMenuOpenId(null);
                             onRemoveRecent?.(project.id);
                           }}
                         >
                           <Icon name="close" size={12} />
                           <span>{t('recentProjects.removeRecent')}</span>
                         </button>
                       </>
                     ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
       })}
     </div>
      {sharedSpaceTarget && (
        sharedWithMeHomeWorkspaceId?.(sharedSpaceTarget.id)
        ?? (space === 'recent' ? sharedSpaceTarget.workspaceId?.trim() || null : homeWorkspaceId)
      ) ? (
         <UnifiedShareDialog
           projectId={sharedSpaceTarget.id}
           workspaceId={
             sharedWithMeHomeWorkspaceId?.(sharedSpaceTarget.id)
             ?? (space === 'recent' ? sharedSpaceTarget.workspaceId?.trim() || '' : homeWorkspaceId ?? '')
           }
           projectName={sharedSpaceTarget.name}
           entryFile={sharedSpaceTarget.metadata?.entryFile ?? null}
           workspaceContext={sharedWithMeHomeWorkspaceId?.(sharedSpaceTarget.id) ? null : workspaceContext}
           canPublishToCommunity={sharedWithMeHomeWorkspaceId?.(sharedSpaceTarget.id)
             ? false
             : space === 'team'
               ? resolveCreator(sharedSpaceTarget).ownedBySelf
               : true}
           canShareFile={sharedWithMeHomeWorkspaceId?.(sharedSpaceTarget.id)
             ? false
             : isTeamProjectCollection
               ? resolveCreator(sharedSpaceTarget).ownedBySelf
               : true}
          onClose={() => setSharedSpaceTarget(null)}
          onShared={() => {
            notifyTeamProjectsChanged();
            window.dispatchEvent(new CustomEvent('personal:folders-updated'));
            window.dispatchEvent(
              new CustomEvent('hdw:folders-updated', {
                detail: { teamId: workspaceContext?.workspaceId },
              }),
            );
          }}
        />
      ) : null}
      {copyToPersonalTarget ? (
        <MoveToTeamTreeDialog
          onConfirm={(selection) => { void handleCopyToPersonalConfirm(selection); }}
          onCancel={() => setCopyToPersonalTarget(null)}
          busy={copyPendingId === copyToPersonalTarget.id}
          mode="unified"
          copyMode
          currentWorkspaceId={currentWorkspaceId ?? workspaceContext?.workspaceId ?? null}
          currentFolderId={currentFolderId ?? null}
          disabledKeys={disabledKeys}
          canMoveToPersonal
        />
      ) : null}
      {renameTarget ? (
        <Dialog
          as="form"
          className="modal-rename"
          onClose={cancelRename}
          closeOnEscape
          ariaLabelledBy={renameTitleId}
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <DialogTitle id={renameTitleId}>{t('designs.renameTitle')}</DialogTitle>
          <label>
            {t('designs.renamePrompt', { name: renameTarget.original })}
            <input
              type="text"
              value={renameInput}
              autoFocus
              onChange={(event) => setRenameInput(event.target.value)}
            />
          </label>
          <DialogFooter className="row">
            <button type="button" onClick={cancelRename}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!renameInput.trim() || renameInput.trim() === renameTarget.original}
            >
              {t('designs.renameSave')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
      {confirmTarget ? (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => {
            if (deletePending) return;
            setConfirmTarget(null);
            setDeleteFailed(false);
          }}
          closeOnBackdrop={!deletePending}
          ariaLabelledBy={confirmTitleId}
        >
          <DialogTitle id={confirmTitleId}>{t('designs.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('designs.deleteConfirm', { name: confirmTarget.name })}
          </DialogDescription>
          {deleteFailed ? (
            <p className="recent-projects__card-menu-error" role="alert">
              {t('ds.actionFailed')}
            </p>
          ) : null}
          <DialogFooter className="row">
            <button
              type="button"
              disabled={deletePending}
              onClick={() => {
                setConfirmTarget(null);
                setDeleteFailed(false);
              }}
            >
              {t('designs.renameCancel')}
            </button>
            <button
              type="button"
              className="primary danger"
              disabled={deletePending}
              onClick={() => void commitDelete()}
            >
              {t('designs.menuDelete')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
   {moveToTeamTarget ? (
     <MoveToTeamTreeDialog
       onConfirm={handleMoveToTeamConfirm}
       onCancel={() => setMoveToTeamTarget(null)}
       busy={sharingId === moveToTeamTarget.id}
       mode={moveToTreeMode}
       currentWorkspaceId={currentWorkspaceId ?? workspaceContext?.workspaceId ?? null}
       currentFolderId={currentFolderId ?? null}
       disabledKeys={disabledKeys}
      canMoveToPersonal={resolveCreator(moveToTeamTarget).ownedBySelf}
     />
  ) : null}
  {bulkMoveToTeamOpen ? (
     <MoveToTeamTreeDialog
       onConfirm={handleBulkMoveToTeamConfirm}
       onCancel={() => setBulkMoveToTeamOpen(false)}
       mode="unified"
       currentWorkspaceId={currentWorkspaceId ?? workspaceContext?.workspaceId ?? null}
       currentFolderId={currentFolderId ?? null}
       restrictToWorkspaceId={extensionSelectedCount > 0 ? selectionExtension?.restrictMoveToWorkspaceId : undefined}
       disabledSubtreeKeys={extensionSelectedCount > 0 ? selectionExtension?.disabledMoveKeys : undefined}
       disabledKeys={disabledKeys}
      canMoveToPersonal={!selectedProjects.some(({ creator }) => !creator.ownedBySelf)}
       titleLabel={selectionExtension?.moveDialogTitle}
       treeDescription={selectionExtension?.moveTreeDescription}
       rootSelectedLabel={selectionExtension?.moveRootSelectedLabel}
     />
   ) : null}
     {bulkDeleteOpen ? (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => setBulkDeleteOpen(false)}
          closeOnEscape
          ariaLabelledBy={bulkDeleteTitleId}
        >
          <DialogTitle id={bulkDeleteTitleId}>{t('designs.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('designs.deleteSelectedConfirm', { n: selectedCount })}
          </DialogDescription>
          <DialogFooter className="row">
            <button type="button" onClick={() => setBulkDeleteOpen(false)}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="button"
              className="primary danger"
              onClick={() => void commitBulkDelete()}
            >
              {t('designs.deleteSelected')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        workspaceContext={workspaceContext}
        canAssignRoles={
          canAssignInviteRoles ?? workspaceContext?.permissions.canInviteMembers === true
        }
      />
      {copyToast ? (
        <Toast
          message={copyToast.message}
          tone={copyToast.tone}
          onDismiss={() => setCopyToast(null)}
        />
      ) : null}
    </section>
  );
}

// Card thumbnails for HTML projects render the real artifact, not a
// placeholder: a plain prototype page loads straight into a lazy sandboxed
// iframe, while a deck collapses to its first slide (`DeckCoverThumb`) so the
// card shows a cover instead of whichever slide the deck script last left on
// screen.
function RecentProjectHtmlThumb({
  src,
  initial,
  diagnostic,
  deckCoverOnly,
  workspaceContext,
}: {
  src: string;
  initial: string;
  diagnostic: string;
  deckCoverOnly: boolean;
  workspaceContext?: WorkspaceCollabContext | null;
}) {
  // Plain HTML goes through the shared cover frame (#5762): it HEAD-probes the
  // cover URL in the parent cover queue first and falls back to the initial
  // glyph when the entry file has gone missing. Keeping verification in that
  // queue is what prevents an All Projects grid from launching one HEAD per
  // card at once.
  if (!deckCoverOnly) {
    return (
      <VerifiedHtmlCoverFrame
        src={src}
        initial={initial}
        diagnostic={diagnostic}
      />
    );
  }

  return <DeckCoverThumb src={src} workspaceContext={workspaceContext} />;
}

function VerifiedHtmlCoverFrame({
  src,
  initial,
  diagnostic,
}: {
  src: string;
  initial: string;
  diagnostic: string;
}) {
  const [failed, setFailed] = useState(false);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    setFailed(false);
    setVerified(false);
  }, [src]);
  // The iframe document load is deferred until the card is near the viewport
  // and one of the shared thumbnail load slots is free, so a large grid
  // cannot flood the daemon with background document loads (Batch A §4.2).
  const { ref: inViewRef, inView } = useInView<HTMLSpanElement>({
    rootMargin: THUMBNAIL_OVERSCAN_MARGIN,
  });
  const { canLoad, settle } = useThumbnailLoadSlot(inView && !failed);
  // HEAD-probe before committing to an iframe document load. An <iframe>
  // fires onLoad (not onError) for HTTP 404/500 responses, so the browser
  // treats the error body as a successful document. The upstream
  // loadProjectCover probe can be bypassed by stale snapshot cache entries
  // when a project is deleted between probe and render; this per-card probe
  // closes that gap. It runs inside the thumbnail load slot budget, so it
  // does not add unbounded concurrency.
  useEffect(() => {
    if (!canLoad || failed || verified) return;
    let cancelled = false;
    fetch(src, { method: 'HEAD', cache: 'no-store' })
      .then((response) => {
        if (cancelled) return;
        if (response.ok || response.status === 304) {
          setVerified(true);
        } else {
          console.warn(
            `[project-cover] HTML cover unavailable (${response.status} ${response.statusText}):`,
            diagnostic,
          );
          settle();
          setFailed(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('[project-cover] failed to verify HTML cover:', diagnostic, err);
        settle();
        setFailed(true);
      });
    return () => { cancelled = true; };
  }, [canLoad, failed, verified, src, diagnostic, settle]);
  if (failed) {
    return <span className="recent-projects__card-glyph">{initial}</span>;
  }
  if (!canLoad || !verified) {
    return (
      <span ref={inViewRef} className="recent-projects__card-glyph">
        {initial}
      </span>
    );
  }
  return (
    <iframe
      className="recent-projects__thumb-iframe"
      src={src}
      title=""
      loading="lazy"
      sandbox="allow-scripts"
      tabIndex={-1}
      onLoad={settle}
      onError={() => {
        settle();
        console.warn('[project-cover] failed to load HTML cover:', diagnostic);
        setFailed(true);
      }}
    />
  );
}

// Zero-interaction marker that tells the strip when a card's thumbnail area
// first comes near the viewport. Cover probes (files scan + HEAD) start only
// after this fires, so offscreen cards in a 100+ project grid cost nothing
// until scrolled toward (Batch A §4.2).
function CoverVisibilitySentinel({
  projectId,
  onVisible,
}: {
  projectId: string;
  onVisible: (projectId: string) => void;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>({
    rootMargin: THUMBNAIL_OVERSCAN_MARGIN,
  });
  const seenRef = useRef(false);
  useEffect(() => {
    if (!inView || seenRef.current) return;
    seenRef.current = true;
    onVisible(projectId);
  }, [inView, onVisible, projectId]);
  return (
    <span
      ref={ref}
      aria-hidden
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', visibility: 'hidden' }}
    />
  );
}

function DeckCoverThumb({
  src,
  workspaceContext,
}: {
  src: string;
  workspaceContext?: WorkspaceCollabContext | null;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const { ref: inViewRef, inView } = useInView<HTMLDivElement>({
    rootMargin: THUMBNAIL_OVERSCAN_MARGIN,
  });
  const setFrameRef = useCallback(
    (node: HTMLDivElement | null) => {
      frameRef.current = node;
      inViewRef.current = node;
    },
    [inViewRef],
  );
  const [srcDoc, setSrcDoc] = useState<string | null>(() => deckCoverCache.get(src) ?? null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const cached = deckCoverCache.get(src);
    if (cached) {
      setSrcDoc(cached);
      return;
    }
    setSrcDoc(null);
    // Deck covers fetch the full document text; defer that until the card is
    // actually near the viewport (Batch A §4.2).
    if (!inView) return;
    loadDeckCover(src, undefined, workspaceContext)
      .then((next) => {
        if (!cancelled) setSrcDoc(next);
      })
      .catch(() => {
        if (cancelled) return;
        setSrcDoc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [src, inView, workspaceContext]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setScale(Math.min(rect.width / DECK_PREVIEW_WIDTH, rect.height / DECK_PREVIEW_HEIGHT));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={setFrameRef}
      className="recent-projects__deck-frame"
      style={{ '--recent-deck-scale': scale } as CSSProperties}
      aria-hidden
    >
      {srcDoc ? (
        <iframe
          className="recent-projects__deck-iframe"
          srcDoc={srcDoc}
          title=""
          loading="lazy"
          sandbox=""
          tabIndex={-1}
        />
      ) : (
        <span className="recent-projects__deck-cover-loading" aria-hidden />
      )}
    </div>
  );
}

async function loadDeckCover(
  src: string,
  signal?: AbortSignal,
  workspaceContext?: WorkspaceCollabContext | null,
): Promise<string> {
  const cached = deckCoverCache.get(src);
  if (cached) return cached;
  if (signal) {
    const response = await fetch(src, {
      signal,
      ...(workspaceContext ? { headers: workspaceProjectHeaders(workspaceContext) } : {}),
    });
    if (!response.ok) throw new Error(`Failed to load project cover: ${response.status}`);
    const parsed = deckPreviewSrcDoc(await response.text());
    if (!signal.aborted) deckCoverCache.set(src, parsed);
    return parsed;
  }
  const existing = deckCoverInflight.get(src);
  if (existing) return existing;
  const run = fetch(src)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load project cover: ${res.status}`);
      return res.text();
    })
    .then((html) => {
      const parsed = deckPreviewSrcDoc(html);
      deckCoverCache.set(src, parsed);
      deckCoverInflight.delete(src);
      return parsed;
    })
    .catch((error) => {
      deckCoverInflight.delete(src);
      throw error;
    });
  deckCoverInflight.set(src, run);
  return run;
}

export function deckPreviewSrcDoc(html: string): string {
  const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '');
  const withCoverSlide = markFirstDeckPage(withoutScripts);
  const style = `<style id="od-recent-deck-real-preview">
    html,
    body {
      margin: 0 !important;
      width: ${DECK_PREVIEW_WIDTH}px !important;
      height: ${DECK_PREVIEW_HEIGHT}px !important;
      overflow: hidden !important;
    }
    body {
      display: block !important;
      scroll-snap-type: none !important;
    }
    :where(body *):has(> [data-od-cover-slide]) {
      position: absolute !important;
      inset: 0 !important;
      width: ${DECK_PREVIEW_WIDTH}px !important;
      height: ${DECK_PREVIEW_HEIGHT}px !important;
      margin: 0 !important;
      overflow: hidden !important;
      transform: none !important;
      transform-origin: 0 0 !important;
    }
    .slide,
    section[data-slide],
    section[data-screen-label] {
      position: absolute !important;
      inset: 0 !important;
      width: ${DECK_PREVIEW_WIDTH}px !important;
      height: ${DECK_PREVIEW_HEIGHT}px !important;
      flex: none !important;
      scroll-snap-align: none !important;
    }
    [data-od-cover-slide] {
      opacity: 1 !important;
      visibility: visible !important;
      transform: none !important;
    }
    [data-od-cover-slide] > *,
    [data-od-cover-slide] [data-anim],
    [data-od-cover-slide] .reveal {
      animation: none !important;
      transition: none !important;
      opacity: 1 !important;
      visibility: visible !important;
      transform: none !important;
      clip-path: none !important;
    }
    .slide:not([data-od-cover-slide]),
    section[data-slide]:not([data-od-cover-slide]),
    section[data-screen-label]:not([data-od-cover-slide]),
    .deck-counter,
    .deck-controls,
    .deck-hint,
    .deck-page-controls,
    .deck-pager,
    .deck-progress,
    .deck-nav,
    .deck-navigation,
    .page-controls,
    .page-flip-controls,
    .page-nav,
    .page-navigation,
    .pagination-control,
    .pagination-controls,
    #deck-prev,
    #deck-next,
    #deck-cur,
    #deck-total,
    #hint,
    [data-deck-controls],
    [data-page-controls],
    [data-pagination],
    [aria-label="Previous slide"],
    [aria-label="Next slide"],
    [aria-label="Deck navigation"],
    [aria-label="Page navigation"],
    [aria-label="Pagination"],
    nav[aria-label*="page" i],
    nav[aria-label*="pagination" i] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  </style>`;
  return injectBefore(withCoverSlide, '</head>', style);
}

function markFirstDeckPage(html: string): string {
  const tags = [...html.matchAll(/<[a-z][\w:-]*\b[^>]*>/giu)];
  const classSlide = tags.find((match) => {
    const className = match[0].match(/\bclass\s*=\s*(["'])(.*?)\1/iu)?.[2];
    return className?.split(/\s+/u).includes('slide') === true;
  });
  const page = classSlide
    ?? tags.find((match) => /\sdata-slide(?:\s|=|>)/iu.test(match[0]))
    ?? tags.find((match) => /\sdata-screen-label(?:\s|=|>)/iu.test(match[0]));
  if (!page || page.index === undefined) return html;
  const tag = page[0];
  const classAttribute = tag.match(/\bclass\s*=\s*(["'])(.*?)\1/iu);
  const activeClasses = ['active', 'is-active'];
  let activated = tag;
  if (classAttribute) {
    const quote = classAttribute[1];
    const classes = classAttribute[2]?.split(/\s+/u).filter(Boolean) ?? [];
    for (const activeClass of activeClasses) {
      if (!classes.includes(activeClass)) classes.push(activeClass);
    }
    activated = activated.replace(
      classAttribute[0],
      `class=${quote}${classes.join(' ')}${quote}`,
    );
  } else {
    activated = activated.replace(/\s*\/?\s*>$/u, (ending) => (
      ` class="${activeClasses.join(' ')}"${ending}`
    ));
  }
  activated = activated
    .replace(/\saria-hidden\s*=\s*(["'])true\1/iu, ' aria-hidden="false"')
    .replace(/\shidden(?:\s*=\s*(["'])?hidden\1?)?(?=\s|\/?\s*>)/iu, '');
  const marked = activated.endsWith('/>')
    ? `${activated.slice(0, -2)} data-od-cover-slide />`
    : `${activated.slice(0, -1)} data-od-cover-slide>`;
  return `${html.slice(0, page.index)}${marked}${html.slice(page.index + tag.length)}`;
}

function injectBefore(source: string, marker: string, addition: string): string {
  const index = source.toLowerCase().lastIndexOf(marker);
  if (index === -1) return `${addition}${source}`;
  return `${source.slice(0, index)}${addition}${source.slice(index)}`;
}

function statusLabel(
  status: ProjectDisplayStatus,
  t: ReturnType<typeof useT>,
): string {
  return t(STATUS_LABEL_KEYS[status]);
}

function relativeTime(ts: number, t: ReturnType<typeof useT>): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return t('common.justNow');
  if (diff < hr) return t('common.minutesAgo', { n: Math.floor(diff / min) });
  if (diff < day) return t('common.hoursAgo', { n: Math.floor(diff / hr) });
  if (diff < 7 * day) return t('common.daysAgo', { n: Math.floor(diff / day) });
  return new Date(ts).toLocaleDateString();
}

export function projectCover(
  project: Project,
  override: ProjectCoverOverride | null,
  workspaceContext?: WorkspaceCollabContext | null,
  sharedSpaceTeamId?: string | null,
): {
  kind: 'image' | 'video' | 'html' | 'logo' | 'fallback';
  src?: string;
  style: CSSProperties;
  initial: string;
  name?: string;
} {
  const { style, initial } = projectFallbackVisual(project.id, project.name);
 // Use the pre-captured entry screenshot from team_projects.cover_digest
 // when available — a single <img> load is far cheaper than resolving the
 // entry file, probing with HEAD, and rendering an iframe document.
  if (project.coverDigest) {
    // Personal projects (workspaceVisibility === 'personal') load the
    // cover from the local daemon route; team and shared-with-me projects
    // (workspaceVisibility === 'team' or undefined) load from HDW.
    const isPersonal = project.workspaceVisibility === 'personal';
    const coverSrc = isPersonal
      ? `/api/projects/${encodeURIComponent(project.id)}/cover?digest=${encodeURIComponent(project.coverDigest)}`
      : `/api/hdw/api/community/cover/${project.coverDigest}`;
    return {
      kind: 'image' as const,
      src: coverSrc,
      style,
      initial,
    };
  }
 // Catalog-only team projects have not been materialized locally yet - the
  // files do not exist on disk. Any override (stale snapshot cache) or
  // entryFile metadata would point the iframe at a /raw/ URL for a file that
  // does not exist, producing a 404 load. Short-circuit to the fallback glyph
  // before the override/entryFile paths can build a src.
  if (project.metadata?.sharedProjectPlaceholderAt != null) {
    return { kind: 'fallback', style, initial };
  }
  if (override) {
    return {
      kind: override.kind,
      src: projectCoverUrl(
        project.id,
        override.name,
        override.mtime,
        workspaceContext,
      ),
      style,
      initial,
      name: override.name,
    };
  }
  const meta = project.metadata;
  const entry = meta?.entryFile;
  // Catalog-only team projects have metadata (including entryFile) synced from
  // the team catalog, but the actual files are not materialized locally until
  // the first open. Building a src from entryFile here would point the iframe
  // at a /raw/ URL for a file that does not exist yet — a 404 load. Skip the
  // entryFile path for placeholders so the card shows the fallback glyph.
  if (entry && meta?.sharedProjectPlaceholderAt == null) {
    const src = projectCoverUrl(
      project.id,
      entry,
      project.updatedAt,
      workspaceContext,
    );
    if (meta?.kind === 'image') return { kind: 'image', src, style, initial };
    if (meta?.kind === 'video') return { kind: 'video', src, style, initial };
    if (/\.html?$/i.test(entry)) return { kind: 'html', src, style, initial, name: entry };
  }
  return { kind: 'fallback', style, initial };
}

export type ProjectCategory =
  | 'prototype'
  | 'live-artifact'
  | 'web-clone'
  | 'slide'
  | 'media'
  | 'brand';

/** Every chip a project card can wear, `ProjectCategory` plus the
 *  design-system tag the card substitutes for it. */
export type ProjectCardCategory = ProjectCategory | 'design-system';

/**
 * The type a card actually advertises — the single source of truth behind both
 * the chip in the card footer and the header's type filter. It mirrors the
 * card's own branch: a design-system project wears the Design System tag,
 * everything else falls through to {@link projectCategory}. Filtering must go
 * through this, never through the raw `metadata.kind`, or the dropdown starts
 * offering types no chip displays.
 */
export function projectCardCategory(project: Project): ProjectCardCategory {
  return isDesignSystemProject(project) ? 'design-system' : projectCategory(project);
}

export function projectCategory(project: Project): ProjectCategory {
  const meta = project.metadata;
  if (meta?.intent === 'live-artifact' || project.skillId === 'live-artifact') {
    return 'live-artifact';
  }
  // Website clone projects still store `kind: 'prototype'` (see
  // home-hero/chips.ts's 'web-clone' chip) so preview behavior stays
  // identical to a blank prototype; only `intent: 'web-clone'` marks the
  // scenario. Without this branch every clone fell through to the default
  // 'prototype' bucket and had no way to be filtered separately (recvpZbvupSr1o).
  if (meta?.intent === 'web-clone') return 'web-clone';
  if (meta?.kind === 'deck') return 'slide';
  if (meta?.kind === 'brand') return 'brand';
  if (meta?.kind === 'image' || meta?.kind === 'video' || meta?.kind === 'audio') {
    return 'media';
  }
  return 'prototype';
}

export function ProjectTag({ category }: { category: ProjectCategory }) {
  const t = useT();
  const label =
    category === 'live-artifact'
      ? t('designs.tagLiveArtifact')
      : category === 'web-clone'
        ? t('designs.tagWebClone')
        : category === 'slide'
          ? t('designs.tagSlide')
          : category === 'brand'
            ? 'Brand'
          : category === 'media'
            ? t('designs.tagMedia')
            : t('designs.tagPrototype');
  return <span className={`design-card-tag tag-${category}`}>{label}</span>;
}


function findDesignSystemLogoFile(files: ProjectFile[]): ProjectFile | null {
  const logoCandidates = files
    .filter((file) => file.type !== 'dir')
    .filter((file) => {
      const name = file.path ?? file.name;
      return file.kind === 'image' || /\.(svg|png|jpe?g|webp|gif)$/iu.test(name);
    });
  return (
    logoCandidates.find((file) => (file.path ?? file.name).toLowerCase() === 'assets/logo.svg') ??
    logoCandidates.find((file) => /(^|\/)(logo|wordmark|brand-mark|brandmark|mark|icon|favicon)[^/]*\.(svg|png|jpe?g|webp|gif)$/iu.test(file.path ?? file.name)) ??
    null
  );
}

async function findDesignSystemCover(
  projectId: string,
  files: ProjectFile[],
  signal?: AbortSignal,
  workspaceContext?: WorkspaceCollabContext | null,
): Promise<ProjectCoverOverride | null> {
  const knownFiles = new Map(files.map((file) => [file.path ?? file.name, file]));
  const brandCover = await designSystemCoverFromBrandJson(
    projectId,
    knownFiles,
    signal,
    workspaceContext,
  );
  if (signal?.aborted) return null;
  if (brandCover) return brandCover;

  const logo = findDesignSystemLogoFile(files);
  if (!logo) return null;
  return coverFromProjectFile(logo, 'logo');
}

async function designSystemCoverFromBrandJson(
  projectId: string,
  knownFiles: ReadonlyMap<string, ProjectFile>,
  signal?: AbortSignal,
  workspaceContext?: WorkspaceCollabContext | null,
): Promise<ProjectCoverOverride | null> {
  const raw = await fetchProjectFileText(projectId, 'brand.json', {
    cache: 'no-store',
    signal,
    workspaceContext,
  });
  if (signal?.aborted) return null;
  if (!raw) return null;
  let brand: unknown;
  try {
    brand = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!brand || typeof brand !== 'object') return null;
  const root = brand as Record<string, unknown>;
  const imagery = root.imagery && typeof root.imagery === 'object'
    ? root.imagery as Record<string, unknown>
    : null;
  const samples = Array.isArray(imagery?.samples) ? imagery.samples : [];
  const samplePaths = samples
    .filter((sample): sample is Record<string, unknown> => Boolean(sample && typeof sample === 'object'))
    .sort((a, b) => imageSampleRank(a.kind) - imageSampleRank(b.kind))
    .map((sample) => typeof sample.file === 'string' ? sample.file : null)
    .filter((file): file is string => Boolean(file));
  const image = samplePaths.find((file) => knownFiles.has(file) && isRasterOrSvgImage(file));
  if (image) return coverFromProjectFile(knownFiles.get(image)!, 'image');

  const logo = root.logo && typeof root.logo === 'object' ? root.logo as Record<string, unknown> : null;
  const alternates = Array.isArray(logo?.alternates) ? logo.alternates : [];
  const logoCandidates = [
    typeof logo?.primary === 'string' ? logo.primary : null,
    ...alternates,
  ];
  const nonFaviconLogo = logoCandidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' &&
      knownFiles.has(candidate) &&
      isRasterOrSvgImage(candidate) &&
      !/(^|\/)favicon[-.]/iu.test(candidate),
  );
  if (nonFaviconLogo) return coverFromProjectFile(knownFiles.get(nonFaviconLogo)!, 'logo');
  if (typeof logo?.primary === 'string' && knownFiles.has(logo.primary) && isRasterOrSvgImage(logo.primary)) {
    return coverFromProjectFile(knownFiles.get(logo.primary)!, 'logo');
  }
  return null;
}

function imageSampleRank(kind: unknown): number {
  if (kind === 'cover') return 0;
  if (kind === 'hero') return 1;
  return 2;
}

function isRasterOrSvgImage(path: string): boolean {
  return /\.(svg|png|jpe?g|webp|gif)$/iu.test(path);
}
