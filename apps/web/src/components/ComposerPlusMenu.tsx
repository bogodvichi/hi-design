import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  ConnectorDetail,
  InstalledPluginRecord,
  McpServerConfig,
  SkillSummary,
  WorkspaceCollabContext,
} from '@open-design/contracts';
import { useI18n, useT } from '../i18n';
import { localizeSkillName } from '../i18n/content';
import { LIBRARY_UI_VISIBLE } from '../features/libraryUi';
import { resolveFlyoutSide } from './composer-flyout-placement';
import { skillMatchesQuery } from '../runtime/design-toolbox';
import { Icon, type IconName } from './Icon';

const PLUS_MENU_MARGIN = 12;
const PLUS_MENU_GAP = 8;
const PLUS_MENU_WIDTH = 190;
const PLUS_MENU_FLYOUT_WIDTH = 360;
const PLUS_MENU_FLYOUT_MAX_HEIGHT = 320;
// Fallback "does the menu fit?" budget used only until the popup has been
// measured (first layout pass). Once `contentHeight` is known the real stack
// height drives the flip decision instead of this approximation.
const PLUS_MENU_MIN_HEIGHT = 260;
export type PlusMenuPlacementPreference = 'auto' | 'down' | 'up';
type PlusMenuFlyoutPlacement = 'right' | 'left' | 'contained';
type PlusMenuFlyoutVerticalPlacement = 'down' | 'up';
type PlusMenuVerticalPlacement = 'down' | 'up';
export type PlusMenuSubmenu = 'connectors' | 'plugins' | 'skills' | 'mcp' | 'toolbox' | 'workingDir';

// Analytics mapping for the submenu flyouts: which resource list each
// submenu carries. `toolbox` is intentionally absent — the project composer
// tracks it separately as `design_toolbox_open`. `workingDir` is absent too:
// its flyout carries actions, not an attachable resource list.
export const PLUS_SUBMENU_RESOURCE_KIND = {
  connectors: 'connector',
  plugins: 'plugin',
  skills: 'skill',
  mcp: 'mcp',
} as const;
type PlusMenuPopupStyle = CSSProperties & Record<'--plus-menu-flyout-max-height', string>;

/** Last path segment for the working-dir recent rows (mirrors WorkingDirPicker). */
function dirBasename(dir: string): string {
  return dir.split(/[/\\]/).filter(Boolean).pop() ?? dir;
}

function getFlyoutBoundary(anchor: HTMLElement): Pick<DOMRect, 'left' | 'right'> {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const viewportBounds = { left: PLUS_MENU_MARGIN, right: viewportWidth - PLUS_MENU_MARGIN };
  const boundary = anchor.closest('.split-chat-slot, .pane');
  if (!boundary) return viewportBounds;

  const rect = boundary.getBoundingClientRect();
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.right) || rect.right <= rect.left) {
    return viewportBounds;
  }

  return {
    left: Math.max(PLUS_MENU_MARGIN, rect.left),
    right: Math.min(viewportWidth - PLUS_MENU_MARGIN, rect.right),
  };
}

/**
 * Which side of the trigger the popup opens on.
 *
 * The surface states a preference (home drops down like Claude Design's
 * project picker, the project composer rises so it stays attached to the chat
 * bar), but a preference is not a mandate: the popup uses `overflow: visible`
 * so a stack taller than the room on the preferred side spills off-screen with
 * no way to scroll it back in. Whenever the preferred side cannot hold the
 * measured content and the opposite side has more room, flip.
 */
function resolvePlusMenuVerticalPlacement(
  spaceAbove: number,
  spaceBelow: number,
  preference: PlusMenuPlacementPreference,
  requiredHeight: number,
): PlusMenuVerticalPlacement {
  const preferred: PlusMenuVerticalPlacement = preference === 'up' ? 'up' : 'down';
  const preferredSpace = preferred === 'up' ? spaceAbove : spaceBelow;
  const otherSpace = preferred === 'up' ? spaceBelow : spaceAbove;
  if (preferredSpace >= requiredHeight) return preferred;
  if (otherSpace > preferredSpace) return preferred === 'up' ? 'down' : 'up';
  return preferred;
}

