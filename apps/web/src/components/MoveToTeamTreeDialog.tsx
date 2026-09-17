// Tree-structure selector for moving projects into a team space.
//
// Replaces the old confirmation-only dialog with a recursive tree that
// lists every team workspace from the directory and lazily loads each
// team's folder hierarchy from the HDW folder API. The user can select
// the team root (workspace node) or any folder/subfolder in the tree;
// the selected { workspaceId, folderId | null } is returned on confirm.
//
// For "to-personal" moves the caller should keep using MoveToTeamConfirmDialog
// — there is no tree to pick from when leaving a team space.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import { readWorkspaceDirectoryForCurrentGeneration } from '../collab/useWorkspaceContext';
import { Icon } from './Icon';
import { Skeleton } from './Loading';
import { useT } from '../i18n';
import styles from './MoveToTeamTreeDialog.module.css';

/** A folder node in the tree (mirrors the HDW folder API shape). */
interface FolderNode {
  id: string;
  name: string;
  /** Number of direct subfolders (from `subfolder_count`); 0 means leaf. */
  subfolderCount: number;
}

/** The user's selection: which workspace (team) and optional folder. */
export interface TeamTreeSelection {
  workspaceId: string;
  workspaceName: string;
  /** null = the team workspace root; a folder id = that specific folder. */
  folderId: string | null;
  folderName: string | null;
  /** True when the selected workspace is the personal (one-person) default team. */
  isDefaultTeam?: boolean;
}

interface MoveToTeamTreeDialogProps {
  /** Called with the selected destination when the user confirms. */
  onConfirm: (selection: TeamTreeSelection) => void;
  onCancel: () => void;
  /** Pre-fetched directory items; when omitted the dialog fetches them. */
  workspaceItems?: readonly WorkspaceDirectoryItem[];
  /** When true, disables the confirm button while a move is in-flight. */
  busy?: boolean;
  /** When true, include personal (default-team) workspaces in the tree. */
  includePersonal?: boolean;
  /** The current workspace's id — always shown in the tree even when
   * includePersonal would filter it out, so the user can pick a folder
   * within the current workspace (folder-only move). */
  currentWorkspaceId?: string | null;
  /** Limit destinations to one workspace, used when moving folder trees whose
   * cross-team transfer semantics differ from project moves. */
  restrictToWorkspaceId?: string | null;
  /** Item keys that should be disabled (greyed out, not selectable).
   *  Key format: `${workspaceId}:root` for workspace roots,
   *  `${workspaceId}:${folderId}` for folders. */
  disabledKeys?: Set<string>;
  /** Dialog mode:
   *  - 'team' (default): existing behavior controlled by includePersonal.
   *  - 'personal-folders': show only the personal (default-team) workspace
   *    with its folder tree auto-expanded.
  *  - 'tabbed': show a tab bar to switch between team workspaces and the
  *    personal workspace, each with its own folder tree. */
  mode?: 'team' | 'personal-folders' | 'tabbed';
  /** When false (user is not the project owner), hide the personal-space tab
   *  in 'tabbed' mode. Admins can move to other teams but never to personal. */
 canMoveToPersonal?: boolean;
  /** When true, the dialog uses copy-to-personal wording (title, description,
   *  confirm button) instead of move wording. Does not change tree behavior. */
  copyMode?: boolean;
}

/** Fetch folders under a workspace (root when folderPid is null). */
async function fetchFolders(
  workspaceId: string,
  folderPid?: string | null,
  isDefaultTeam?: boolean,
): Promise<FolderNode[]> {
  // Personal (default-team) workspaces use the local SQLite folder API;
  // team workspaces use the HDW folder API. Both return the same shape.
  const basePath = isDefaultTeam
    ? `/api/folders?workspace_id=${encodeURIComponent(workspaceId)}`
    : `/api/hdw/api/folder/list?workspace_id=${encodeURIComponent(workspaceId)}`;
  let url = basePath;
  if (folderPid) {
    url += `&folder_pid=${encodeURIComponent(folderPid)}`;
  }
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];
  const body = await res.json();
  const list: any[] = body?.data?.folders ?? [];
  return list.map((f) => ({
    id: f.folder_id || f.id || '',
    name: f.folder_name || f.name || '',
    subfolderCount: Number(f.subfolder_count) || 0,
  }));
}

