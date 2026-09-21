import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  getWorkspaceTabsDock,
  subscribeWorkspaceTabsDock,
} from './workspaceTabsDock';
import { useT } from '../i18n';
import { buildPath, navigate, type EntryHomeView, type Route } from '../router';
import type { Project } from '../types';
import { Icon, type IconName } from './Icon';
import {
  HOME_APPLY_TEMPLATE_EVENT,
  orderedCreateChips,
  type HomeHeroChip,
} from './home-hero/chips';
import {
  ENTRY_RAIL_STATE_EVENT,
  ENTRY_RAIL_TOGGLE_EVENT,
  readStoredRailOpen,
} from './entryRailBridge';
import { homeHeroChipLabel } from './home-hero/chip-labels';
import { useGlideIndicator } from '../hooks/useGlideIndicator';
import { useLiquidGlass } from '../hooks/useLiquidGlass';
import {
  dispatchCloseWorkspaceExternalTab,
  dispatchOpenWorkspaceTab,
  OPEN_WORKSPACE_TAB_EVENT,
} from './workspaceTabEvents';

type EntryRoute = Extract<Route, { kind: 'home' }>;

type WorkspaceChromeTab =
  | {
      id: string;
      kind: 'entry';
      view: EntryHomeView;
      entryRoute: EntryRoute;
      createdAt: number;
      lastActiveAt: number;
    }
  | {
      id: string;
      kind: 'project';
      projectId: string;
      conversationId: string | null;
      fileName: string | null;
      createdAt: number;
      lastActiveAt: number;
    }
 | {
     id: string;
     kind: 'marketplace';
     pluginId: string | null;
     createdAt: number;
     lastActiveAt: number;
 }
 | {
     id: string;
     kind: 'external';
     url: string;
     title: string;
     resourceKey?: string;
     createdAt: number;
     lastActiveAt: number;
   };

interface WorkspaceTabsState {
  tabs: WorkspaceChromeTab[];
  activeTabId: string;
}

interface PersistedWorkspaceTabsSnapshot {
  state: WorkspaceTabsState;
  updatedAt: number;
}

interface PersistedWorkspaceTabsStore {
  current: WorkspaceTabsState | null;
  scopeKey: string | undefined;
  scopes: Record<string, PersistedWorkspaceTabsSnapshot>;
}

interface DisplayTab {
  id: string;
  title: string;
  meta: string;
  icon: IconName;
  tab: WorkspaceChromeTab;
}

type TabDropEdge = 'before' | 'after';

interface TabDragTarget {
  tabId: string;
  edge: TabDropEdge;
}

interface Props {
  route: Route;
  projects: Project[];
  /**
   * Persisted Workspace binding for the project currently named by `route`.
   * `null` is an authoritative unbound/local project; `undefined` means the
   * current route is not a resolved project and must not relax scope resets.
   */
  activeProjectWorkspaceId?: string | null;
  // Once onboarding is finished, the permanent entry
  // tab must never linger on the 'onboarding' (Welcome) view — some completion
  // paths navigate straight to a new project/design-system and leave the entry
  // tab showing Welcome in the background. This flips it back to Home.
  onboardingCompleted?: boolean;
  /**
   * Stable "AMR account + active workspace" identity key the currently open
   * tabs belong to (derived in App.tsx from `amrLoginStatus` +
   * `workspaceContext` — see the comment there for the exact composition).
   * `null` means "not resolved yet" (before the first AMR status read
   * completes): the bar leaves whatever it already restored from
   * localStorage untouched rather than guessing.
   *
   * Once resolved, each value owns an isolated tab snapshot. Switching to a
   * different workspace restores only that scope's tabs (or a fresh Home tab
   * on first visit), so returning to a workspace keeps its order and active
   * tab without exposing those tabs in another scope.
   */
  identityScopeKey?: string | null;
}

const STORAGE_KEY = 'open-design:workspace-tabs:v1';
const REMOVE_WORKSPACE_PROJECT_TABS_EVENT = 'open-design:workspace-tabs:remove-project';
const ACTIVATE_WORKSPACE_RESOURCE_EVENT = 'open-design:workspace-tabs:activate-resource';
const MAX_PERSISTED_TAB_SCOPES = 12;
const TAB_DRAG_HAPTIC_MS = 8;
const TAB_DROP_HAPTIC_MS = 12;
const CHROME_PINNED_TAB_WIDTH = 78;
const CHROME_TAB_MIN_WIDTH = 84;
const CHROME_TAB_GAP = 2;
const CHROME_TAB_EDGE_INSET = 10;
const CHROME_OVERFLOW_BUTTON_WIDTH = 34;

export interface WorkspaceTabOverflowLayout {
  visibleTabIds: string[];
  overflowTabIds: string[];
}

export function stableWorkspaceTabStripWidth(current: number, measured: number): number {
  // Portal/dock transitions can briefly report a detached/display:none strip as
  // 0px wide. Treat that as "measurement unavailable", not "infinite room":
  // dropping the last valid width here would momentarily reveal every tab and
  // remove the ··· trigger, and a replaced node might never notify the old
  // ResizeObserver again.
  if (!Number.isFinite(measured) || measured <= 0) return current;
  return Math.abs(current - measured) > 0.5 ? measured : current;
}

export function workspaceTabMeasuredAvailableWidth(
  stripLeft: number,
  stripClientWidth: number,
  clusterLefts: readonly number[],
  safetyGap = 12,
): number {
  if (!Number.isFinite(stripClientWidth) || stripClientWidth <= 0) return 0;
  const validClusterLefts = clusterLefts.filter(
    (left) => Number.isFinite(left) && left > stripLeft,
  );
  if (validClusterLefts.length === 0) return stripClientWidth;
  const fixedControlsLeft = Math.min(...validClusterLefts);
  return Math.max(
    0,
    Math.min(stripClientWidth, fixedControlsLeft - stripLeft - safetyGap),
  );
}

/**
 * Resolve the browser-like chrome window for a measured strip width.
 *
 * Tabs first flex-shrink down to CHROME_TAB_MIN_WIDTH. Once even those compact
 * tabs cannot all fit, the strip stops scrolling and moves the excess rows into
 * a trailing overflow menu. The active tab is always kept in the visible
 * window; selecting an overflow row therefore slides the visible window to it.
 */
export function workspaceTabOverflowLayout(
  tabs: readonly WorkspaceChromeTab[],
  activeTabId: string,
  availableWidth: number,
): WorkspaceTabOverflowLayout {
  const allIds = tabs.map((tab) => tab.id);
  if (tabs.length <= 1 || !Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { visibleTabIds: allIds, overflowTabIds: [] };
  }

  const pinned = tabs.find((tab) => tab.kind === 'entry') ?? null;
  const normalTabs = tabs.filter((tab) => tab.kind !== 'entry');
  const contentWidth = Math.max(0, availableWidth - CHROME_TAB_EDGE_INSET);
  const pinnedWidth = pinned ? CHROME_PINNED_TAB_WIDTH : 0;
  const allElementCount = normalTabs.length + (pinned ? 1 : 0);
  const allMinWidth =
    pinnedWidth
    + normalTabs.length * CHROME_TAB_MIN_WIDTH
    + Math.max(0, allElementCount - 1) * CHROME_TAB_GAP;

  if (contentWidth >= allMinWidth) {
    return { visibleTabIds: allIds, overflowTabIds: [] };
  }

  // Reserve the trailing ··· control and one gap before it. For the normal
  // rows themselves, each additional visible tab consumes min-width + one gap.
  const widthForNormalTabs = Math.max(
    0,
    contentWidth
      - pinnedWidth
      - CHROME_OVERFLOW_BUTTON_WIDTH
      - CHROME_TAB_GAP,
  );
  let capacity = Math.floor(
    (widthForNormalTabs + CHROME_TAB_GAP) / (CHROME_TAB_MIN_WIDTH + CHROME_TAB_GAP),
  );

  const activeNormalIndex = normalTabs.findIndex((tab) => tab.id === activeTabId);
  if (activeNormalIndex >= 0) capacity = Math.max(1, capacity);
  capacity = Math.min(normalTabs.length, Math.max(0, capacity));

  let visibleNormalTabs: WorkspaceChromeTab[];
  if (capacity === 0) {
    visibleNormalTabs = [];
  } else if (activeNormalIndex < 0 || activeNormalIndex < capacity) {
    visibleNormalTabs = normalTabs.slice(0, capacity);
  } else {
    const start = Math.min(
      activeNormalIndex - capacity + 1,
      normalTabs.length - capacity,
    );
    visibleNormalTabs = normalTabs.slice(start, start + capacity);
  }

  const visible = new Set<string>([
    ...(pinned ? [pinned.id] : []),
    ...visibleNormalTabs.map((tab) => tab.id),
  ]);
  return {
    visibleTabIds: tabs.filter((tab) => visible.has(tab.id)).map((tab) => tab.id),
    overflowTabIds: tabs.filter((tab) => !visible.has(tab.id)).map((tab) => tab.id),
  };
}

function consumeWorkspaceTabShortcut(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function shouldDeferShortcutToProjectWorkspace(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[data-testid="file-workspace"]') !== null;
}

export function openWorkspaceTab(route: Route): void {
  dispatchOpenWorkspaceTab(route);
}

/** Activates an existing singleton tool tab without issuing a new SSO ticket. */
export function activateWorkspaceResource(resourceKey: string): boolean {
  const detail = { resourceKey, handled: false };
  window.dispatchEvent(
    new CustomEvent<typeof detail>(ACTIVATE_WORKSPACE_RESOURCE_EVENT, { detail }),
  );
  return detail.handled;
}

export function removeWorkspaceProjectTabs(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent<{ projectId: string }>(REMOVE_WORKSPACE_PROJECT_TABS_EVENT, {
      detail: { projectId },
    }),
  );
}

function nowId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const ENTRY_HOME_VIEWS = new Set<EntryHomeView>([
  'home',
  'onboarding',
  'projects',
  'tasks',
  'plugins',
  'design-systems',
  'library',
  'brands',
  'integrations',
  'community',
  'drafts',
  'square',
  'all-projects',
  'my-publishes',
  'members',
  'board',
  'workspace-settings',
  'team-space',
  'team-folder',
  'personal-all',
  'shared-with-me',
  'shared-folder',
  'personal-folder',
  'settings',
]);

function isEntryHomeView(value: unknown): value is EntryHomeView {
  return typeof value === 'string' && ENTRY_HOME_VIEWS.has(value as EntryHomeView);
}

function reviveEntryRoute(value: unknown, view: EntryHomeView): EntryRoute {
  if (value === null || typeof value !== 'object') return { kind: 'home', view };
  const record = value as Record<string, unknown>;
  if (record.kind !== 'home' || record.view !== view) return { kind: 'home', view };
  return {
    kind: 'home',
    view,
    ...(typeof record.brandId === 'string' ? { brandId: record.brandId } : {}),
    ...(typeof record.teamId === 'string' ? { teamId: record.teamId } : {}),
    ...(typeof record.folderId === 'string' ? { folderId: record.folderId } : {}),
    ...(typeof record.tab === 'string' ? { tab: record.tab } : {}),
    ...(typeof record.sharedFolderId === 'string'
      ? { sharedFolderId: record.sharedFolderId }
      : {}),
  };
}

function createEntryTab(
  view: EntryHomeView,
  timestamp = Date.now(),
  entryRoute: EntryRoute = { kind: 'home', view },
): WorkspaceChromeTab {
  return {
    id: `entry:${view}:${nowId()}`,
    kind: 'entry',
    view,
    entryRoute,
    createdAt: timestamp,
    lastActiveAt: timestamp,
  };
}

function tabFromRoute(route: Route, timestamp = Date.now()): WorkspaceChromeTab {
  if (route.kind === 'project') {
    return {
      id: `project:${route.projectId}:${nowId()}`,
      kind: 'project',
      projectId: route.projectId,
      conversationId: route.conversationId ?? null,
      fileName: route.fileName,
      createdAt: timestamp,
      lastActiveAt: timestamp,
    };
  }
 if (route.kind === 'marketplace' || route.kind === 'marketplace-detail') {
   const pluginId = route.kind === 'marketplace-detail' ? route.pluginId : null;
   return {
     id: `marketplace:${pluginId ?? 'index'}:${nowId()}`,
     kind: 'marketplace',
     pluginId,
     createdAt: timestamp,
     lastActiveAt: timestamp,
   };
 }
 if (route.kind === 'external') {
   return {
     id: `external:${nowId()}`,
     kind: 'external',
     url: route.url,
     title: route.title,
     ...(route.resourceKey ? { resourceKey: route.resourceKey } : {}),
     createdAt: timestamp,
     lastActiveAt: timestamp,
   };
 }
 if (route.kind === 'home') return createEntryTab(route.view, timestamp, route);
 return createEntryTab('design-systems', timestamp);
}