function getPlusMenuStyle(
  anchor: HTMLElement,
  placementPreference: PlusMenuPlacementPreference,
  contentHeight: number | null,
): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || PLUS_MENU_WIDTH;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 640;
  const width = Math.min(PLUS_MENU_WIDTH, Math.max(0, viewportWidth - PLUS_MENU_MARGIN * 2));
  const left = Math.min(
    Math.max(PLUS_MENU_MARGIN, rect.left),
    Math.max(PLUS_MENU_MARGIN, viewportWidth - PLUS_MENU_MARGIN - width),
  );
  const spaceBelow = viewportHeight - rect.bottom - PLUS_MENU_MARGIN - PLUS_MENU_GAP;
  const spaceAbove = rect.top - PLUS_MENU_MARGIN - PLUS_MENU_GAP;
  const requiredHeight = contentHeight ?? PLUS_MENU_MIN_HEIGHT;

  if (
    resolvePlusMenuVerticalPlacement(spaceAbove, spaceBelow, placementPreference, requiredHeight)
      === 'up'
  ) {
    return {
      left,
      top: 'auto',
      bottom: Math.max(PLUS_MENU_MARGIN, viewportHeight - rect.top + PLUS_MENU_GAP),
      width,
      maxHeight: Math.max(0, spaceAbove),
    };
  }

  return {
    left,
    top: Math.max(PLUS_MENU_MARGIN, rect.bottom + PLUS_MENU_GAP),
    bottom: 'auto',
    width,
    maxHeight: Math.max(0, spaceBelow),
  };
}

function getFlyoutPlacement(
  anchor: HTMLElement,
  flyoutWidth: number = PLUS_MENU_FLYOUT_WIDTH,
): PlusMenuFlyoutPlacement {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const boundary = getFlyoutBoundary(anchor);
  const menuWidth = Math.min(PLUS_MENU_WIDTH, Math.max(0, viewportWidth - PLUS_MENU_MARGIN * 2));
  const menuLeft = Math.min(
    Math.max(PLUS_MENU_MARGIN, rect.left),
    Math.max(PLUS_MENU_MARGIN, viewportWidth - PLUS_MENU_MARGIN - menuWidth),
  );
  return resolveFlyoutSide({
    menuLeft,
    menuWidth,
    flyoutWidth,
    gap: PLUS_MENU_GAP,
    boundaryLeft: boundary.left,
    boundaryRight: boundary.right,
  });
}



export interface ComposerPlusMenuProps {
  workspaceContext?: WorkspaceCollabContext | null;
  /** Connector context options shown under the "Connectors" submenu. */
  connectors: ConnectorDetail[];
  onPickConnector: (connector: ConnectorDetail) => void;
  /** Opens the connector integration surface; omit to hide the add row. */
  onAddConnector?: () => void;

  /** Installed plugin options shown under the "Plugins" submenu. */
  plugins: InstalledPluginRecord[];
  onPickPlugin: (plugin: InstalledPluginRecord) => void;
  /** Opens the plugin registry; omit to hide the add row. */
  onAddPlugin?: () => void;
  /**
   * Hide the whole Plugins submenu row. The project composer sets this: its
   * 插件 quick pill above the input owns the plugins surface, so the row here
   * would be a duplicate. Home keeps the row (it has no pills).
   */
  hidePluginsRow?: boolean;

  /** Enabled MCP servers shown under the "MCP" submenu. */
  mcpServers: McpServerConfig[];
  onPickMcp: (server: McpServerConfig) => void;
 /** Opens MCP settings; omit to hide the add row. */
 onAddMcp?: () => void;
  /** Opens the MCP management surface (/personal-all/mcp). */
  onManageMcp?: () => void;

 /** Installed skills shown under the "Skills" submenu. */
  skills?: SkillSummary[];
  onPickSkill?: (skill: SkillSummary) => void;
  /** Opens the add-skill dialog; omit to hide the row. */
  onAddSkill?: () => void;
  /** Opens the skill management surface (/personal-all/skill). */
  onManageSkills?: () => void;

  /**
   * Show a "Team" scope tab after "Mine" in the Skills and MCP submenus.
   * Pass true when localStorage `od:home-folder-context` carries a regular
   * (non-shared) team workspaceId — the tab switches to team-scoped skills
   * and team-installed MCP servers.
   */
  showTeamTab?: boolean;