/** A single expandable folder row in the tree. Loads its children lazily. */
function FolderTreeItem({
  folder,
  depth,
  workspaceId,
  isDefaultTeam,
  selectedKey,
  onSelect,
  disabledKeys,
}: {
  folder: FolderNode;
  depth: number;
  workspaceId: string;
  isDefaultTeam?: boolean;
  selectedKey: string | null;
  onSelect: (folderId: string, folderName: string) => void;
  disabledKeys?: Set<string>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FolderNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const itemKey = `${workspaceId}:${folder.id}`;
  const isSelected = selectedKey === itemKey;
  const hasChildren = folder.subfolderCount > 0;
  const isDisabled = disabledKeys?.has(itemKey) ?? false;

  // Lazily fetch subfolders when the node is first expanded.
  useEffect(() => {
    if (!expanded || !hasChildren) return;
    if (children !== null) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const subs = await fetchFolders(workspaceId, folder.id, isDefaultTeam);
        if (!cancelled) setChildren(subs);
      } catch {
        if (!cancelled) setChildren([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [expanded, hasChildren, children, workspaceId, isDefaultTeam, folder.id]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasChildren) return;
    setExpanded((v) => !v);
  };

  const handleSelect = () => {
    if (isDisabled) return;
    onSelect(folder.id, folder.name);
  };

  return (
    <div className={styles.folderItem}>
      <div
        className={`${styles.row}${isSelected ? ` ${styles.selected}` : ''}${isDisabled ? ` ${styles.disabled}` : ''}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={isDisabled ? undefined : handleSelect}
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-disabled={isDisabled || undefined}
        onKeyDown={(e) => {
          if (isDisabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect();
          }
        }}
      >
        <button
          type="button"
          className={styles.expandBtn}
          onClick={handleToggle}
          aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}
          aria-expanded={expanded}
          tabIndex={-1}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
          ) : null}
        </button>
        <Icon name="folder-filled" size={14} className={styles.folderIcon} />
        <span className={styles.rowLabel}>{folder.name}</span>
        {isSelected ? <Icon name="check" size={14} className={styles.checkIcon} /> : null}
      </div>
      {expanded && loading ? (
        <div className={styles.childList}>
          <div className={styles.skeletonRow} style={{ paddingLeft: `${12 + (depth + 1) * 20}px` }}>
            <Skeleton width={14} height={14} radius={4} />
            <Skeleton width="50%" height={13} radius={6} />
          </div>
        </div>
      ) : expanded && children && children.length > 0 ? (
        <div className={styles.childList}>
          {children.map((child) => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              workspaceId={workspaceId}
              isDefaultTeam={isDefaultTeam}
              selectedKey={selectedKey}
              onSelect={onSelect}
              disabledKeys={disabledKeys}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A team workspace node at the top level of the tree. */
function TeamTreeItem({
  team,
  selectedKey,
  onSelect,
  autoExpand,
  disabledKeys,
}: {
  team: WorkspaceDirectoryItem;
  selectedKey: string | null;
  onSelect: (workspaceId: string, workspaceName: string, folderId: string | null, folderName: string | null, isDefaultTeam?: boolean) => void;
  autoExpand?: boolean;
  disabledKeys?: Set<string>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(autoExpand ?? false);
  const [folders, setFolders] = useState<FolderNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const itemKey = `${team.workspaceId}:root`;
  const isSelected = selectedKey === itemKey;
  const isDisabled = disabledKeys?.has(itemKey) ?? false;
  const displayName = team.isDefaultTeam
    ? t('recentProjects.personalBadge')
    : team.workspaceName;

  useEffect(() => {
    if (!expanded) return;
    if (folders !== null) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const rootFolders = await fetchFolders(team.workspaceId, undefined, team.isDefaultTeam);
        if (!cancelled) setFolders(rootFolders);
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [expanded, folders, team.workspaceId]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const handleSelect = () => {
    if (isDisabled) return;
    onSelect(team.workspaceId, displayName, null, null, team.isDefaultTeam);
  };

  return (
    <div className={styles.teamItem}>
      <div
        className={`${styles.row}${isSelected ? ` ${styles.selected}` : ''}${isDisabled ? ` ${styles.disabled}` : ''}`}
        onClick={isDisabled ? undefined : handleSelect}
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-disabled={isDisabled || undefined}
        onKeyDown={(e) => {
          if (isDisabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect();
          }
        }}
      >
        <button
          type="button"
          className={styles.expandBtn}
          onClick={handleToggle}
          aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}
          aria-expanded={expanded}
          tabIndex={-1}
        >
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
        <Icon name="folder" size={16} className={styles.teamIcon} />
        <span className={styles.rowLabel}>{displayName}</span>
        {isSelected ? <Icon name="check" size={14} className={styles.checkIcon} /> : null}
      </div>
      {expanded && loading ? (
        <div className={styles.childList}>
          <div className={styles.skeletonRow} style={{ paddingLeft: '32px' }}>
            <Skeleton width={14} height={14} radius={4} />
            <Skeleton width="50%" height={13} radius={6} />
          </div>
        </div>
      ) : expanded && folders ? (
        <div className={styles.childList}>
          {folders.length > 0 ? (
            folders.map((folder) => (
              <FolderTreeItem
                key={folder.id}
                folder={folder}
                depth={1}
                workspaceId={team.workspaceId}
                isDefaultTeam={team.isDefaultTeam}
                selectedKey={selectedKey}
                onSelect={(folderId, folderName) =>
                  onSelect(team.workspaceId, displayName, folderId, folderName, team.isDefaultTeam)
                }
                disabledKeys={disabledKeys}
              />
            ))
          ) : (
            <div className={styles.emptyHint}>{t('recentProjects.treeNoFolders')}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function MoveToTeamTreeDialog({
  onConfirm,
  onCancel,
  workspaceItems: propItems,
  busy,
  includePersonal = false,
  currentWorkspaceId,
  restrictToWorkspaceId,
  mode = 'team',
  disabledKeys,
 canMoveToPersonal = true,
  copyMode = false,
}: MoveToTeamTreeDialogProps) {
  const t = useT();
  const titleId = useId();
  const [items, setItems] = useState<readonly WorkspaceDirectoryItem[] | null>(propItems ?? null);
  const [loading, setLoading] = useState(!propItems);
  const [selected, setSelected] = useState<TeamTreeSelection | null>(null);
  const [activeTab, setActiveTab] = useState<'team' | 'personal'>('team');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch the workspace directory when items are not supplied via props.
  useEffect(() => {
    if (propItems) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const directory = await readWorkspaceDirectoryForCurrentGeneration();
        if (cancelled) return;
        let teamItems: WorkspaceDirectoryItem[];
        if (mode === 'personal-folders') {
          // Show only the personal (default-team) workspace. The personal
          // workspace has workspaceType 'personal' with isDefaultTeam true,
          // so filter by isDefaultTeam rather than workspaceType.
          teamItems = (directory.items ?? []).filter(
            (item) => item.isDefaultTeam === true,
          );
        } else if (mode === 'tabbed') {
          // Show all workspaces (personal + team) so the tab switch can
          // filter between them.
          teamItems = (directory.items ?? []).filter(
            (item) => item.workspaceType === 'team' || item.isDefaultTeam === true,
          );
        } else {
          // Default team mode: show team workspaces only. Personal
          // (default-team) is excluded so moving to a team space never
          // offers the personal workspace as a destination.
          teamItems = (directory.items ?? []).filter(
            (item) =>
              item.workspaceType === 'team' && !item.isDefaultTeam,
          );
        }
        setItems(
          restrictToWorkspaceId
            ? teamItems.filter((item) => item.workspaceId === restrictToWorkspaceId)
            : teamItems,
        );
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [propItems, includePersonal, currentWorkspaceId, mode, restrictToWorkspaceId]);

  const selectedKey = useMemo(() => {
    if (!selected) return null;
    return selected.folderId
      ? `${selected.workspaceId}:${selected.folderId}`
      : `${selected.workspaceId}:root`;
  }, [selected]);


  // In tabbed mode, filter items by the active tab.
  const displayItems = useMemo(() => {
    if (!items) return null;
    const restrictedItems = restrictToWorkspaceId
      ? items.filter((item) => item.workspaceId === restrictToWorkspaceId)
      : items;
    if (mode === 'tabbed') {
      // When canMoveToPersonal is false, never show personal-space items
      // even if the active tab somehow flips to 'personal'.
      if (!canMoveToPersonal) {
        return restrictedItems.filter((item) => !item.isDefaultTeam);
      }
      return activeTab === 'team'
        ? restrictedItems.filter((item) => !item.isDefaultTeam)
        : restrictedItems.filter((item) => item.isDefaultTeam === true);
    }
   return restrictedItems;
  }, [items, mode, activeTab, canMoveToPersonal, restrictToWorkspaceId]);

  const handleTabSwitch = useCallback((tab: 'team' | 'personal') => {
    setActiveTab(tab);
    setSelected(null);
  }, []);
  const handleSelect = useCallback(
    (workspaceId: string, workspaceName: string, folderId: string | null, folderName: string | null, isDefaultTeam?: boolean) => {
      setSelected({ workspaceId, workspaceName, folderId, folderName, isDefaultTeam });
    },
    [],
  );

 const showPersonal = includePersonal || mode === 'personal-folders' || (mode === 'tabbed' && canMoveToPersonal);
// In tabbed mode, only show the personal tab when the user is the project
// owner (canMoveToPersonal). Admins can move to other teams but not to personal.
const showPersonalTab = mode === 'tabbed' && canMoveToPersonal;

 const handleConfirm = () => {
    if (!selected || busy) return;
    onConfirm(selected);
  };

  const dialog = (
    <Dialog
      className={styles.dialog}
      onClose={onCancel}
      closeOnEscape
      ariaLabelledBy={titleId}
    >
      <DialogTitle id={titleId}>{copyMode ? t('recentProjects.copyToPersonal') : showPersonal ? t('recentProjects.moveTo') : t('recentProjects.moveToTeam')}</DialogTitle>
      <DialogDescription>{copyMode ? t('recentProjects.copyToPersonalDesc') : showPersonal ? t('recentProjects.moveTreeDesc') : t('recentProjects.moveToTeamTreeDesc')}</DialogDescription>
      {mode === 'tabbed' && showPersonalTab ? (
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab}${activeTab === 'team' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => handleTabSwitch('team')}
          >
           {t('recentProjects.teamSpaceTab')}
         </button>
          <button
            type="button"
            className={`${styles.tab}${activeTab === 'personal' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => handleTabSwitch('personal')}
          >
            {t('recentProjects.personalSpaceTab')}
          </button>
        </div>
      ) : null}
      <div className={styles.treeContainer} ref={scrollRef}>
        {loading ? (
          <div className={styles.skeletonList}>
            <div className={styles.skeletonRow}>
              <Skeleton width={16} height={16} radius={4} />
              <Skeleton width="60%" height={13} radius={6} />
            </div>
            <div className={styles.skeletonRow}>
              <Skeleton width={16} height={16} radius={4} />
              <Skeleton width="45%" height={13} radius={6} />
            </div>
            <div className={styles.skeletonRow}>
              <Skeleton width={16} height={16} radius={4} />
              <Skeleton width="55%" height={13} radius={6} />
            </div>
          </div>
        ) : displayItems && displayItems.length > 0 ? (
          <div className={styles.tree}>
            {displayItems.map((team) => (
              <TeamTreeItem
                key={team.workspaceId}
                team={team}
                selectedKey={selectedKey}
                onSelect={handleSelect}
                autoExpand={mode === 'personal-folders' || (mode === 'tabbed' && activeTab === 'personal')}
                disabledKeys={disabledKeys}
              />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>{showPersonal ? t('recentProjects.treeNoWorkspaces') : t('recentProjects.treeNoTeams')}</div>
        )}
      </div>
      <DialogFooter className={styles.footer}>
        <button type="button" onClick={onCancel} disabled={busy}>
          {t('designs.renameCancel')}
        </button>
        <button
          type="button"
          className={`primary ${styles.confirmBtn}`}
          onClick={handleConfirm}
          disabled={!selected || busy}
        >
          {copyMode ? t('recentProjects.confirmCopyToPersonal') : showPersonal ? t('recentProjects.confirmMove') : t('recentProjects.confirmMoveToTeam')}
        </button>
      </DialogFooter>
    </Dialog>
  );

  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog;
}