function routeForTab(tab: WorkspaceChromeTab): Route {
  if (tab.kind === 'project') {
    return {
      kind: 'project',
      projectId: tab.projectId,
      conversationId: tab.conversationId,
      fileName: tab.fileName,
    };
  }
 if (tab.kind === 'marketplace') {
   return tab.pluginId
     ? { kind: 'marketplace-detail', pluginId: tab.pluginId }
     : { kind: 'marketplace' };
 }
 if (tab.kind === 'external') {
   return {
     kind: 'external',
     url: tab.url,
     title: tab.title,
     ...(tab.resourceKey ? { resourceKey: tab.resourceKey } : {}),
   };
 }
 return tab.entryRoute ?? { kind: 'home', view: tab.view };
}

function reviveTab(value: unknown): WorkspaceChromeTab | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
  const lastActiveAt = typeof record.lastActiveAt === 'number' ? record.lastActiveAt : createdAt;
  if (!id) return null;
  if (record.kind === 'entry') {
    const view = record.view;
    if (isEntryHomeView(view)) {
      return {
        id,
        kind: 'entry',
        view,
        entryRoute: reviveEntryRoute(record.entryRoute, view),
        createdAt,
        lastActiveAt,
      };
    }
  }
  if (record.kind === 'project' && typeof record.projectId === 'string') {
    return {
      id,
      kind: 'project',
      projectId: record.projectId,
      conversationId: typeof record.conversationId === 'string' ? record.conversationId : null,
      fileName: typeof record.fileName === 'string' ? record.fileName : null,
      createdAt,
      lastActiveAt,
    };
  }
 if (record.kind === 'marketplace') {
   return {
     id,
     kind: 'marketplace',
     pluginId: typeof record.pluginId === 'string' ? record.pluginId : null,
     createdAt,
     lastActiveAt,
   };
 }
 if (record.kind === 'external' && typeof record.url === 'string') {
   let url = record.url;
   let resourceKey = typeof record.resourceKey === 'string' ? record.resourceKey : undefined;
   try {
     const parsed = new URL(url);
     if (parsed.pathname === '/api/v1/auth/hidesign/callback' && parsed.searchParams.has('ticket')) {
       url = `${parsed.origin}/login`;
       resourceKey = 'himind';
     }
   } catch {
     // Preserve legacy generic external URLs as-is.
   }
   return {
     id,
     kind: 'external',
     url,
     title: typeof record.title === 'string' ? record.title : record.url,
     ...(resourceKey ? { resourceKey } : {}),
     createdAt,
     lastActiveAt,
   };
 }
 return null;
}

function uniqueIdForTab(tab: WorkspaceChromeTab): string {
  if (tab.kind === 'project') return `project:${tab.projectId}:${nowId()}`;
 if (tab.kind === 'marketplace') {
   return `marketplace:${tab.pluginId ?? 'index'}:${nowId()}`;
 }
 if (tab.kind === 'external') return `external:${nowId()}`;
 return `entry:${tab.view}:${nowId()}`;
}

function normalizeTabsState(state: WorkspaceTabsState): WorkspaceTabsState {
  let sourceTabs = state.tabs.length > 0 ? state.tabs : [createEntryTab('home')];

  // Deduplicate entry tabs (singleton constraint): all sidebar sections
  // (home / projects / tasks / design-systems / plugins / integrations) share
  // ONE entry tab that switches its view in place. Keep the canonical one:
  // 1. Is one of them currently active?
  // 2. Otherwise, pick the one with highest lastActiveAt.
  // 3. Otherwise, pick the first one.
  const entryTabs = sourceTabs.filter((tab) => tab.kind === 'entry');
  if (entryTabs.length > 1) {
    let canonicalEntry = entryTabs.find((tab) => tab.id === state.activeTabId);
    if (!canonicalEntry) {
      canonicalEntry = entryTabs.reduce((newest, currentTab) =>
        currentTab.lastActiveAt > newest.lastActiveAt ? currentTab : newest,
        entryTabs[0]!
      );
    }
    // Drop every other entry tab; the survivor keeps its own view so the
    // section the user was on is preserved.
    sourceTabs = sourceTabs.filter(
      (tab) => tab.kind !== 'entry' || tab.id === canonicalEntry!.id,
    );
  }

  // Coalesce duplicate project tabs (one-project/one-tab invariant): a
  // workspace restored from localStorage can already hold several tabs for the
  // same projectId if the user hit the duplicate-tab bug before upgrading.
  // Keep one canonical tab per projectId — the active match, else the newest —
  // and drop the rest. This runs on every normalize, so it repairs persisted
  // state as well as preventing new corruption. See issue #2641.
  const projectTabs = sourceTabs.filter((tab) => tab.kind === 'project');
  if (projectTabs.length > 0) {
    const canonicalByProject = new Map<string, WorkspaceChromeTab>();
    for (const tab of projectTabs) {
      const existing = canonicalByProject.get(tab.projectId);
      if (!existing) {
        canonicalByProject.set(tab.projectId, tab);
        continue;
      }
      // Prefer the currently active tab; otherwise keep the most recently used.
      const tabIsActive = tab.id === state.activeTabId;
      const existingIsActive = existing.id === state.activeTabId;
      const keepTab =
        (tabIsActive && !existingIsActive) ||
        (!existingIsActive && tab.lastActiveAt > existing.lastActiveAt);
      if (keepTab) canonicalByProject.set(tab.projectId, tab);
    }
    const canonicalProjectIds = new Set(
      Array.from(canonicalByProject.values()).map((tab) => tab.id),
    );
    sourceTabs = sourceTabs.filter(
      (tab) => tab.kind !== 'project' || canonicalProjectIds.has(tab.id),
    );
  }

  // First-party external tools use a stable resource key, so one-use launch
  // URLs can never create several tabs. Also repairs duplicates restored from
  // builds that keyed HiMind by its full callback URL.
  const keyedExternalTabs = sourceTabs.filter(
    (tab): tab is Extract<WorkspaceChromeTab, { kind: 'external' }> =>
      tab.kind === 'external' && Boolean(tab.resourceKey),
  );
  if (keyedExternalTabs.length > 0) {
    const canonicalByResource = new Map<string, Extract<WorkspaceChromeTab, { kind: 'external' }>>();
    for (const tab of keyedExternalTabs) {
      const existing = canonicalByResource.get(tab.resourceKey!);
      if (
        !existing
        || tab.id === state.activeTabId
        || (existing.id !== state.activeTabId && tab.lastActiveAt > existing.lastActiveAt)
      ) {
        canonicalByResource.set(tab.resourceKey!, tab);
      }
    }
    const canonicalIds = new Set(Array.from(canonicalByResource.values(), (tab) => tab.id));
    sourceTabs = sourceTabs.filter(
      (tab) => tab.kind !== 'external' || !tab.resourceKey || canonicalIds.has(tab.id),
    );
  }

  // Pin the single entry tab to the leftmost position (Figma-style). It is the
  // one permanent, non-closable tab regardless of which section it currently
  // shows; project / marketplace tabs always sit to its right in insertion
  // order. If no entry tab survives normalization — e.g. a user who reopens on
  // a saved `[project, ...]` workspace — create one so the invariant "an entry
  // tab always exists and is leftmost" holds for migrated state too.
  const entryIndex = sourceTabs.findIndex((tab) => tab.kind === 'entry');
  if (entryIndex < 0) {
    sourceTabs = [createEntryTab('home'), ...sourceTabs];
  } else if (entryIndex > 0) {
    const [entryTab] = sourceTabs.splice(entryIndex, 1);
    sourceTabs = [entryTab!, ...sourceTabs];
  }

  const usedIds = new Set<string>();
  let activeTabId = '';
  let activeClaimed = false;
  const tabs = sourceTabs.map((tab) => {
    const wasActive = tab.id === state.activeTabId && !activeClaimed;
    if (wasActive) activeClaimed = true;
    const id = tab.id && !usedIds.has(tab.id) ? tab.id : uniqueIdForTab(tab);
    usedIds.add(id);
    if (wasActive) activeTabId = id;
    return id === tab.id ? tab : { ...tab, id };
  });
  return {
    tabs,
    activeTabId: activeTabId || tabs[0]!.id,
  };
}

function reorderTabsById(
  tabs: WorkspaceChromeTab[],
  sourceId: string,
  targetId: string,
  edge: TabDropEdge,
): WorkspaceChromeTab[] {
  if (sourceId === targetId) return tabs;
  const movedTab = tabs.find((tab) => tab.id === sourceId);
  if (!movedTab) return tabs;

  const nextTabs = tabs.filter((tab) => tab.id !== sourceId);
  const targetIndex = nextTabs.findIndex((tab) => tab.id === targetId);
  if (targetIndex < 0) return tabs;
  nextTabs.splice(edge === 'after' ? targetIndex + 1 : targetIndex, 0, movedTab);
  if (nextTabs.every((tab, index) => tab.id === tabs[index]?.id)) return tabs;
  return nextTabs;
}

function tabDragTargetKey(target: TabDragTarget): string {
  return `${target.tabId}:${target.edge}`;
}

/**
 * A tab's horizontal span in viewport X, measured from layout geometry
 * (offsetLeft/offsetWidth) instead of getBoundingClientRect. Layout geometry
 * excludes transforms, so the FLIP slide animation and drag styling never
 * shift the rects the drop hit-testing reads — a transformed hovered tab used
 * to move its own midpoint, flip the before/after edge, transform back, and
 * oscillate (visible jitter while dragging).
 */
function tabLayoutSpan(
  strip: HTMLElement,
  element: HTMLElement,
): { left: number; right: number; mid: number } {
  const stripLeft = strip.getBoundingClientRect().left - strip.scrollLeft;
  const left = stripLeft + element.offsetLeft;
  const width = element.offsetWidth;
  return { left, right: left + width, mid: left + width / 2 };
}

function tabDropEdgeFromElement(
  event: DragEvent<HTMLElement>,
  strip: HTMLElement,
  element: HTMLElement,
): TabDropEdge {
  return event.clientX > tabLayoutSpan(strip, element).mid ? 'after' : 'before';
}

function pulseTabDragHaptic(durationMs = TAB_DRAG_HAPTIC_MS) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(durationMs);
  } catch {
    // Haptics are opportunistic; unsupported environments should keep dragging normally.
  }
}

function reviveTabsState(value: unknown): WorkspaceTabsState | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const tabs = Array.isArray(record.tabs)
    ? record.tabs.map(reviveTab).filter((tab): tab is WorkspaceChromeTab => tab !== null)
    : [];
  if (tabs.length === 0) return null;
  const activeTabId = typeof record.activeTabId === 'string' ? record.activeTabId : '';
  return normalizeTabsState({ tabs, activeTabId: activeTabId || tabs[0]!.id });
}

function readPersistedTabsStore(): PersistedWorkspaceTabsStore {
  const empty: PersistedWorkspaceTabsStore = {
    current: null,
    scopeKey: undefined,
    scopes: {},
  };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return empty;
    const record = parsed as Record<string, unknown>;
    const current = reviveTabsState(record);
    const scopeKey = typeof record.scopeKey === 'string' ? record.scopeKey : undefined;
    const scopes: Record<string, PersistedWorkspaceTabsSnapshot> = {};
    if (record.scopes !== null && typeof record.scopes === 'object') {
      for (const [key, value] of Object.entries(record.scopes as Record<string, unknown>)) {
        if (!key || value === null || typeof value !== 'object') continue;
        const snapshotRecord = value as Record<string, unknown>;
        const state = reviveTabsState(snapshotRecord.state);
        if (!state) continue;
        scopes[key] = {
          state,
          updatedAt: typeof snapshotRecord.updatedAt === 'number'
            ? snapshotRecord.updatedAt
            : 0,
        };
      }
    }
    // Migrate the previous single-scope format in memory. It remains readable
    // at the top level while the next write adds the scoped registry.
    if (scopeKey && current && !scopes[scopeKey]) {
      scopes[scopeKey] = { state: current, updatedAt: 0 };
    }
    return { current, scopeKey, scopes };
  } catch {
    return empty;
  }
}