  /** Current user's member id in the shared (personal) workspace. Used to
   * filter the "Mine" tab: skills/MCPs whose `ownerMemberId` matches. */
  personalMemberId?: string;
  /** Regular team workspace id from `od:home-folder-context`. Used to
   * filter the "Team" tab: skills/MCPs whose `workspaceId` matches. */
  teamWorkspaceId?: string;

  /** Triggers file attachment (opens the native picker). */
  onAttachFiles: () => void;
  attachLoading?: boolean;

  /** Fired when the user switches the Skills scope tab (All / Mine / Team). */
  onSkillTabChange?: (tab: 'all' | 'mine' | 'team') => void;
  /** Fired when the user switches the MCP scope tab (All / Mine / Team). */
  onMcpTabChange?: (tab: 'all' | 'mine' | 'team') => void;

 /** Opens the reference-project picker. */
  onReferenceProject?: () => void;

  /** Opens a native folder picker and stages the folder as local code context. */
  onLinkLocalCode?: () => void;

  /**
   * Working-directory submenu (project composer only): mirrors the Home
   * composer's WorkingDirPicker — pick a folder, re-pick a recent one, or
   * clear the current binding. The whole row renders only when
   * `onPickWorkingDir` is provided; Home keeps its own footer picker.
   */
  workingDir?: string | null;
  recentWorkingDirs?: string[];
  onPickWorkingDir?: () => void;
  onSelectRecentWorkingDir?: (dir: string) => void;
  onClearWorkingDir?: () => void;

  /** Opens the "Select from library" picker; omit to hide the row. */
  onSelectFromLibrary?: () => void;

  /** Opens the "Import from Figma" dialog (offline .fig decode or a Figma
   *  URL → webpage); omit to hide the row. */
  onImportFigma?: () => void;
  /**
   * Accepted for API compatibility but no longer rendered. The "查看方法"
   * (.fig download guide) row was removed from this menu: the "+" menu is a
   * list of things to ATTACH to the message, and a help article is not one of
   * them — it pushed a documentation detour into the middle of the attach
   * flow. The Figma import row itself stays.
   */
  onShowFigmaHelp?: () => void;
  /**
   * Accepted for API compatibility but no longer rendered: both callers
   * implement it by clicking the design-system trigger that already sits in
   * the same composer footer, so the row duplicated a visible control.
   */
  onOpenDesignSystems?: () => void;

  /**
   * Optional "Design toolbox" row, rendered LAST. Only the project composer
   * passes this; the home composer omits it. The returned node is shown in a
   * right-side flyout reusing the same submenu styling.
   */
  renderToolbox?: (close: () => void) => ReactNode;
  toolboxLabel?: string;

  /** Test id for the trigger button. */
  triggerTestId?: string;

  /**
   * Notified when the menu opens. The project composer uses this to latch its
   * lazy plugin / MCP / connector fetches, so the Plugins / Connectors / MCP
   * submenus aren't empty when the "+" menu is the first thing clicked on a
   * cold composer.
   */
  onOpen?: () => void;

  /**
   * Notified when a submenu flyout actually opens (the active submenu
   * changes; repeated hovers over the same open row don't re-fire). Callers
   * use it for analytics; `toolbox` is reported too, and the project
   * composer filters it out because its panel tracks its own open.
   */
  onSubmenuOpen?: (submenu: PlusMenuSubmenu) => void;

  /**
   * Notified once per submenu-open session when the user starts typing in
   * that flyout's search box. Carries which list was searched, never the
   * query text.
   */
  onSearchUsed?: (submenu: 'plugins' | 'skills' | 'mcp') => void;

  /**
   * Home opens below the trigger like Claude Design's project picker, while
   * the bottom project composer opens upward so it stays attached to the chat
   * bar. `auto` leaves the side entirely to the fit check. In every mode the
   * preference yields when the content cannot fit on that side.
   */
  placementPreference?: PlusMenuPlacementPreference;

  /**
   * External open request (e.g. the next-step card's quick-access pills).
   * Bumping `nonce` opens the menu exactly as if the "+" trigger was clicked;
   * `submenu` additionally pre-opens that flyout. `null` never opens.
   */
  openRequest?: { nonce: number; submenu?: PlusMenuSubmenu } | null;
}