function persistTabsStore(
  store: PersistedWorkspaceTabsStore,
  currentScopeKey: string | undefined,
  current: WorkspaceTabsState,
): void {
  if (typeof window === 'undefined') return;
  try {
    const scopes = currentScopeKey
      ? {
          ...store.scopes,
          [currentScopeKey]: {
            state: normalizeTabsState(current),
            updatedAt: Date.now(),
          },
        }
      : store.scopes;
    const retainedScopes = Object.fromEntries(
      Object.entries(scopes)
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_PERSISTED_TAB_SCOPES),
    );
    const payloadScopeKey = currentScopeKey ?? store.scopeKey;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...normalizeTabsState(current),
        ...(payloadScopeKey ? { scopeKey: payloadScopeKey, scopes: retainedScopes } : {}),
      }),
    );
    store.current = current;
    store.scopeKey = payloadScopeKey;
    store.scopes = retainedScopes;
  } catch {
    // Best-effort browser chrome state. Navigation itself remains URL-driven.
  }
}

function freshHomeTabsState(): WorkspaceTabsState {
  const homeTab = createEntryTab('home');
  return { tabs: [homeTab], activeTabId: homeTab.id };
}

function initialTabsState(
  route: Route,
  persisted: PersistedWorkspaceTabsStore,
  identityScopeKey: string | null | undefined,
): WorkspaceTabsState {
  const fallback = tabFromRoute(route);
  const fallbackState = { tabs: [fallback], activeTabId: fallback.id };
  if (identityScopeKey === undefined) {
    return syncStateToRoute(persisted.current ?? fallbackState, route);
  }
  if (identityScopeKey === null) {
    // An unowned snapshot (no `scopeKey` stamp — written by a build that
    // predates tab scoping) cannot be attributed to whichever identity is
    // about to resolve, so it must not even be displayed provisionally
    // (recvqziATl6LlJ / recvqxKdOz0S6g). Owned snapshots keep the warm-reload
    // restore; the scope effect reconciles them once the identity resolves.
    if (persisted.scopeKey === undefined) {
      return syncStateToRoute(fallbackState, route);
    }
    return persisted.current ?? syncStateToRoute(fallbackState, route);
  }
  const scoped = persisted.scopes[identityScopeKey]?.state;
  // Migration from the old account+workspace tab buckets to the new
  // account-global tab strip. If this account has no global snapshot yet,
  // adopt its most recent/current workspace snapshot in place so upgrading
  // does not make every existing tab disappear on the first launch.
  if (
    workspaceBucketForScope(identityScopeKey) === 'global'
    && !scoped
    && persisted.scopeKey
    && accountBucketForScope(persisted.scopeKey) === accountBucketForScope(identityScopeKey)
    && persisted.current
  ) {
    const migrated = syncStateToRoute(persisted.current, route);
    persisted.current = migrated;
    persisted.scopeKey = identityScopeKey;
    persisted.scopes[identityScopeKey] = { state: migrated, updatedAt: Date.now() };
    return migrated;
  }
  if (persisted.scopeKey === identityScopeKey) {
    return syncStateToRoute(scoped ?? persisted.current ?? fallbackState, route);
  }
  if (persisted.scopeKey === undefined) {
    // Same attribution rule with the scope already resolved at mount time:
    // unowned storage never seeds a resolved scope. Route truth alone does.
    return syncStateToRoute(fallbackState, route);
  }
  return scoped ?? freshHomeTabsState();
}

function syncStateToRoute(state: WorkspaceTabsState, route: Route): WorkspaceTabsState {
  const timestamp = Date.now();
  const current = normalizeTabsState(state);
  const currentActive = current.tabs.find((tab) => tab.id === current.activeTabId) ?? null;

  // 1. If we are navigating to any entry view (home / projects / tasks /
  // design-systems / plugins / integrations / onboarding), reuse the single
  // entry tab and switch its view IN PLACE — all sidebar sections collapse
  // into the one leftmost tab. Only create one if none exists.
  if (route.kind === 'home') {
    const existingEntryTab = current.tabs.find((tab) => tab.kind === 'entry');
    if (existingEntryTab) {
      return normalizeTabsState({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === existingEntryTab.id
            ? {
                ...tab,
                view: route.view,
                entryRoute: route,
                lastActiveAt: timestamp,
              }
            : tab,
        ),
        activeTabId: existingEntryTab.id,
      });
    }
    const nextTab = tabFromRoute(route, timestamp);
    return normalizeTabsState({
      tabs: [...current.tabs, nextTab],
      activeTabId: nextTab.id,
    });
  }

  // 2. If we are navigating to a project, and that project tab already exists:
  if (route.kind === 'project') {
    const existingProjectTab = current.tabs.find(
      (tab) => tab.kind === 'project' && tab.projectId === route.projectId,
    );
    if (existingProjectTab) {
      return normalizeTabsState({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === existingProjectTab.id
            ? {
                ...tab,
                conversationId: route.conversationId ?? null,
                fileName: route.fileName,
                lastActiveAt: timestamp,
              }
            : tab,
        ),
        activeTabId: existingProjectTab.id,
      });
    }

    // 3. If we are navigating to a project, and the project tab does NOT exist,
    // but the current active tab is the (single) entry tab, we should NOT
    // replace it — append a new project tab instead, regardless of which entry
    // view it currently shows.
   if (currentActive && currentActive.kind === 'entry') {
     const nextTab = tabFromRoute(route, timestamp);
     return normalizeTabsState({
       tabs: [...current.tabs, nextTab],
       activeTabId: nextTab.id,
     });
   }
 }

 // 4. External URL tab: reuse an existing external tab with the same URL,
 // otherwise create a new one (append, like marketplace).
 if (route.kind === 'external') {
   const existingExternalTab = current.tabs.find(
     (tab) => tab.kind === 'external' && (
       (route.resourceKey && tab.resourceKey === route.resourceKey)
       || (!route.resourceKey && tab.url === route.url)
     ),
   );
   if (existingExternalTab) {
     return normalizeTabsState({
       ...current,
       tabs: current.tabs.map((tab) =>
         tab.id === existingExternalTab.id
           ? {
               ...tab,
               url: route.url,
               title: route.title,
               ...(route.resourceKey ? { resourceKey: route.resourceKey } : {}),
               lastActiveAt: timestamp,
             }
           : tab,
       ),
       activeTabId: existingExternalTab.id,
     });
   }
   const nextTab = tabFromRoute(route, timestamp);
   return normalizeTabsState({
     tabs: [...current.tabs, nextTab],
     activeTabId: nextTab.id,
   });
 }

 if (!currentActive) {
    const nextTab = tabFromRoute(route, timestamp);
    return normalizeTabsState({
      tabs: [...current.tabs, nextTab],
      activeTabId: nextTab.id,
    });
  }

  const replacement = {
    ...tabFromRoute(route, currentActive.createdAt),
    id: currentActive.id,
    lastActiveAt: timestamp,
  };
  const nextTabs = current.tabs.map((tab) =>
    tab.id === currentActive.id ? replacement : tab,
  );
  return normalizeTabsState({ tabs: nextTabs, activeTabId: replacement.id });
}

function accountBucketForScope(scopeKey: string): string {
  return scopeKey.split('::', 1)[0] ?? scopeKey;
}

function workspaceBucketForScope(scopeKey: string): string | null {
  const separator = scopeKey.indexOf('::');
  return separator < 0 ? null : scopeKey.slice(separator + 2);
}

function isTeamDirectoryRoute(route: Route): route is Extract<Route, { kind: 'home' }> {
  return route.kind === 'home'
    && (route.view === 'team-space' || route.view === 'team-folder');
}

function shouldRehomeAuthorizedProjectAfterSignIn({
  previousScopeKey,
  nextScopeKey,
  route,
  activeProjectWorkspaceId,
}: {
  previousScopeKey: string;
  nextScopeKey: string;
  route: Route;
  activeProjectWorkspaceId: string | null | undefined;
}): boolean {
  const activeProjectMatchesIncomingScope =
    activeProjectWorkspaceId === null
    || (
      typeof activeProjectWorkspaceId === 'string'
      && activeProjectWorkspaceId === workspaceBucketForScope(nextScopeKey)
    );
  return (
    accountBucketForScope(previousScopeKey) === 'anon'
    && accountBucketForScope(nextScopeKey) !== 'anon'
    && route.kind === 'project'
    && activeProjectWorkspaceId !== undefined
    && activeProjectMatchesIncomingScope
  );
}


/** Corner home glyph (per product: the brand tile gave way to a plain home
 *  icon). `currentColor` so it follows the button's muted/hover ink. */
function ChromeHomeGlyph() {
  return (
    <svg className="workspace-chrome-logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 21H5C4.44772 21 4 20.5523 4 20V11L1 11L11.3273 1.6115C11.7087 1.26475 12.2913 1.26475 12.6727 1.6115L23 11L20 11V20C20 20.5523 19.5523 21 19 21ZM6 19H18V9.15745L12 3.7029L6 9.15745V19ZM8 15H16V17H8V15Z" />
    </svg>
  );
}

export function WorkspaceTabsBar({
  route,
  projects,
  activeProjectWorkspaceId,
  onboardingCompleted = true,
  identityScopeKey,
}: Props) {
  const t = useT();
  const [persistedTabsStore] = useState(readPersistedTabsStore);
  const [state, setState] = useState<WorkspaceTabsState>(
    () => initialTabsState(route, persistedTabsStore, identityScopeKey),
  );
  const lastSeenScopeKeyRef = useRef<string | undefined>(persistedTabsStore.scopeKey);
  const resolvedScopeOnceRef = useRef(false);
  const pendingScopeStateRef = useRef<{
    scopeKey: string;
    state: WorkspaceTabsState;
  } | null>(null);
  const pendingScopeRouteRef = useRef<{
    scopeKey: string;
    path: string;
  } | null>(null);
  // A route click can leave a team directory one render before the ambient
  // workspace identity follows. Remember that user intent across the short
  // scope handoff so the incoming scope cannot restore its stale entry route
  // over the page the user just selected.
  const pendingTeamDirectoryExitRef = useRef<{
    path: string;
    fromScopeKey: string | undefined;
  } | null>(null);
  const previousRouteRef = useRef<Route>(route);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Tracks the raw identityScopeKey (including null) from the previous
  // render, so the scope effect can distinguish "scope just resolved"
  // (null -> non-null) from an explicit workspace switch (non-null ->
  // non-null).  Updated in a separate effect after the scope effect so
  // the scope effect still sees the previous value.
  const previousIdentityScopeKeyRef = useRef<string | null | undefined>(undefined);
  // #5517 corner fan: the "+" button opens a corner-anchored radial menu of
  // template wedges instead of immediately spawning a home tab.
  const [radialMenu, setRadialMenu] = useState<{ x: number; y: number } | null>(null);
  // Docked-mode white dropdown (project route): open state of its tab list.
  const [dockMenuOpen, setDockMenuOpen] = useState(false);
  // Most-recently-activated tab ids, newest first — the dropdown lists tabs
  // in this order (最近打开的在前). Session-local: falls back to strip order
  // for tabs never activated since launch.
  const tabMruRef = useRef<string[]>([]);
  useEffect(() => {
    const id = state.activeTabId;
    if (!id) return;
    tabMruRef.current = [id, ...tabMruRef.current.filter((x) => x !== id)].slice(0, 50);
  }, [state.activeTabId]);
  const [radialHoverId, setRadialHoverId] = useState<string | null>(null);
  useEffect(() => {
    if (!radialMenu) setRadialHoverId(null);
  }, [radialMenu]);
  useEffect(() => {
    if (!radialMenu) return;
    // Uniform page blur: filter on the shell blurs every descendant equally
    // (backdrop-filter on the scrim sampled composited layers unevenly).
    document.documentElement.classList.add('od-radial-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRadialMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('od-radial-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [radialMenu]);
  const [stripAvailableWidth, setStripAvailableWidth] = useState(0);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [overflowMenuPosition, setOverflowMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [stripElement, setStripElement] = useState<HTMLDivElement | null>(null);
  const setStripNode = useCallback((node: HTMLDivElement | null) => {
    stripRef.current = node;
    setStripElement((current) => (current === node ? current : node));
  }, []);
  const overflowButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousOnboardingCompletedRef = useRef(onboardingCompleted);
  const resetEntryToHomeAfterOnboardingRef = useRef(false);
  const dragSuppressClickRef = useRef(false);
  const draggingTabIdRef = useRef<string | null>(null);
  const dragHapticTargetRef = useRef<string | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<TabDragTarget | null>(null);
  // recvq5eKj2kdF0: `projects` is the Home view's own fetch (recent/drafts,
  // capped) — navigating Home refetches and REPLACES it (App.tsx's
  // reconcileFetchedProjects), which drops any project that is open in a
  // background tab but falls outside that scope. `displayTabFor` then found
  // no entry for the tab's projectId and fell back to the untitled label,
  // even though the project genuinely has a name — the tab just "forgot" it
  // the moment Home reloaded. This ref remembers the last real name seen for
  // each project id so a tab never regresses to untitled once it has shown a
  // real one; it is intentionally a ref (not state) because it must not
  // itself trigger a render — the incoming `projects`/`state.tabs` change
  // that recomputes `displayTabs` already will.
  const knownProjectNamesRef = useRef<Map<string, string>>(new Map());

  const overflowLayout = useMemo(
    () => workspaceTabOverflowLayout(state.tabs, state.activeTabId, stripAvailableWidth),
    [state.activeTabId, state.tabs, stripAvailableWidth],
  );
  const visibleChromeTabIds = useMemo(
    () => new Set(overflowLayout.visibleTabIds),
    [overflowLayout.visibleTabIds],
  );
  const overflowChromeTabs = useMemo(
    () => overflowLayout.overflowTabIds
      .map((id) => state.tabs.find((tab) => tab.id === id))
      .filter((tab): tab is WorkspaceChromeTab => Boolean(tab)),
    [overflowLayout.overflowTabIds, state.tabs],
  );
  const tabsOverflowing = overflowChromeTabs.length > 0;

  // Liquid-glass glide indicator: one persistent pill that slides to the
  // active tab (see useGlideIndicator + .workspace-tabs-glide in routines.css).
  const glideRef = useRef<HTMLDivElement | null>(null);
  const glidePillRef = useRef<HTMLDivElement | null>(null);
  const glideGlassRef = useLiquidGlass<HTMLDivElement>({ strength: 0.2 });
  const setGlidePillRef = useCallback(
    (node: HTMLDivElement | null) => {
      glidePillRef.current = node;
      glideGlassRef(node);
    },
    [glideGlassRef],
  );

  // FLIP slide for live drag-reordering: when the tab order changes mid-drag,
  // each displaced tab starts at its previous slot (inverted transform) and
  // transitions to its new one instead of teleporting. Positions come from
  // offsetLeft (layout space, transform-free), so the in-flight slides never
  // feed back into the drop hit-testing in findTabDropTarget.
  const tabFlipLeftsRef = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const previousLefts = tabFlipLeftsRef.current;
    const nextLefts = new Map<string, number>();
    for (const element of strip.querySelectorAll<HTMLElement>('[data-workspace-tab-id]')) {
      if (element.classList.contains('is-overflow-hidden')) continue;
      const id = element.dataset.workspaceTabId;
      if (!id) continue;
      nextLefts.set(id, element.offsetLeft);
      const before = previousLefts.get(id);
      if (before === undefined) continue;
      const delta = before - element.offsetLeft;
      if (!delta) continue;
      // The dragged tab itself snaps — its native drag ghost is what tracks
      // the pointer; animating the in-row placeholder would lag behind it.
      if (id === draggingTabIdRef.current) continue;
      element.style.transition = 'none';
      element.style.transform = `translateX(${delta}px)`;
      // Commit the inverted start position before re-enabling transitions.
      void element.offsetWidth;
      element.style.transition = '';
      element.style.transform = '';
    }
    tabFlipLeftsRef.current = nextLefts;
  });

  // Layout epoch for the glide indicator: any change in tab identity/order or
  // the overflow state can shift the active tab without changing which tab is
  // active — those reposition instantly (no fake slide).
  const tabsLayoutKey = useMemo(
    () => `${state.tabs.map((tab) => tab.id).join('|')}:${overflowLayout.visibleTabIds.join(',')}`,
    [overflowLayout.visibleTabIds, state.tabs],
  );
  const activeChromeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  // The pinned entry tab renders only a flat rail-toggle whenever it's active —
  // the sidebar toggle on Home, the Home button in every other entry section
  // (settings / all-projects / community / design-systems). In ALL of these the
  // glide pill must not park its filled "active tab" surface over it, so key off
  // `kind === 'entry'` rather than the Home view alone (which left the pill
  // filling the button in the other sections).
  const activeIsEntryRailToggle = activeChromeTab?.kind === 'entry';
  useGlideIndicator({
    containerRef: stripRef,
    indicatorRef: glideRef,
    pillRef: glidePillRef,
    // On an entry section, target a never-matching selector so the glide pill
    // fades out over the toggle instead of filling it. (jsdom-safe — no `:has()`
    // in querySelector.)
    activeSelector: activeIsEntryRailToggle
      ? '.workspace-tab.is-active.__no-glide__'
      : '.workspace-tab.is-active',
    activeKey: state.activeTabId,
    layoutKey: tabsLayoutKey,
    frozen: draggingTabId !== null,
    // The pinned entry tab is position: sticky — its visual position diverges
    // from layout coords while the strip is scrolled, so chase it on scroll.
    trackScroll: activeChromeTab?.kind === 'entry',
  });

  // While the app is on the onboarding (Welcome) route, opening a new tab
  // would navigate away from onboarding and bypass the Connect gate. Key off
  // the live `route` (the URL truth), NOT `onboardingCompleted` and NOT the
  // internal tab `view`: a user who finished onboarding before (completion
  // persisted) can still land on /onboarding, and the entry tab's view can be
  // mid-rewrite by the post-completion effect. Gating in `createNewTab` blocks
  // both the "+" button and the Cmd/Ctrl+T shortcut from one place.
  const onboardingActive = route.kind === 'home' && route.view === 'onboarding';

  // Mirror of EntryShell's entry nav-rail open state, only used to reflect it
  // on the pinned Home tab's sidebar toggle (aria-expanded). EntryShell owns
  // the state and broadcasts changes as a window event because it renders in a
  // sibling React tree; the localStorage seed covers the frames before the
  // first broadcast arrives.
  const [entryRailOpen, setEntryRailOpen] = useState<boolean>(readStoredRailOpen);
  useEffect(() => {
    const onRailState = (event: Event) => {
      const open = (event as CustomEvent<{ open?: unknown }>).detail?.open;
      if (typeof open === 'boolean') setEntryRailOpen(open);
    };
    window.addEventListener(ENTRY_RAIL_STATE_EVENT, onRailState);
    return () => window.removeEventListener(ENTRY_RAIL_STATE_EVENT, onRailState);
  }, []);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  // Project-route dock (workspaceTabsDock.ts): when ProjectView registers a
  // dock element at the top of the chat column, the strip portals there and
  // the full-width chrome row collapses (`is-docked` + the :has() row rule in
  // routines.css). Whenever no dock exists — home/marketplace, focus mode —
  // the strip renders in the chrome row as before.
  const [tabsDockEl, setTabsDockEl] = useState<HTMLElement | null>(() => getWorkspaceTabsDock());
  useEffect(
    () => subscribeWorkspaceTabsDock(() => setTabsDockEl(getWorkspaceTabsDock())),
    [],
  );
  useEffect(() => {
    if (!tabsDockEl) {
      setDockMenuOpen(false);
      return;
    }
    // The full-width chrome strip is being portaled into the project dock.
    // Retire any global overflow popup tied to the previous strip node before
    // that node is detached/replaced.
    setOverflowMenuOpen(false);
    setOverflowMenuPosition(null);
  }, [tabsDockEl]);

  // Refresh the fallback cache from whatever this fetch actually returned,
  // before `displayTabFor` below reads it — same render pass, so a tab
  // reading a name for the first time never has to wait a tick for it.
  for (const project of projects) {
    const name = project.name?.trim();
    if (name) knownProjectNamesRef.current.set(project.id, name);
  }

  const displayTabs = useMemo(
    () => state.tabs.map((tab) => displayTabFor(tab, projectById, t, knownProjectNamesRef.current)),
    [state.tabs, projectById, t],
  );
  const displayTabById = useMemo(
    () => new Map(displayTabs.map((tab) => [tab.id, tab])),
    [displayTabs],
  );
  useEffect(() => {
    if (identityScopeKey === null) return;
    const pendingScopeRoute = pendingScopeRouteRef.current;
    if (
      pendingScopeRoute
      && pendingScopeRoute.scopeKey === identityScopeKey
    ) {
      // React StrictMode replays mount effects without remounting refs. Keep
      // rejecting the outgoing workspace URL until the router commits the
      // route selected for the incoming scope.
      if (pendingScopeRoute.path !== buildPath(route)) return;
      pendingScopeRouteRef.current = null;
    }
    if (
      typeof identityScopeKey === 'string'
      && lastSeenScopeKeyRef.current !== identityScopeKey
    ) {
      // A workspace transition owns route reconciliation: the current URL can
      // still describe the outgoing workspace for this render and must never
      // be folded into the incoming workspace's snapshot.
      return;
    }
    setState((current) => syncStateToRoute(current, route));
  }, [route, identityScopeKey]);

  useEffect(() => {
    const previousRoute = previousRouteRef.current;
    const previousPath = buildPath(previousRoute);
    const currentPath = buildPath(route);
    if (previousPath !== currentPath) {
      if (isTeamDirectoryRoute(previousRoute) && !isTeamDirectoryRoute(route)) {
        pendingTeamDirectoryExitRef.current = {
          path: currentPath,
          fromScopeKey: lastSeenScopeKeyRef.current,
        };
      } else {
        pendingTeamDirectoryExitRef.current = null;
      }
    }
    previousRouteRef.current = route;
  }, [route]);

  useEffect(() => {
    if (!previousOnboardingCompletedRef.current && onboardingCompleted) {
      resetEntryToHomeAfterOnboardingRef.current = true;
    }
    previousOnboardingCompletedRef.current = onboardingCompleted;
  }, [onboardingCompleted]);

  // Auto-close the Welcome tab once onboarding ends: rewrite any entry tab
  // still parked on the 'onboarding' view back to 'home'. This catches every
  // finish path uniformly — last-step Continue and any future route that
  // navigates away while leaving the entry tab on Welcome in the background.
  useEffect(() => {
    if (!onboardingCompleted) return;
    // Don't rewrite the tab back to 'home' while the user is *still* on the
    // onboarding route — a previously-completed user who re-opens /onboarding
    // should keep the "Onboarding" tab label, not flip to "Home". The rewrite
    // still fires the moment they navigate away (onboardingActive turns false).
    if (onboardingActive) return;
    const resetDesignSystemsEntry =
      resetEntryToHomeAfterOnboardingRef.current && route.kind === 'project';
    if (resetDesignSystemsEntry) {
      resetEntryToHomeAfterOnboardingRef.current = false;
    }
    setState((current) => {
      if (!current.tabs.some((tab) =>
        tab.kind === 'entry' &&
        (tab.view === 'onboarding' || (resetDesignSystemsEntry && tab.view === 'design-systems')),
      )) {
        return current;
      }
      return normalizeTabsState({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.kind === 'entry' &&
          (tab.view === 'onboarding' || (resetDesignSystemsEntry && tab.view === 'design-systems'))
            ? { ...tab, view: 'home' }
            : tab,
        ),
      });
    });
  }, [onboardingCompleted, onboardingActive, route.kind]);

  // Tab-scope enforcement: every AMR account + workspace key owns one isolated
  // snapshot. Save the outgoing state before loading the incoming state, and
  // navigate to that snapshot's active tab. The persistent registry is capped
  // (MAX_PERSISTED_TAB_SCOPES), so workspace bouncing remains recoverable
  // without turning localStorage into an unbounded recently-closed cache.
  //
  // Suppressed while onboarding is active: `createNewTab`/`openRadialMenu`
  // are both gated on `onboardingActive`, so the ONLY tab that can exist
  // during onboarding is the single pinned entry tab — there is nothing to
  // protect against yet, and forcing a close+navigate-home mid-flow would
  // eject the user from the Connect step before they finish it (a real
  // scenario: finishing AMR sign-in mid-onboarding is exactly a scope change
  // per this design). The new key is still recorded via the ref so the
  // reconciliation does not re-fire the moment onboarding completes with a
  // scope that has not changed again since.
  useEffect(() => {
    if (typeof identityScopeKey !== 'string') return;
    const previous = lastSeenScopeKeyRef.current;
    lastSeenScopeKeyRef.current = identityScopeKey;
    const firstResolvedScope = !resolvedScopeOnceRef.current;
    resolvedScopeOnceRef.current = true;
    if (previous === identityScopeKey) return;

    if (previous === undefined) {
      // Upgrade compatibility, held to the attribution rule (recvqziATl6LlJ /
      // recvqxKdOz0S6g): a legacy single snapshot has no owner stamp, so it
      // must never be adopted into whichever scope happens to resolve first —
      // the account that opened those tabs may have switched since (pre-scoping
      // builds never closed tabs on an account swap), and adopting would
      // surface another account's project tabs inside the current account's
      // workspace. Tabs are bookmarks: when attribution is unknowable, drop
      // the snapshot and rebuild from route truth (fresh Home plus whatever
      // tab the current URL already points at). A session with no unowned
      // snapshot in storage (fresh install / already-scoped storage) keeps
      // adopting its own live, session-created state unchanged.
      const unownedSnapshotInStorage =
        persistedTabsStore.scopeKey === undefined && persistedTabsStore.current !== null;
      const adopted = syncStateToRoute(
        unownedSnapshotInStorage ? freshHomeTabsState() : stateRef.current,
        route,
      );
      persistedTabsStore.scopes[identityScopeKey] = {
        state: adopted,
        updatedAt: Date.now(),
      };
      pendingScopeStateRef.current = { scopeKey: identityScopeKey, state: adopted };
      setState(adopted);
      return;
    }

    if (!firstResolvedScope) {
      persistedTabsStore.scopes[previous] = {
        state: stateRef.current,
        updatedAt: Date.now(),
      };
    }

    if (onboardingActive) {
      // Onboarding must not be interrupted by sign-in resolving a workspace:
      // never navigate away from the flow. But re-homing the live state to
      // the new scope is attribution, and the live state is not always the
      // single pinned entry tab the flow itself creates — a snapshot restored
      // at mount can ride along (browser localStorage outlives a daemon
      // data-dir reset that replays onboarding). Within one account that is
      // the owner's own state; across accounts (a direct mid-onboarding
      // account swap) it must fail closed to a fresh Home state instead
      // (recvqziATl6LlJ leak family) — visually identical for the legitimate
      // sign-in-mid-onboarding case (a single entry tab either way, synced to
      // the onboarding route), and never a cross-account tab transfer.
      const rehomed =
        accountBucketForScope(previous) === accountBucketForScope(identityScopeKey)
          ? stateRef.current
          : syncStateToRoute(freshHomeTabsState(), route);
      persistedTabsStore.scopes[identityScopeKey] = {
        state: rehomed,
        updatedAt: Date.now(),
      };
      if (rehomed !== stateRef.current) {
        pendingScopeStateRef.current = { scopeKey: identityScopeKey, state: rehomed };
        setState(rehomed);
      }
      return;
    }

    // Settings is app-local rather than Workspace-owned. Keep that explicit
    // destination when leaving a project-pinned Workspace scope for the same
    // account's ambient scope, and through the failed-run CTA's anonymous ->
    // signed-in authorization handoff. Rebuild from a fresh entry tab so no
    // project tab crosses the scope boundary. Account A -> B still falls
    // through to the fail-closed reset below.
    const previousAccountBucket = accountBucketForScope(previous);
    const nextAccountBucket = accountBucketForScope(identityScopeKey);
    if (
      route.kind === 'home'
      && route.view === 'settings'
      && (
        previousAccountBucket === nextAccountBucket
        || (previousAccountBucket === 'anon' && nextAccountBucket !== 'anon')
      )
    ) {
      const rehomed = syncStateToRoute(freshHomeTabsState(), route);
      persistedTabsStore.scopes[identityScopeKey] = {
        state: rehomed,
        updatedAt: Date.now(),
      };
      pendingScopeStateRef.current = { scopeKey: identityScopeKey, state: rehomed };
      pendingScopeRouteRef.current = null;
      setState(rehomed);
      return;
    }

    // Inline "Authorize & retry" must finish the same run in place. Re-home
    // only the live route tab (plus a fresh Home tab) when anonymous login
    // resolves either an unbound local project or an exact witness for the
    // project's persisted Workspace. Unresolved projects, Workspace
    // mismatches, sign-out, authenticated account A→B, and Team/Personal
    // workspace switches all retain the fail-closed reset below.
    if (shouldRehomeAuthorizedProjectAfterSignIn({
      previousScopeKey: previous,
      nextScopeKey: identityScopeKey,
      route,
      activeProjectWorkspaceId,
    })) {
      const rehomed = syncStateToRoute(freshHomeTabsState(), route);
      persistedTabsStore.scopes[identityScopeKey] = {
        state: rehomed,
        updatedAt: Date.now(),
      };
      pendingScopeStateRef.current = { scopeKey: identityScopeKey, state: rehomed };
      pendingScopeRouteRef.current = null;
      setState(rehomed);
      return;
    }

    // Preserve the prior fail-closed authentication boundary: workspace
    // bouncing within one account is recoverable, but sign-out or an account
    // change always lands on a fresh Home state instead of reviving browser
    // chrome from a previous authenticated session.
    const mayRestore =
      accountBucketForScope(previous) === accountBucketForScope(identityScopeKey);
    // Scope views are explicit workspace destinations and retain the historical
    // no-bounce behavior. Separately, leaving a team directory can make the
    // route change one render before the ambient scope changes; in that narrow
    // handoff the user's new route must win over a stale restored snapshot.
    const isScopeViewRoute = route.kind === 'home' && (
      route.view === 'personal-all'
      || route.view === 'team-space'
      || route.view === 'team-folder'
      || route.view === 'personal-folder'
      || route.view === 'shared-with-me'
    );
    const pendingTeamDirectoryExit = pendingTeamDirectoryExitRef.current;
    const preserveTeamDirectoryExit = Boolean(
      pendingTeamDirectoryExit
      && pendingTeamDirectoryExit.path === buildPath(route)
      && pendingTeamDirectoryExit.fromScopeKey === previous,
    );
    if (preserveTeamDirectoryExit) pendingTeamDirectoryExitRef.current = null;
    // Preserve the existing scoped-tab restoration policy. The only added
    // reconciliation is the one-shot team-directory exit above, which repairs
    // an already-polluted incoming snapshot by folding the clicked route into it.
    const scopeJustResolved = previousIdentityScopeKeyRef.current === null;
    const restoredState = mayRestore
      ? persistedTabsStore.scopes[identityScopeKey]?.state ?? freshHomeTabsState()
      : freshHomeTabsState();
    const nextState = preserveTeamDirectoryExit
      ? syncStateToRoute(restoredState, route)
      : scopeJustResolved && !isScopeViewRoute
        ? syncStateToRoute(restoredState, route)
        : restoredState;
    pendingScopeStateRef.current = { scopeKey: identityScopeKey, state: nextState };
    setState(nextState);
    const activeTab =
      nextState.tabs.find((tab) => tab.id === nextState.activeTabId) ?? nextState.tabs[0]!;
    const nextRoute = routeForTab(activeTab);
    const nextPath = buildPath(nextRoute);
    pendingScopeRouteRef.current = buildPath(route) === nextPath
      ? null
      : { scopeKey: identityScopeKey, path: nextPath };
    // Scope destinations and the one-shot team-directory exit are already the
    // user's chosen route. Everything else keeps the historical behavior of
    // navigating to the incoming scope's restored active tab.
    if (isScopeViewRoute || preserveTeamDirectoryExit) {
      pendingScopeRouteRef.current = null;
    } else {
      navigate(nextRoute);
    }
  }, [
    activeProjectWorkspaceId,
    identityScopeKey,
    onboardingActive,
    persistedTabsStore,
    route,
  ]);

  // Update the raw scope-key ref AFTER the scope effect so the scope
  // effect can read the previous value (including null) to distinguish
  // "scope just resolved" from "explicit workspace switch".
  useEffect(() => {
    previousIdentityScopeKeyRef.current = identityScopeKey;
  }, [identityScopeKey]);

  // Scroll the active tab into view when it changes. The strip itself
  // is native-scrollable horizontally (see CSS), so we just nudge the
  // browser's scroll position whenever the active id flips — keeps the
  // current tab visible after a route change even if the user had
  // scrolled the strip elsewhere.
  useEffect(() => {
    function onOpenWorkspaceTab(event: Event) {
      const detail = (event as CustomEvent<{ route?: Route }>).detail;
      const nextRoute = detail?.route;
      if (!nextRoute) return;
      setState((current) => {
        const normalized = normalizeTabsState(current);
        // Mirror syncStateToRoute: reuse an existing project tab for the same
        // projectId instead of appending a duplicate on repeated opens.
        if (nextRoute.kind === 'project') {
          const existingProjectTab = normalized.tabs.find(
            (tab) => tab.kind === 'project' && tab.projectId === nextRoute.projectId,
          );
          if (existingProjectTab) {
            const timestamp = Date.now();
            return normalizeTabsState({
              ...normalized,
              tabs: normalized.tabs.map((tab) =>
                tab.id === existingProjectTab.id
                  ? {
                      ...tab,
                      conversationId: nextRoute.conversationId ?? null,
                      fileName: nextRoute.fileName,
                      lastActiveAt: timestamp,
                    }
                  : tab,
              ),
             activeTabId: existingProjectTab.id,
           });
         }
       }
       // External URL tab: reuse an existing tab with the same URL.
       if (nextRoute.kind === 'external') {
         const existingExternalTab = normalized.tabs.find(
           (tab) => tab.kind === 'external' && (
             (nextRoute.resourceKey && tab.resourceKey === nextRoute.resourceKey)
             || (!nextRoute.resourceKey && tab.url === nextRoute.url)
           ),
         );
         if (existingExternalTab) {
           const timestamp = Date.now();
           return normalizeTabsState({
             ...normalized,
             tabs: normalized.tabs.map((tab) =>
               tab.id === existingExternalTab.id
                 ? {
                     ...tab,
                     url: nextRoute.url,
                     title: nextRoute.title,
                     ...(nextRoute.resourceKey ? { resourceKey: nextRoute.resourceKey } : {}),
                     lastActiveAt: timestamp,
                   }
                 : tab,
             ),
             activeTabId: existingExternalTab.id,
           });
         }
       }
     const nextTab = tabFromRoute(nextRoute);
      return normalizeTabsState({
        tabs: [...normalized.tabs, nextTab],
        activeTabId: nextTab.id,
      });
    });
    navigate(nextRoute);
  }

    function onRemoveWorkspaceProjectTabs(event: Event) {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      const projectId = detail?.projectId;
      if (!projectId) return;
      setState((current) => {
        const normalized = normalizeTabsState(current);
        const nextTabs = normalized.tabs.filter(
          (tab) => tab.kind !== 'project' || tab.projectId !== projectId,
        );
        if (nextTabs.length === normalized.tabs.length) return normalized;
        const removedActiveTab = normalized.tabs.some(
          (tab) => tab.id === normalized.activeTabId
            && tab.kind === 'project'
            && tab.projectId === projectId,
        );
        return normalizeTabsState({
          tabs: nextTabs,
          activeTabId: removedActiveTab
            ? nextTabs.find((tab) => tab.kind === 'entry')?.id ?? ''
            : normalized.activeTabId,
        });
      });
    }

    function onActivateWorkspaceResource(event: Event) {
      const detail = (event as CustomEvent<{ resourceKey?: string; handled?: boolean }>).detail;
      if (!detail?.resourceKey) return;
      const normalized = normalizeTabsState(stateRef.current);
      const existing = normalized.tabs.find(
        (tab) => tab.kind === 'external' && tab.resourceKey === detail.resourceKey,
      );
      if (!existing) return;
      detail.handled = true;
      const nextState = normalizeTabsState({
        ...normalized,
        tabs: normalized.tabs.map((tab) =>
          tab.id === existing.id ? { ...tab, lastActiveAt: Date.now() } : tab,
        ),
        activeTabId: existing.id,
      });
      stateRef.current = nextState;
      setState(nextState);
      navigate(routeForTab(existing));
    }

    window.addEventListener(OPEN_WORKSPACE_TAB_EVENT, onOpenWorkspaceTab);
    window.addEventListener(ACTIVATE_WORKSPACE_RESOURCE_EVENT, onActivateWorkspaceResource);
    window.addEventListener(
      REMOVE_WORKSPACE_PROJECT_TABS_EVENT,
      onRemoveWorkspaceProjectTabs,
    );
    return () => {
      window.removeEventListener(OPEN_WORKSPACE_TAB_EVENT, onOpenWorkspaceTab);
      window.removeEventListener(ACTIVATE_WORKSPACE_RESOURCE_EVENT, onActivateWorkspaceResource);
      window.removeEventListener(
        REMOVE_WORKSPACE_PROJECT_TABS_EVENT,
        onRemoveWorkspaceProjectTabs,
      );
    };
  }, []);

  useLayoutEffect(() => {
    if (!stripElement) return;
    let frame = 0;
    let clusterResizeObserver: ResizeObserver | null = null;
    let bodyMutationObserver: MutationObserver | null = null;

    const visibleClusterElements = () =>
      Array.from(document.querySelectorAll<HTMLElement>('.entry-top-right-cluster')).filter(
        (element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        },
      );

    const measure = () => {
      frame = 0;
      const stripRect = stripElement.getBoundingClientRect();
      const clusters = visibleClusterElements();
      const measured = workspaceTabMeasuredAvailableWidth(
        stripRect.left,
        stripElement.clientWidth,
        clusters.map((element) => element.getBoundingClientRect().left),
      );
      setStripAvailableWidth((current) =>
        stableWorkspaceTabStripWidth(current, measured),
      );

      if (clusterResizeObserver) {
        clusterResizeObserver.disconnect();
        clusters.forEach((element) => clusterResizeObserver?.observe(element));
      }
    };
    const requestMeasure = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    requestMeasure();
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(requestMeasure);
    if (resizeObserver) {
      resizeObserver.observe(stripElement);
    }
    if (typeof ResizeObserver !== 'undefined') {
      clusterResizeObserver = new ResizeObserver(requestMeasure);
      visibleClusterElements().forEach((element) => clusterResizeObserver?.observe(element));
    }
    if (typeof MutationObserver !== 'undefined') {
      bodyMutationObserver = new MutationObserver(requestMeasure);
      bodyMutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
    window.addEventListener('resize', requestMeasure);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      clusterResizeObserver?.disconnect();
      bodyMutationObserver?.disconnect();
      window.removeEventListener('resize', requestMeasure);
    };
  }, [stripElement, tabsDockEl, state.tabs.length]);

  useEffect(() => {
    if (!overflowMenuOpen) return;
    const close = () => setOverflowMenuOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [overflowMenuOpen]);

  useEffect(() => {
    if (overflowChromeTabs.length > 0) return;
    setOverflowMenuOpen(false);
    setOverflowMenuPosition(null);
  }, [overflowChromeTabs.length]);

  useEffect(() => {
    const pending = pendingScopeStateRef.current;
    if (pending) {
      // Effects from the render that observed a NEW scope still close over the
      // OLD scope's state. Wait for React to commit the selected snapshot
      // before associating any state with the incoming key.
      if (pending.scopeKey !== identityScopeKey || pending.state !== state) return;
      pendingScopeStateRef.current = null;
    }
    if (identityScopeKey === null) return;
    persistTabsStore(
      persistedTabsStore,
      typeof identityScopeKey === 'string' ? identityScopeKey : undefined,
      state,
    );
  }, [state, identityScopeKey, persistedTabsStore]);

  useEffect(() => {
    function onWorkspaceTabShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      const key = event.key;
      if (!key) return;
      const lowerKey = key.toLocaleLowerCase();
      const primaryModifier = event.metaKey || event.ctrlKey;
      const primaryWithoutAlt = primaryModifier && !event.altKey;
      const ctrlWithoutPlatformModifiers = event.ctrlKey && !event.metaKey && !event.altKey;
      const isBrowserStyleTabShortcut =
        (primaryWithoutAlt && !event.shiftKey && (lowerKey === 't' || lowerKey === 'w'))
        || (ctrlWithoutPlatformModifiers && key === 'Tab')
        || (ctrlWithoutPlatformModifiers && !event.shiftKey && (key === 'PageDown' || key === 'PageUp'))
        || (primaryWithoutAlt && !event.shiftKey && /^[1-9]$/u.test(key));

      if (isBrowserStyleTabShortcut && shouldDeferShortcutToProjectWorkspace()) {
        return;
      }

      if (primaryWithoutAlt && !event.shiftKey && lowerKey === 't') {
        consumeWorkspaceTabShortcut(event);
        createNewTab();
        return;
      }

      if (primaryWithoutAlt && !event.shiftKey && lowerKey === 'w') {
        consumeWorkspaceTabShortcut(event);
        closeActiveTab();
        return;
      }

      if (ctrlWithoutPlatformModifiers && key === 'Tab') {
        consumeWorkspaceTabShortcut(event);
        activateTabByOffset(event.shiftKey ? -1 : 1);
        return;
      }

      if (ctrlWithoutPlatformModifiers && !event.shiftKey && key === 'PageDown') {
        consumeWorkspaceTabShortcut(event);
        activateTabByOffset(1);
        return;
      }

      if (ctrlWithoutPlatformModifiers && !event.shiftKey && key === 'PageUp') {
        consumeWorkspaceTabShortcut(event);
        activateTabByOffset(-1);
        return;
      }

      if (primaryWithoutAlt && !event.shiftKey && /^[1-9]$/u.test(key)) {
        consumeWorkspaceTabShortcut(event);
        const normalized = normalizeTabsState(state);
        const targetIndex = key === '9'
          ? normalized.tabs.length - 1
          : Number(key) - 1;
        activateTabByIndex(targetIndex);
      }
    }

    window.addEventListener('keydown', onWorkspaceTabShortcut, true);
    return () => window.removeEventListener('keydown', onWorkspaceTabShortcut, true);
  }, [state]);

  function activateTab(tab: WorkspaceChromeTab) {
    setState((current) => ({
      tabs: normalizeTabsState(current).tabs.map((item) =>
        item.id === tab.id ? { ...item, lastActiveAt: Date.now() } : item,
      ),
      activeTabId: tab.id,
    }));
    navigate(routeForTab(tab));
  }

  function activateTabByOffset(offset: number) {
    const normalized = normalizeTabsState(state);
    if (normalized.tabs.length === 0) return;
    const activeIndex = Math.max(
      0,
      normalized.tabs.findIndex((tab) => tab.id === normalized.activeTabId),
    );
    const targetIndex =
      (activeIndex + offset + normalized.tabs.length) % normalized.tabs.length;
    activateTab(normalized.tabs[targetIndex]!);
  }

  function activateTabByIndex(index: number) {
    const normalized = normalizeTabsState(state);
    if (index < 0 || index >= normalized.tabs.length) return;
    activateTab(normalized.tabs[index]!);
  }

  function closeActiveTab() {
    const normalized = normalizeTabsState(state);
    closeTab(normalized.activeTabId);
  }

  function openTab(tab: WorkspaceChromeTab) {
    if (dragSuppressClickRef.current) {
      dragSuppressClickRef.current = false;
      return;
    }
    const normalized = normalizeTabsState(state);
    const tabIsAlreadyActive = normalized.activeTabId === tab.id;
    // When Home is already the active entry tab, clicking its house glyph is an
    // explicit request to go to the real Home page. When a project / HiMind /
    // other tool tab is in front, the same pinned tab acts like a browser tab:
    // restore the exact entry route it held before leaving (community, square
    // tool sub-tab, team folder, etc.) instead of overwriting it with Home.
    if (tab.kind === 'entry' && tabIsAlreadyActive && tab.view !== 'home') {
      activateTab({
        ...tab,
        view: 'home',
        entryRoute: { kind: 'home', view: 'home' },
      });
      return;
    }
    activateTab(tab);
  }

  // Corner-anchored radial fan menu on the "+" button: three concentric bands
  // sweep down-left from the button (the pivot at the top-right corner),
  // carrying the composer Template picker's icons. Each band is a ring split
  // into angular wedges — 3 / 4 from the inner bands outward, with the outer
  // band absorbing every remaining template (see `radialSlots`).
  // Picking a wedge opens the home tab with that template applied to the hero.
  const RADIAL_SIZE = 300;
  const RADIAL_PAD = 24;
  const RADIAL_R_IN = 56;
  const RADIAL_R_OUT = 264;
  const RADIAL_BANDS = [3, 4, 3];
  const RADIAL_START = 96; // fan start angle (screen degrees) …
  const RADIAL_SWEEP = 78; // … total arc, fanning toward the left
  const RADIAL_GAP = 0; // wedges abut; hairline strokes are the dividers
  const RADIAL_CX = RADIAL_SIZE - RADIAL_PAD;
  const RADIAL_CY = RADIAL_PAD;

  function radialBandRadius(band: number): number {
    return RADIAL_R_IN + ((RADIAL_R_OUT - RADIAL_R_IN) * band) / RADIAL_BANDS.length;
  }

  // Per-template placement across the bands, aligned to template order.
  const radialSlots = useMemo(() => {
    const chips = orderedCreateChips().filter((chip) => chip.action.kind === 'apply-scenario');
    const slots: Array<{ chip: HomeHeroChip; band: number; seg: number; segCount: number }> = [];
    let cursor = 0;
    RADIAL_BANDS.forEach((count, band) => {
      const isLast = band === RADIAL_BANDS.length - 1;
      const remaining = Math.max(chips.length - cursor, 0);
      const take = isLast ? remaining : Math.min(count, remaining);
      for (let seg = 0; seg < take; seg += 1) {
        const chip = chips[cursor + seg];
        if (chip) slots.push({ chip, band, seg, segCount: take });
      }
      cursor += take;
    });
    return slots;
  }, []);

  function radialWedgeAngles(seg: number, segCount: number): [number, number] {
    const step = RADIAL_SWEEP / segCount;
    return [RADIAL_START + seg * step + RADIAL_GAP / 2, RADIAL_START + (seg + 1) * step - RADIAL_GAP / 2];
  }

  function radialSectorPath(cx: number, cy: number, a1: number, a2: number, r0: number, r1: number): string {
    const rad = (a: number) => (a * Math.PI) / 180;
    const px = (r: number, a: number) => `${(cx + r * Math.cos(rad(a))).toFixed(2)} ${(cy + r * Math.sin(rad(a))).toFixed(2)}`;
    return `M ${px(r1, a1)} A ${r1} ${r1} 0 0 1 ${px(r1, a2)} L ${px(r0, a2)} A ${r0} ${r0} 0 0 0 ${px(r0, a1)} Z`;
  }

  function openEntryView(view: EntryHomeView) {
    const normalized = normalizeTabsState(state);
    const existingEntryTab = normalized.tabs.find((tab) => tab.kind === 'entry');
    const nextRoute: EntryRoute = { kind: 'home', view };
    if (existingEntryTab) {
      setState({
        ...normalized,
        tabs: normalized.tabs.map((tab) =>
          tab.id === existingEntryTab.id
            ? { ...tab, view, entryRoute: nextRoute }
            : tab,
        ),
        activeTabId: existingEntryTab.id,
      });
    } else {
      const tab = createEntryTab(view, Date.now(), nextRoute);
      setState({ tabs: [...normalized.tabs, tab], activeTabId: tab.id });
    }
    navigate(nextRoute);
    setRadialMenu(null);
  }

  function openTemplateFromRadial(chip: HomeHeroChip) {
    openEntryView('home');
    // Hand the pick to the hero once the home tab has mounted/activated —
    // HomeHero applies the chip exactly as if its own picker was clicked.
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(HOME_APPLY_TEMPLATE_EVENT, { detail: { chipId: chip.id } }),
      );
    }, 50);
  }

  function openRadialMenu(event: React.MouseEvent<HTMLButtonElement>) {
    if (onboardingActive) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setRadialMenu((cur) => (cur ? null : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }));
  }

  function createNewTab() {
    // Onboarding gate — see `onboardingActive`. Covers the "+" button and the
    // Cmd/Ctrl+T keyboard shortcut, since both funnel through here.
    if (onboardingActive) return;
    const normalized = normalizeTabsState(state);
    const existingEntryTab = normalized.tabs.find((tab) => tab.kind === 'entry');
    if (existingEntryTab) {
      setState({
        ...normalized,
        tabs: normalized.tabs.map((tab) =>
          tab.id === existingEntryTab.id
            ? {
                ...tab,
                view: 'home',
                entryRoute: { kind: 'home', view: 'home' },
              }
            : tab,
        ),
        activeTabId: existingEntryTab.id,
      });
      navigate({ kind: 'home', view: 'home' });
    } else {
      const tab = createEntryTab('home');
      setState({
        tabs: [...normalized.tabs, tab],
        activeTabId: tab.id,
      });
      navigate({ kind: 'home', view: 'home' });
    }
  }

  function closeTab(tabId: string) {
    const normalized = normalizeTabsState(state);
    const closingIndex = normalized.tabs.findIndex((tab) => tab.id === tabId);
    if (closingIndex < 0) return;
    // The single entry tab is permanent — never close it, whatever section
    // (home / projects / design-systems / …) it currently shows.
    const closingTab = normalized.tabs[closingIndex]!;
    if (closingTab.kind === 'entry') return;
    if (closingTab.kind === 'external') {
      dispatchCloseWorkspaceExternalTab(routeForTab(closingTab));
    }
    let nextRoute: Route | null = null;
    const nextTabs = normalized.tabs.filter((tab) => tab.id !== tabId);
    let nextState: WorkspaceTabsState;
    if (nextTabs.length === 0) {
      const homeTab = createEntryTab('home');
      nextRoute = routeForTab(homeTab);
      nextState = { tabs: [homeTab], activeTabId: homeTab.id };
    } else if (normalized.activeTabId !== tabId) {
      nextState = { ...normalized, tabs: nextTabs };
    } else {
      const replacement = nextTabs[Math.min(closingIndex, nextTabs.length - 1)] ?? nextTabs[0]!;
      nextRoute = routeForTab(replacement);
      nextState = { tabs: nextTabs, activeTabId: replacement.id };
    }
    setState(nextState);
    if (nextRoute) navigate(nextRoute);
  }

  function reorderTab(sourceId: string, targetId: string, edge: TabDropEdge) {
    setState((current) => {
      const normalized = normalizeTabsState(current);
      const tabs = reorderTabsById(normalized.tabs, sourceId, targetId, edge);
      if (tabs === normalized.tabs) return normalized;
      // Re-normalize so the Home tab is re-pinned to the leftmost slot even when
      // a drop would otherwise have placed a tab before it. Home is the one
      // permanent, non-closable tab and must always sit first.
      return normalizeTabsState({ ...normalized, tabs });
    });
  }

  function findTabDropTarget(event: DragEvent<HTMLElement>, sourceId: string): TabDragTarget | null {
    const strip = stripRef.current;
    if (!strip) return null;

    // The single entry tab is pinned leftmost: never expose a drop target that
    // would place another tab before it. Coerce any 'before entry' edge to
    // 'after entry' so the live drag indicator and persisted order keep it first.
    const entryTabId = state.tabs.find((tab) => tab.kind === 'entry')?.id;
    const resolveTarget = (target: TabDragTarget): TabDragTarget =>
      target.tabId === entryTabId && target.edge === 'before'
        ? { tabId: target.tabId, edge: 'after' }
        : target;

    const eventTarget = event.target;
    if (eventTarget instanceof HTMLElement) {
      const tabElement = eventTarget.closest<HTMLElement>('[data-workspace-tab-id]');
      if (tabElement && strip.contains(tabElement)) {
        const tabId = tabElement.dataset.workspaceTabId;
        if (tabId && tabId !== sourceId) {
          return resolveTarget({ tabId, edge: tabDropEdgeFromElement(event, strip, tabElement) });
        }
      }
    }

    let lastTarget: TabDragTarget | null = null;
    for (const tabElement of strip.querySelectorAll<HTMLElement>('[data-workspace-tab-id]')) {
      if (tabElement.classList.contains('is-overflow-hidden')) continue;
      const tabId = tabElement.dataset.workspaceTabId;
      if (!tabId || tabId === sourceId) continue;
      const span = tabLayoutSpan(strip, tabElement);
      if (event.clientX <= span.mid) return resolveTarget({ tabId, edge: 'before' });
      if (event.clientX <= span.right) return resolveTarget({ tabId, edge: 'after' });
      lastTarget = { tabId, edge: 'after' };
    }
    return lastTarget;
  }

  function handleTabDragStart(tabId: string, event: DragEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('.workspace-tab__close')) {
      event.preventDefault();
      return;
    }
    dragSuppressClickRef.current = true;
    draggingTabIdRef.current = tabId;
    dragHapticTargetRef.current = `${tabId}:self`;
    setDragOverTarget(null);
    setDraggingTabId(tabId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tabId);
    pulseTabDragHaptic();
  }

  function handleStripDragOver(event: DragEvent<HTMLDivElement>) {
    const sourceId = draggingTabIdRef.current ?? event.dataTransfer.getData('text/plain');
    if (!sourceId) return;
    const target = findTabDropTarget(event, sourceId);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const targetKey = tabDragTargetKey(target);
    setDragOverTarget((current) =>
      current && tabDragTargetKey(current) === targetKey ? current : target,
    );
    if (dragHapticTargetRef.current !== targetKey) {
      dragHapticTargetRef.current = targetKey;
      pulseTabDragHaptic();
    }
    reorderTab(sourceId, target.tabId, target.edge);
  }

  function handleStripDrop(event: DragEvent<HTMLDivElement>) {
    const sourceId = draggingTabIdRef.current ?? event.dataTransfer.getData('text/plain');
    if (sourceId) {
      event.preventDefault();
    }
    const target = sourceId ? findTabDropTarget(event, sourceId) : null;
    if (sourceId && target) {
      reorderTab(sourceId, target.tabId, target.edge);
      pulseTabDragHaptic(TAB_DROP_HAPTIC_MS);
    }
    draggingTabIdRef.current = null;
    dragHapticTargetRef.current = null;
    setDragOverTarget(null);
    setDraggingTabId(null);
    window.setTimeout(() => {
      dragSuppressClickRef.current = false;
    }, 0);
  }

  function handleStripDragLeave(event: DragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDragOverTarget(null);
  }

  function handleTabDragEnd() {
    draggingTabIdRef.current = null;
    dragHapticTargetRef.current = null;
    setDragOverTarget(null);
    setDraggingTabId(null);
    window.setTimeout(() => {
      dragSuppressClickRef.current = false;
    }, 0);
  }

  const dockPortal = (node: ReactNode) =>
    tabsDockEl ? createPortal(node, tabsDockEl) : node;

  // Docked (project-route) presentation: one white dropdown spanning the chat
  // column instead of the pill strip. The strip still renders (hidden by CSS)
  // so its measurement/drag hooks keep their DOM.
  const dockDropdownNode = (() => {
    if (!tabsDockEl) return null;
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
    if (!activeTab) return null;
    const activeDisplay =
      displayTabById.get(activeTab.id)
        ?? displayTabFor(activeTab, projectById, t, knownProjectNamesRef.current);
    const isEntryActive = activeTab.kind === 'entry';
    // Most recently opened first. The active tab ranks first even before the
    // MRU effect has run for it; never-activated tabs keep strip order after.
    const mru = tabMruRef.current;
    const mruRank = (tab: WorkspaceChromeTab): number => {
      if (tab.id === state.activeTabId) return -1;
      const index = mru.indexOf(tab.id);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    const projectTabs = state.tabs
      .filter((tab) => tab.kind !== 'entry')
      .sort((a, b) => mruRank(a) - mruRank(b));
    return (
      <div className="workspace-tabs-dropdown" data-testid="workspace-tabs-dropdown">
        <button
          type="button"
          className="workspace-tabs-dropdown__trigger"
          aria-haspopup="listbox"
          aria-expanded={dockMenuOpen}
          onClick={() => setDockMenuOpen((v) => !v)}
          data-testid="workspace-tabs-dropdown-trigger"
        >
          <span className="workspace-tabs-dropdown__icon" aria-hidden>
            <Icon name={isEntryActive ? 'home' : activeDisplay.icon} size={14} />
          </span>
          <span className="workspace-tabs-dropdown__label">{activeDisplay.title}</span>
          <Icon name="chevron-down" size={14} />
        </button>
        {dockMenuOpen ? (
          <>
            <div
              className="workspace-tabs-dropdown__backdrop"
              onClick={() => setDockMenuOpen(false)}
            />
            <div className="workspace-tabs-dropdown__menu" role="listbox">
              {projectTabs.map((tab) => {
                const display =
                  displayTabById.get(tab.id)
                    ?? displayTabFor(tab, projectById, t, knownProjectNamesRef.current);
                const active = tab.id === state.activeTabId;
                return (
                  <div
                    key={tab.id}
                    className={`workspace-tabs-dropdown__row${active ? ' is-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="workspace-tabs-dropdown__row-main"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        setDockMenuOpen(false);
                        openTab(tab);
                      }}
                    >
                      <Icon name={display.icon} size={14} />
                      <span className="workspace-tabs-dropdown__row-label">{display.title}</span>
                      {active ? <Icon name="check" size={14} /> : null}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    );
  })();

  const overflowMenuPortal =
    !tabsDockEl
    && overflowMenuOpen
    && overflowMenuPosition
    && overflowChromeTabs.length > 0
      ? createPortal(
          <>
            <div
              className="workspace-tabs-overflow__backdrop"
              onMouseDown={() => setOverflowMenuOpen(false)}
            />
            <div
              className="workspace-tabs-overflow__menu"
              role="listbox"
              aria-label="More tabs"
              style={{
                top: overflowMenuPosition.top,
                left: overflowMenuPosition.left,
              }}
              data-testid="workspace-tabs-overflow-menu"
            >
              {overflowChromeTabs.map((tab) => {
                const display =
                  displayTabById.get(tab.id)
                    ?? displayTabFor(tab, projectById, t, knownProjectNamesRef.current);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className="workspace-tabs-overflow__row"
                    role="option"
                    aria-selected="false"
                    onClick={() => {
                      setOverflowMenuOpen(false);
                      openTab(tab);
                    }}
                  >
                    <span className="workspace-tabs-overflow__row-icon" aria-hidden>
                      <Icon name={display.icon} size={14} />
                    </span>
                    <span className="workspace-tabs-overflow__row-label">{display.title}</span>
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <header
      className={`app-chrome-header workspace-tabs-chrome${tabsDockEl ? ' is-docked' : ''}`}
      aria-label="Workspace tabs"
    >
      <div className="app-chrome-traffic-space workspace-tabs-traffic" aria-hidden />
      {/* Docked mode: the chrome row keeps only the brand-logo button (the
          floating account cluster rides fixed at the window's top-right on
          its own); the strip renders in the chat column's dock, level with
          the workspace 设计文件 row. The strip's own pinned entry tab hides
          inside the dock (CSS) — this button is its chrome-row stand-in.
          In chat the logo means 回到首页. */}
      {tabsDockEl && state.tabs[0] ? (
        <button
          type="button"
          className="workspace-tabs-home-chrome od-tooltip"
          aria-label={t('entry.navHome')}
          title={t('entry.navHome')}
          data-tooltip={t('entry.navHome')}
          data-tooltip-placement="bottom"
          data-testid="workspace-home-chrome"
          onClick={() => openTab(state.tabs[0]!)}
        >
          <ChromeHomeGlyph />
        </button>
      ) : null}
      {dockPortal(
      <>
      {dockDropdownNode}
      <div
        className={`workspace-tabs-strip${tabsOverflowing ? ' is-overflowing' : ''}`}
        role="tablist"
        aria-label="Open workspaces"
        ref={setStripNode}
        onDragOver={handleStripDragOver}
        onDrop={handleStripDrop}
        onDragLeave={handleStripDragLeave}
      >
        {/* Browser-style adaptive tabs: rows flex down to the minimum readable
            width first. If the measured chrome still cannot hold them all,
            excess rows remain mounted but are visually collected into the
            trailing ··· menu. The active tab is always part of the visible
            window, so switching from the menu never leaves the active surface
            hidden behind the fixed account cluster. */}
        {/* Liquid-glass active-tab pill: positioned by useGlideIndicator in
            the strip's content coordinates, painted by the __pill (frosted
            everywhere, SDF refraction on Chromium via useLiquidGlass). First
            child so `.workspace-tab + .workspace-tab` sibling selectors and
            [data-workspace-tab-id] queries stay untouched. */}
        <div className="workspace-tabs-glide" ref={glideRef} aria-hidden="true">
          <div
            className="workspace-tabs-glide__pill od-glass-refract"
            ref={setGlidePillRef}
          />
        </div>
        {/* Every tab always renders a strip row — rows are the state/
            measurement/drag DOM the tab machinery (and its tests) rely on.
            The chrome row VISUALLY shows only the pinned Home tab (per
            product: 顶部只保留 home 和头像/积分): undocked project rows are
            hidden by CSS (routines.css), the same way the docked strip hides
            behind the chat-column dropdown. */}
        {state.tabs.map((tab) => {
          const display =
            displayTabById.get(tab.id) ?? displayTabFor(tab, projectById, t, knownProjectNamesRef.current);
          const active = tab.id === state.activeTabId;
          // The single entry tab is permanent and pinned leftmost: it cannot be
          // closed or dragged out of the first slot, whatever section it shows.
          const isPinned = tab.kind === 'entry';
          const overflowHidden = !visibleChromeTabIds.has(tab.id);
          const dragOverClass =
            dragOverTarget?.tabId === tab.id && draggingTabId !== tab.id
              ? ` is-drag-over-${dragOverTarget.edge}`
              : '';
          return (
            <div
              key={tab.id}
              className={`workspace-tab${active ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}${overflowHidden ? ' is-overflow-hidden' : ''}${draggingTabId === tab.id ? ' is-dragging' : ''}${dragOverClass}`}
              data-workspace-tab-id={tab.id}
              role="tab"
              aria-selected={active}
              draggable={!isPinned && state.tabs.length > 1}
              onDragStart={(event) => handleTabDragStart(tab.id, event)}
              onDragEnd={handleTabDragEnd}
            >
              {isPinned && active && tab.view === 'home' ? (
                /* Home view: the pinned tab is the brand-logo button. The
                   COLLAPSE control moved into the rail (after its search box),
                   so the logo only re-opens a collapsed rail — with the rail
                   open it is inert (you are already home, nothing to expand). */
                <button
                  type="button"
                  className={`workspace-tab__rail-toggle od-tooltip${entryRailOpen ? ' is-inert' : ''}`}
                  aria-label={entryRailOpen ? t('entry.navHome') : t('entry.navExpand')}
                  aria-expanded={entryRailOpen}
                  title={entryRailOpen ? undefined : t('entry.navExpand')}
                  data-tooltip={entryRailOpen ? undefined : t('entry.navExpand')}
                  data-tooltip-placement="bottom"
                  data-testid="workspace-home-rail-toggle"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!entryRailOpen) {
                      window.dispatchEvent(new CustomEvent(ENTRY_RAIL_TOGGLE_EVENT));
                    }
                  }}
                >
                  <ChromeHomeGlyph />
                  {/* Collapsed-rail hover swaps the logo for the expand-sidebar
                      glyph, so the button telegraphs its one action. CSS keys
                      the swap off :not(.is-inert):hover. */}
                  <svg
                    className="workspace-chrome-logo-swap"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M5 5H13V19H5V5ZM19 19H15V5H19V19ZM4 3C3.44772 3 3 3.44772 3 4V20C3 20.5523 3.44772 21 4 21H20C20.5523 21 21 20.5523 21 20V4C21 3.44772 20.5523 3 20 3H4ZM11 12L7 8.5V15.5L11 12Z" />
                  </svg>
                </button>
              ) : isPinned && active ? (
                /* Any other entry section (settings / all-projects / community /
                   design-systems …): the logo reads as Home; clicking returns
                   home. */
                <button
                  type="button"
                  className="workspace-tab__rail-toggle od-tooltip"
                  aria-label={t('entry.navHome')}
                  title={t('entry.navHome')}
                  data-tooltip={t('entry.navHome')}
                  data-tooltip-placement="bottom"
                  data-testid="workspace-home-nav"
                  onClick={(event) => {
                    event.stopPropagation();
                    openTab(tab);
                  }}
                >
                  <ChromeHomeGlyph />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="workspace-tab__main"
                    onClick={() => openTab(tab)}
                  >
                    <span className="workspace-tab__icon" aria-hidden>
                      {/* The pinned entry tab remembers its last entry route
                          (community / square tool / …). From another workspace
                          tab, clicking this glyph restores that route; when the
                          entry tab is already active, the same glyph is the
                          explicit Home action. Keep the brand/home glyph in both
                          cases instead of exposing the remembered section icon. */}
                      {isPinned ? (
                        <ChromeHomeGlyph />
                      ) : (
                        <Icon name={display.icon} size={14} />
                      )}
                    </span>
                    <span className="workspace-tab__label">{display.title}</span>
                  </button>
                  {isPinned ? null : (
                    <button
                      type="button"
                      className="workspace-tab__close od-tooltip"
                      aria-label={t('common.close')}
                      title={t('common.close')}
                      data-tooltip={t('common.close')}
                      data-tooltip-placement="bottom"
                      onClick={() => closeTab(tab.id)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
        {!tabsDockEl && tabsOverflowing ? (
          <button
            ref={overflowButtonRef}
            type="button"
            className={`workspace-tabs-overflow__trigger${overflowMenuOpen ? ' is-open' : ''}`}
            aria-haspopup="listbox"
            aria-expanded={overflowMenuOpen}
            aria-label={`More tabs (${overflowChromeTabs.length})`}
            title={`More tabs (${overflowChromeTabs.length})`}
            data-testid="workspace-tabs-overflow-trigger"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const menuWidth = 280;
              const viewportInset = 8;
              setOverflowMenuPosition({
                top: rect.bottom + 6,
                left: Math.max(
                  viewportInset,
                  Math.min(
                    window.innerWidth - menuWidth - viewportInset,
                    rect.right - menuWidth,
                  ),
                ),
              });
              setOverflowMenuOpen((open) => !open);
            }}
          >
            <span aria-hidden>···</span>
          </button>
        ) : null}
        {/* #5517 drops the top-right "+"; new tab stays reachable through
            ⌘/Ctrl+T. That "+" was the ONLY caller of openRadialMenu, so the
            radial template menu below is now unreachable — its state and
            markup stay, as the reference keeps them.

            The tab-search button (and its popover) was removed per request
            (2026-07-24); a tab scrolled out of view is reached by scrolling
            the strip or cycling with Ctrl+Tab / ⌘1-9. */}
      </div>
      </>,
      )}
      {overflowMenuPortal}
      {radialMenu ? createPortal(
        <div className="workspace-radial-layer" onMouseDown={() => setRadialMenu(null)}>
          <div
            className="workspace-radial-menu"
            style={{ left: radialMenu.x - (RADIAL_SIZE - RADIAL_PAD), top: radialMenu.y - RADIAL_PAD, width: RADIAL_SIZE, height: RADIAL_SIZE }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <svg width={RADIAL_SIZE} height={RADIAL_SIZE} viewBox={`0 0 ${RADIAL_SIZE} ${RADIAL_SIZE}`}>
              {radialSlots.map((slot) => {
                const [a1, a2] = radialWedgeAngles(slot.seg, slot.segCount);
                const r0 = radialBandRadius(slot.band);
                const r1 = radialBandRadius(slot.band + 1);
                const isHover = slot.chip.id === radialHoverId;
                return (
                  <path
                    key={slot.chip.id}
                    className={`workspace-radial-sector-path${isHover ? ' is-hover' : ''}`}
                    d={radialSectorPath(RADIAL_CX, RADIAL_CY, a1, a2, r0, r1)}
                    role="menuitem"
                    aria-label={homeHeroChipLabel(slot.chip.id, t)}
                    data-testid={`workspace-radial-template-${slot.chip.id}`}
                    onMouseEnter={() => setRadialHoverId(slot.chip.id)}
                    onMouseLeave={() => setRadialHoverId((v) => (v === slot.chip.id ? null : v))}
                    onClick={() => openTemplateFromRadial(slot.chip)}
                  />
                );
              })}
            </svg>
            {radialSlots.map((slot) => {
              const [a1, a2] = radialWedgeAngles(slot.seg, slot.segCount);
              const mid = (a1 + a2) / 2;
              const rmid = (radialBandRadius(slot.band) + radialBandRadius(slot.band + 1)) / 2;
              const ix = RADIAL_CX + rmid * Math.cos((mid * Math.PI) / 180);
              const iy = RADIAL_CY + rmid * Math.sin((mid * Math.PI) / 180);
              const isHover = slot.chip.id === radialHoverId;
              return (
                <span
                  key={slot.chip.id}
                  className={`workspace-radial-icon-btn${isHover ? ' is-hover' : ''}`}
                  aria-hidden
                  style={{ left: ix, top: iy }}
                  title={homeHeroChipLabel(slot.chip.id, t)}
                >
                  <Icon name={slot.chip.icon} size={17} />
                </span>
              );
            })}
          </div>
          <button
            type="button"
            className="workspace-radial-close"
            style={{ left: radialMenu.x, top: radialMenu.y }}
            aria-label={t('common.close')}
            title={t('common.close')}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setRadialMenu(null)}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>,
        document.body,
      ) : null}
    </header>
  );
}

function displayTabFor(
  tab: WorkspaceChromeTab,
  projectById: Map<string, Project>,
  t: ReturnType<typeof useT>,
  knownProjectNames?: Map<string, string>,
): DisplayTab {
  if (tab.kind === 'project') {
    const project = projectById.get(tab.projectId);
    // recvq5eKj2kdF0: `projectById` only covers this render's fetched list
    // (Home's fetch is capped/scoped and does not include every open tab's
    // project) — fall back to the last real name this tab showed before
    // falling back further to the untitled label, so a tab with a real name
    // never regresses to "untitled" just because Home reloaded.
    const title = project?.name?.trim() || knownProjectNames?.get(tab.projectId) || t('common.untitled');
    return {
      id: tab.id,
      title,
      meta: t('workspaceTabs.project'),
      icon: 'folder',
      tab,
    };
  }
 if (tab.kind === 'marketplace') {
   return {
     id: tab.id,
     title: tab.pluginId ? t('workspaceTabs.pluginDetails') : t('workspaceTabs.marketplace'),
     meta: t('entry.navPlugins'),
     icon: 'grid',
     tab,
   };
 }
 if (tab.kind === 'external') {
   return {
     id: tab.id,
     title: tab.title,
     meta: tab.url,
     icon: 'link',
     tab,
   };
 }
 const entryTitle: Record<EntryHomeView, string> = {
    home: t('entry.navHome'),
    onboarding: t('settings.welcomeTitle'),
    projects: t('entry.navProjects'),
    tasks: t('entry.navTasks'),
    plugins: t('entry.navPlugins'),
    'design-systems': t('entry.navDesignSystems'),
    library: 'Library',
    brands: t('entry.navBrands'),
    integrations: t('entry.navIntegrations'),
  community: t('pluginsHome.title'),
  square: t('entry.navPlaza'),
  'my-publishes': t('squareScope.myPublishes'),
  drafts: t('entry.navDrafts'),
    'all-projects': t('entry.navAllProjects'),
    members: t('entry.navMembers'),
    board: t('entry.navBoard'),
   'workspace-settings': t('entry.navWorkspaceSettings'),
  'team-space': t('entry.navTeamSection'),
  'team-folder': t('entry.navTeamSection'),
'personal-all': t('personalFunc.all'),
'shared-with-me': t('personalFunc.shared'),
'personal-folder': t('personalFunc.all'),
'shared-folder': t('personalFunc.shared'),
settings: t('settings.title'),
};
const entryIcon: Record<EntryHomeView, IconName> = {
    home: 'home',
    onboarding: 'sparkles',
    projects: 'folder',
    tasks: 'kanban',
    plugins: 'grid',
    'design-systems': 'blocks',
    library: 'image',
    brands: 'blocks',
    integrations: 'link',
   community: 'globe',
  square: 'sparkles',
  'my-publishes': 'sparkles',
  drafts: 'file',
    'all-projects': 'folder',
    members: 'users',
    board: 'kanban',
   'workspace-settings': 'settings',
  'team-space': 'folder',
  'team-folder': 'folder-filled',
'personal-all': 'folder-filled',
'shared-with-me': 'share',
'personal-folder': 'folder-filled',
'shared-folder': 'folder-filled',
settings: 'settings',
};
 return {
    id: tab.id,
    title: entryTitle[tab.view],
    meta: tab.view === 'home' ? 'Start a new project' : 'Workspace',
    icon: entryIcon[tab.view],
    tab,
  };
}