function mcpMatches(server: McpServerConfig, needle: string): boolean {
  if (!needle) return true;
  return `${server.label ?? ''} ${server.id}`.toLowerCase().includes(needle);
}

/**
 * The composer "+" menu shared between the home hero and the project chat
 * composer. Owns its own open / submenu / search state; callers supply the
 * data lists and pick/add handlers. Pass `renderToolbox` to append the
 * project-only design-toolbox row.
 */
export function ComposerPlusMenu({
  workspaceContext = null,
  connectors,
  onPickConnector,
  onAddConnector,
  plugins,
  onPickPlugin,
  onAddPlugin,
  hidePluginsRow,
  skills = [],
  onPickSkill,
  onAddSkill,
  onManageSkills,
  mcpServers,
  onPickMcp,
  onAddMcp,
  onManageMcp,
 showTeamTab,
  personalMemberId,
  teamWorkspaceId,
  onAttachFiles,
  attachLoading,
  onReferenceProject,
  onSkillTabChange,
  onMcpTabChange,
  onLinkLocalCode,
  workingDir,
  recentWorkingDirs,
  onPickWorkingDir,
  onSelectRecentWorkingDir,
  onClearWorkingDir,
  onSelectFromLibrary,
  onImportFigma,
  renderToolbox,
  toolboxLabel,
  triggerTestId,
  onOpen,
  onSubmenuOpen,
  onSearchUsed,
  placementPreference = 'auto',
  openRequest,
}: ComposerPlusMenuProps) {
  const t = useT();
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<PlusMenuSubmenu | null>(null);
  const [query, setQuery] = useState('');
  const [skillTab, setSkillTab] = useState<'all' | 'mine' | 'team'>('all');
  const [mcpTab, setMcpTab] = useState<'all' | 'mine' | 'team'>('all');
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [flyoutPlacement, setFlyoutPlacement] = useState<PlusMenuFlyoutPlacement>('right');
  const [flyoutVerticalPlacement, setFlyoutVerticalPlacement] = useState<PlusMenuFlyoutVerticalPlacement>('down');
  const [flyoutMaxHeight, setFlyoutMaxHeight] = useState(PLUS_MENU_FLYOUT_MAX_HEIGHT);
  // Natural (unclamped) height of the row stack, measured from the rendered
  // popup. Drives the flip decision so a menu that outgrows the room under the
  // trigger opens upward instead of spilling off the viewport bottom.
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const submenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether onSearchUsed already fired for the current submenu-open session.
  const searchUsedRef = useRef(false);

  // The plugin and MCP flyouts share one `query`, but it is scoped to whichever
  // submenu is open. Reset it whenever the active submenu changes so a stale
  // plugin search (e.g. "deck") never filters the MCP list — which would
  // otherwise show the empty state even when servers exist.
  useEffect(() => {
    setQuery('');
    setSkillTab('all');
    setMcpTab('all');
    searchUsedRef.current = false;
  }, [submenu]);

  useEffect(() => () => {
    if (submenuCloseTimer.current) clearTimeout(submenuCloseTimer.current);
  }, []);

  // Hover intent: side flyouts have a small visual gap from the parent row, so
  // closing immediately on row mouseleave makes diagonal cursor movement feel
  // broken. Defer close briefly; entering the flyout cancels the pending close.
  function cancelSubmenuClose() {
    if (submenuCloseTimer.current) {
      clearTimeout(submenuCloseTimer.current);
      submenuCloseTimer.current = null;
    }
  }

  function scheduleCloseSubmenu() {
    cancelSubmenuClose();
    submenuCloseTimer.current = setTimeout(() => {
      submenuCloseTimer.current = null;
      // Typing into a flyout's search box narrows its list, which reflows rows
      // out from under a stationary cursor — the browser then synthesizes a
      // `mouseleave` on the flyout even though the pointer never moved. Honoring
      // that close would yank the search box (and its preview column) away
      // mid-search, making the plugin impossible to pick. Keep the submenu open
      // while its own search input still owns focus; the outside-click / Escape
      // handlers remain the deliberate ways to dismiss it.
      const active = document.activeElement;
      if (active && popupRef.current?.contains(active) && active.tagName === 'INPUT') {
        return;
      }
      setSubmenu(null);
    }, 200);
  }

  function close() {
    cancelSubmenuClose();
    setOpen(false);
    setSubmenu(null);
  }

  function updateFlyoutGeometry(row: HTMLDivElement | null) {
    if (!row) {
      setFlyoutVerticalPlacement('down');
      setFlyoutMaxHeight(PLUS_MENU_FLYOUT_MAX_HEIGHT);
      return;
    }
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 640;
    const rowRect = row.getBoundingClientRect();
    const downSpace = viewportHeight - (rowRect.top - 5) - PLUS_MENU_MARGIN;
    const upSpace = rowRect.bottom + 5 - PLUS_MENU_MARGIN;
    const verticalPlacement =
      downSpace >= PLUS_MENU_FLYOUT_MAX_HEIGHT || downSpace >= upSpace ? 'down' : 'up';
    setFlyoutVerticalPlacement(verticalPlacement);
    setFlyoutMaxHeight(
      Math.max(
        120,
        Math.min(
          PLUS_MENU_FLYOUT_MAX_HEIGHT,
          verticalPlacement === 'up' ? upSpace : downSpace,
        ),
      ),
    );
  }

  function openSubmenu(
    next: PlusMenuSubmenu,
    row: HTMLDivElement | null,
  ) {
    cancelSubmenuClose();
    updateFlyoutGeometry(row);
    if (submenu !== next) onSubmenuOpen?.(next);
    setSubmenu(next);
  }

  // External open request (quick-access pills): replay the trigger-click open,
  // then pre-open the requested flyout. Keyed on nonce so a repeat click
  // re-opens after a close. No row anchor exists yet, so the flyout geometry
  // falls back to the default down placement.
  const lastOpenRequestNonceRef = useRef(0);
  useEffect(() => {
    if (!openRequest || openRequest.nonce === lastOpenRequestNonceRef.current) return;
    lastOpenRequestNonceRef.current = openRequest.nonce;
    cancelSubmenuClose();
    onOpen?.();
    setOpen(true);
    if (openRequest.submenu) openSubmenu(openRequest.submenu, null);
    // openSubmenu / cancelSubmenuClose are hoisted per-render function
    // declarations; the nonce ref is the real change detector here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  function handleQueryChange(value: string) {
    if (
      !searchUsedRef.current &&
      value.trim() &&
      (submenu === 'plugins' || submenu === 'skills' || submenu === 'mcp')
    ) {
      searchUsedRef.current = true;
      onSearchUsed?.(submenu);
    }
    setQuery(value);
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (submenu) {
        setSubmenu(null);
        return;
      }
      close();
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, submenu]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      setContentHeight(null);
      return;
    }
    const updateMenuPosition = () => {
      const anchor = triggerRef.current;
      if (!anchor) return;
      // Measure only while no flyout is open: in the contained layout the
      // flyout joins the popup's flow, and feeding that back into the flip
      // decision would let opening a submenu re-place the whole menu.
      const popup = popupRef.current;
      let measured = contentHeight;
      if (popup && !submenu) {
        // `overflow: visible` means scrollHeight reports the full stack even
        // when maxHeight is already clipping it. A zero reading means "not
        // laid out yet" (jsdom never lays out), so keep the static budget.
        const next = popup.scrollHeight > 0 ? popup.scrollHeight : null;
        measured = next;
        if (next !== contentHeight) setContentHeight(next);
      }
      setMenuStyle(getPlusMenuStyle(anchor, placementPreference, measured));
      setFlyoutPlacement(getFlyoutPlacement(anchor, PLUS_MENU_FLYOUT_WIDTH));
      const activeRow = popupRef.current?.querySelector<HTMLDivElement>('.plus-menu__submenu-row.is-open') ?? null;
      updateFlyoutGeometry(activeRow);
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, submenu, placementPreference, contentHeight]);

 const needle = query.trim().toLowerCase();
 // Filter locally-installed skills by scope tab.
   // "All": every installed skill.
   // "Mine": ownerMemberId === personalMemberId.
   // "Team": workspaceId === teamWorkspaceId.
   const tabSkills =
     skillTab === 'mine' ? skills.filter((s) => s.ownerMemberId && s.ownerMemberId === personalMemberId)
     : skillTab === 'team' ? skills.filter((s) => s.workspaceId && s.workspaceId === teamWorkspaceId)
     : skills;
 const filteredSkills = needle
   ? tabSkills.filter((s) => skillMatchesQuery(s, needle))
   : tabSkills;
 // Filter locally-connected MCP servers by scope tab, same pattern as skills.
   const tabMcpServers =
     mcpTab === 'mine' ? mcpServers.filter((s) => s.ownerMemberId && s.ownerMemberId === personalMemberId)
     : mcpTab === 'team' ? mcpServers.filter((s) => s.workspaceId && s.workspaceId === teamWorkspaceId)
     : mcpServers;
 const filteredMcp = needle
   ? tabMcpServers.filter((s) => mcpMatches(s, needle))
   : tabMcpServers;
  const popupStyle = menuStyle
    ? ({
        ...menuStyle,
        '--plus-menu-flyout-max-height': `${flyoutMaxHeight}px`,
      } satisfies PlusMenuPopupStyle)
    : undefined;

  return (
    <div className="plus-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`icon-btn plus-menu__trigger od-tooltip${open ? ' is-active' : ''}`}
        data-testid={triggerTestId}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          onOpen?.();
          setOpen(true);
        }}
        title={t('homeHero.addMenu')}
        data-tooltip={t('homeHero.addMenu')}
        aria-label={t('homeHero.addMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* `od-icon` is what `.plus-menu__trigger.is-active .od-icon` keys the
            45° pivot off — the glyph reads as a close × while the menu is
            open. */}
        <Icon name="plus" size={16} className="od-icon" />
      </button>
      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={popupRef}
          className={`plus-menu__popup plus-menu__popup--flyout-${flyoutPlacement} plus-menu__popup--flyout-y-${flyoutVerticalPlacement}`}
          role="menu"
          style={popupStyle}
        >
          <button
            type="button"
            role="menuitem"
            className="plus-menu__item"
            data-testid="composer-plus-attach"
            disabled={attachLoading}
            onClick={() => {
              close();
              onAttachFiles();
            }}
          >
            <Icon
              name={attachLoading ? 'spinner' : 'attach'}
              size={15}
              className="plus-menu__item-icon"
            />
            <span>{t('chat.attachAria')}</span>
          </button>
          {onReferenceProject ? (
            <button
              type="button"
              role="menuitem"
              className="plus-menu__item"
              data-testid="composer-plus-reference-project"
              onClick={() => {
                close();
                onReferenceProject();
              }}
            >
              <Icon name="folder" size={15} className="plus-menu__item-icon" />
              <span>{t('chat.plus.referenceProject')}</span>
            </button>
          ) : null}
          {onLinkLocalCode ? (
            <button
              type="button"
              role="menuitem"
              className="plus-menu__item"
              data-testid="composer-plus-local-code"
              onClick={() => {
                close();
                onLinkLocalCode();
              }}
            >
              <Icon name="folder" size={15} className="plus-menu__item-icon" />
              <span>{t('chat.plus.linkLocalCode')}</span>
            </button>
          ) : null}
          {onPickWorkingDir ? (
            <PlusSubmenuRow
              label={t('homeWorkingDir.triggerShort')}
              icon="folder"
              open={submenu === 'workingDir'}
              testId="composer-plus-working-dir"
              onOpen={(row) => openSubmenu('workingDir', row)}
              onClose={scheduleCloseSubmenu}
            >
              <div className="plus-menu__list">
                <button
                  type="button"
                  role="menuitem"
                  className="plus-menu__item"
                  data-testid="composer-plus-working-dir-pick"
                  onClick={() => {
                    close();
                    onPickWorkingDir();
                  }}
                >
                  <Icon name="folder" size={15} className="plus-menu__item-icon" />
                  <span>{workingDir ? t('homeWorkingDir.replace') : t('homeWorkingDir.pick')}</span>
                </button>
                {(recentWorkingDirs ?? []).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    role="menuitem"
                    className="plus-menu__item"
                    title={dir}
                    onClick={() => {
                      close();
                      onSelectRecentWorkingDir?.(dir);
                    }}
                  >
                    <Icon name="history" size={15} className="plus-menu__item-icon" />
                    <span>{dirBasename(dir)}</span>
                  </button>
                ))}
                {workingDir && onClearWorkingDir ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="plus-menu__item"
                    data-testid="composer-plus-working-dir-clear"
                    onClick={() => {
                      close();
                      onClearWorkingDir();
                    }}
                  >
                    <Icon name="close" size={15} className="plus-menu__item-icon" />
                    <span>{t('homeWorkingDir.clear')}</span>
                  </button>
                ) : null}
              </div>
            </PlusSubmenuRow>
          ) : null}
          {renderToolbox ? (
            <PlusSubmenuRow
              label={toolboxLabel ?? t('chat.designToolbox.tooltip')}
              icon="lightbulb"
              open={submenu === 'toolbox'}
              onOpen={(row) => openSubmenu('toolbox', row)}
              onClose={scheduleCloseSubmenu}
            >
              {renderToolbox(close)}
            </PlusSubmenuRow>
          ) : null}
          {LIBRARY_UI_VISIBLE && onSelectFromLibrary ? (
            <button
              type="button"
              role="menuitem"
              className="plus-menu__item"
              data-testid="composer-plus-library"
              onClick={() => {
                close();
                onSelectFromLibrary();
              }}
            >
              <Icon name="layers-filled" size={15} className="plus-menu__item-icon" />
              <span>{t('chat.selectFromLibrary')}</span>
            </button>
          ) : null}
          <PlusSubmenuRow
           label={t('homeHero.selectSkill')}
           icon="sparkles"
           open={submenu === 'skills'}
           testId="composer-plus-skills"
           onOpen={(row) => openSubmenu('skills', row)}
           onClose={scheduleCloseSubmenu}
         >
            <div className="plus-menu__search">
              <Icon name="search" size={14} />
             <input
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
               placeholder={t('homeHero.skills')}
               aria-label={t('homeHero.skills')}
             />
           </div>
            <div className="plus-menu__skill-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={skillTab === 'all'}
              className={`plus-menu__skill-tab${skillTab === 'all' ? ' is-active' : ''}`}
             onClick={() => { setSkillTab('all'); onSkillTabChange?.('all'); }}
           >
             {t('homeHero.skillTabAll')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={skillTab === 'mine'}
              className={`plus-menu__skill-tab${skillTab === 'mine' ? ' is-active' : ''}`}
              onClick={() => { setSkillTab('mine'); onSkillTabChange?.('mine'); }}
            >
              {t('homeHero.skillTabMine')}
            </button>
            {showTeamTab ? (
              <button
                type="button"
               role="tab"
                aria-selected={skillTab === 'team'}
                className={`plus-menu__skill-tab${skillTab === 'team' ? ' is-active' : ''}`}
                onClick={() => { setSkillTab('team'); onSkillTabChange?.('team'); }}
              >
                {t('homeHero.skillTabTeam')}
              </button>
            ) : null}
            </div>
            <div className="plus-menu__list">
              {filteredSkills.length === 0 ? (
                <div className="plus-menu__empty">{t('homeHero.noSkills')}</div>
              ) : (
                filteredSkills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    role="menuitem"
                    className="plus-menu__item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      close();
                      onPickSkill?.(skill);
                    }}
                  >
                    <Icon name="sparkles" size={15} className="plus-menu__item-icon" />
                    <span>{localizeSkillName(locale, skill)}</span>
                  </button>
                ))
              )}
            </div>
            {onAddSkill || onManageSkills ? (
              <>
                <div className="plus-menu__divider" />
                {onAddSkill ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="plus-menu__item"
                    data-testid="composer-plus-add-skill"
                    onClick={() => {
                      close();
                      onAddSkill();
                    }}
                  >
                    <Icon name="plus" size={15} className="plus-menu__item-icon" />
                    <span>{t('homeHero.addSkill')}</span>
                  </button>
                ) : null}
                {onManageSkills ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="plus-menu__item"
                    data-testid="composer-plus-manage-skills"
                    onClick={() => {
                      close();
                      onManageSkills();
                    }}
                  >
                    <Icon name="settings" size={15} className="plus-menu__item-icon" />
                    <span>{t('homeHero.manageSkill')}</span>
                  </button>
                ) : null}
              </>
            ) : null}
          </PlusSubmenuRow>
          <PlusSubmenuRow
            label={t('homeHero.connectMcp')}
            icon="link"
            open={submenu === 'mcp'}
            testId="composer-plus-mcp"
            onOpen={(row) => openSubmenu('mcp', row)}
            onClose={scheduleCloseSubmenu}
          >
           <div className="plus-menu__search">
              <Icon name="search" size={14} />
              <input
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="MCP"
                aria-label="MCP"
              />
            </div>
            <div className="plus-menu__skill-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mcpTab === 'all'}
                className={`plus-menu__skill-tab${mcpTab === 'all' ? ' is-active' : ''}`}
                onClick={() => { setMcpTab('all'); onMcpTabChange?.('all'); }}
              >
                {t('homeHero.skillTabAll')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mcpTab === 'mine'}
                className={`plus-menu__skill-tab${mcpTab === 'mine' ? ' is-active' : ''}`}
                onClick={() => { setMcpTab('mine'); onMcpTabChange?.('mine'); }}
              >
                {t('homeHero.skillTabMine')}
              </button>
              {showTeamTab ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={mcpTab === 'team'}
                  className={`plus-menu__skill-tab${mcpTab === 'team' ? ' is-active' : ''}`}
                  onClick={() => { setMcpTab('team'); onMcpTabChange?.('team'); }}
                >
                  {t('homeHero.skillTabTeam')}
                </button>
              ) : null}
            </div>
           <div className="plus-menu__list">
              {filteredMcp.length === 0 ? (
                <div className="plus-menu__empty">{t('homeHero.noMcp')}</div>
              ) : (
                filteredMcp.map((server) => (
                  <button
                    key={server.id}
                    type="button"
                    role="menuitem"
                    className="plus-menu__item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      close();
                      onPickMcp(server);
                    }}
                  >
                    <Icon name="link" size={15} className="plus-menu__item-icon" />
                    <span>{server.label || server.id}</span>
                  </button>
                ))
              )}
            </div>
           {onAddMcp ? (
             <>
               <div className="plus-menu__divider" />
               <button
                 type="button"
                 role="menuitem"
                 className="plus-menu__item"
                 onClick={() => {
                   close();
                   onAddMcp();
                 }}
               >
              <Icon name="plus" size={15} className="plus-menu__item-icon" />
               <span>{t('personalScope.addMcp')}</span>
               </button>
             </>
           ) : null}
            {onManageMcp ? (
              <>
                {onAddMcp ? null : <div className="plus-menu__divider" />}
                <button
                  type="button"
                  role="menuitem"
                  className="plus-menu__item"
                  onClick={() => {
                    close();
                    onManageMcp();
                  }}
                >
                  <Icon name="settings" size={15} className="plus-menu__item-icon" />
                  <span>{t('homeHero.manageMcp')}</span>
                </button>
              </>
            ) : null}
           </PlusSubmenuRow>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function PlusSubmenuRow({
  label,
  icon,
  open,
  onOpen,
  onClose,
  flyoutClassName,
  testId,
  children,
}: {
  label: string;
  icon: IconName;
  open: boolean;
  onOpen: (row: HTMLDivElement | null) => void;
  onClose: () => void;
  /** Extra class on the flyout, e.g. the wide plugins-preview variant. */
  flyoutClassName?: string;
  testId?: string;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={rowRef}
      className={`plus-menu__submenu-row${open ? ' is-open' : ''}`}
      onMouseEnter={() => onOpen(rowRef.current)}
      onMouseLeave={onClose}
    >
      <button
        type="button"
        role="menuitem"
        className="plus-menu__item plus-menu__parent"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen(rowRef.current))}
      >
        <Icon name={icon} size={15} className="plus-menu__item-icon" />
        <span>{label}</span>
        <Icon name="chevron-right" size={14} className="plus-menu__chevron" />
      </button>
      {open ? (
        <div
          className={`plus-menu__flyout${flyoutClassName ? ` ${flyoutClassName}` : ''}`}
          role="menu"
          onMouseEnter={() => onOpen(rowRef.current)}
          onMouseLeave={onClose}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
