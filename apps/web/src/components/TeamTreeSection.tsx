// Team tree section for the entry navigation rail.
//
// Renders a compact tree of teams (from the workspace directory) with
// expandable folder children. Clicking a team navigates to the team-space
// page (`/team/:teamId`); clicking a folder navigates to the team-folder
// page (`/team/:teamId/folder/:folderId`). Both destination pages are empty
// placeholders for now — this component is the navigation entry point.
//
// Root-level folders are fetched from the HDW folder API
// (`GET /api/hdw/api/folder/list?workspace_id=<teamId>`) and refreshed
// when a create/delete dispatches the `hdw:folders-updated` event.

import { useState, useRef, useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { navigate } from '../router';
import { Icon } from './Icon';
import { Skeleton } from './Loading';
import { useT } from '../i18n';
import type { FolderDropProps } from './useProjectFolderDrop';
import styles from './TeamTreeSection.module.css';

/** Distinct palette for team icons — each workspace gets a deterministic pick. */
const TEAM_ICON_COLORS = [
  '#8AB4FF', '#A78BFA', '#6EE7B7', '#FCA5A5',
  '#FDBA74', '#67E8F9', '#A5B4FC', '#F9A8D4',
  '#86EFAC', '#FCD34D', '#7DD3FC', '#C4B5FD',
];
const colorCache = new Map<string, string>();
const claimedPaletteSlots = new Set<number>();

/** localStorage key for a team's expanded/collapsed state. */
const TEAM_EXPANDED_KEY = (workspaceId: string) => `open-design:team-expanded:${workspaceId}`;

function loadExpanded(workspaceId: string): boolean {
  try {
    return window.localStorage.getItem(TEAM_EXPANDED_KEY(workspaceId)) === 'true';
  } catch {
    return false;
  }
}

function saveExpanded(workspaceId: string, expanded: boolean): void {
  try {
    window.localStorage.setItem(TEAM_EXPANDED_KEY(workspaceId), expanded ? 'true' : 'false');
  } catch {
    // localStorage may be unavailable (private mode, quota) — ignore.
  }
}

function teamIconColor(workspaceId: string): string {
  const cached = colorCache.get(workspaceId);
  if (cached) return cached;
  let hash = 0;
  for (let i = 0; i < workspaceId.length; i++) {
    hash = ((hash << 5) - hash + workspaceId.charCodeAt(i)) | 0;
  }
  const absHash = Math.abs(hash);
  const paletteIndex = absHash % TEAM_ICON_COLORS.length;
  let color: string;
  if (!claimedPaletteSlots.has(paletteIndex)) {
    // Claim a curated palette slot for this workspace.
    claimedPaletteSlots.add(paletteIndex);
    color = TEAM_ICON_COLORS[paletteIndex] ?? '#8AB4FF';
  } else {
    // All palette slots are taken — generate a random HSL color
    // so every team beyond the 12th still gets a distinct shade.
    const hue = absHash % 360;
    const sat = 45 + (absHash % 15);
    const light = 68 + (absHash % 10);
    color = `hsl(${hue}, ${sat}%, ${light}%)`;
  }
  colorCache.set(workspaceId, color);
  return color;
}

/** Team avatar icon — a person silhouette in a rounded square, tinted per workspace. */
function TeamIcon({ workspaceId, className }: { workspaceId: string; className?: string }) {
  const fill = teamIconColor(workspaceId);
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M0.000205 113.868959v796.262082A113.663955 113.663955 0 0 0 113.868959 1023.999795h796.262082A114.073554 114.073554 0 0 0 1023.999795 910.131041V113.868959A114.073554 114.073554 0 0 0 910.131041 0.000205H113.868959A113.663955 113.663955 0 0 0 0.000205 113.868959z m682.598127 227.532709A170.598332 170.598332 0 1 1 512 170.598537a170.393532 170.393532 0 0 1 170.598332 170.803131z m-511.999795 455.065418c0-113.868754 227.532709-176.332729 341.401463-176.332729s341.401463 61.439975 341.401463 176.332729v56.934377H170.598537v-56.934377z"
        fill={fill}
      />
    </svg>
  );
}

/** A folder under a team workspace. */
export interface TeamFolder {
  id: string;
  name: string;
  projectCount: number;
  subfolderCount: number;
}

interface Props {
  /** Workspace directory items (teams). Falls back to a mock entry when empty. */
  workspaceItems: readonly WorkspaceDirectoryItem[];
  /** The active team id (from route or context), for highlight state. */
  activeTeamId?: string;
  /** The active folder id (from route), for highlight state. */
  activeFolderId?: string;
  /** True while the workspace directory is still being fetched. Shows a
   *  shimmer placeholder tree until the real team items arrive. */
  loading?: boolean;
  /** Called when the user clicks "新建团队" in the footer. */
  onCreateTeam?: () => void;
  onRenameTeam?: (teamId: string, newName: string) => void;
  onDeleteTeam?: (teamId: string) => void;
  activeProjectDropId?: string | null;
  getProjectDropProps?: (
    workspace: WorkspaceDirectoryItem,
    folder: TeamFolder | null,
  ) => FolderDropProps;
}

interface TeamNodeProps {
  team: WorkspaceDirectoryItem;
  activeTeamId?: string;
  activeFolderId?: string;
  onRenameTeam?: (teamId: string, newName: string) => void;
  onDeleteTeam?: (teamId: string) => void;
  activeProjectDropId?: string | null;
  getProjectDropProps?: (
    workspace: WorkspaceDirectoryItem,
    folder: TeamFolder | null,
  ) => FolderDropProps;
}

function TeamNode({
  team,
  activeTeamId,
  activeFolderId,
  onRenameTeam,
  onDeleteTeam,
  activeProjectDropId,
  getProjectDropProps,
}: TeamNodeProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(() => loadExpanded(team.workspaceId));
  // null = not yet loaded; [] = loaded, no folders; [...] = loaded, has folders.
  const [folders, setFolders] = useState<TeamFolder[] | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const isActiveTeam = activeTeamId === team.workspaceId;
  const isTeamSelected = isActiveTeam && !activeFolderId;
  const teamDropId = `workspace:${team.workspaceId}:root`;
  const teamDropProps = getProjectDropProps?.(team, null);

  // Persist expanded/collapsed state to localStorage so it survives reloads.
  useEffect(() => {
    saveExpanded(team.workspaceId, expanded);
  }, [team.workspaceId, expanded]);

  // Auto-expand the team node when the route lands on a folder inside this
  // team, so the selected folder node is visible without a manual click.
  // Navigating away does not force-collapse — the user's manual toggle is
  // preserved.
  useEffect(() => {
    if (isActiveTeam && activeFolderId) {
      setExpanded(true);
    }
  }, [isActiveTeam, activeFolderId]);

  const canManageTeam = team.role === 'owner';
  const canManageFolders = team.role === 'admin' || team.role === 'owner';
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(team.workspaceName);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
 const inputRef = useRef<HTMLInputElement>(null);

  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderEditValue, setFolderEditValue] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<TeamFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const createFolderInputRef = useRef<HTMLInputElement>(null);

 // Fetch root-level folders for this team from the HDW folder API.
  // Folders are fetched eagerly on mount so we know whether to show the
  // expand button (teams with no subfolders hide it), and re-fetched when
  // expanded to get fresh data before showing the folder list.
  const didInitialFetch = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const loadFolders = async () => {
      if (expanded) setFoldersLoading(true);
      try {
        const res = await fetch(
          `/api/hdw/api/folder/list?workspace_id=${encodeURIComponent(team.workspaceId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setFolders([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.folders ?? [];
        setFolders(list.map((f) => ({
          id: f.folder_id || f.id || '',
          name: f.folder_name || f.name || '',
          projectCount: Number(f.project_count) || 0,
          subfolderCount: Number(f.subfolder_count) || 0,
        })));
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setFoldersLoading(false);
      }
    };
    // Always fetch on mount; re-fetch on expand; skip on collapse.
    if (expanded || !didInitialFetch.current) {
      didInitialFetch.current = true;
      void loadFolders();
    }
    function onFoldersUpdated(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.teamId !== team.workspaceId) return;
      void loadFolders();
    }
    window.addEventListener('hdw:folders-updated', onFoldersUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('hdw:folders-updated', onFoldersUpdated);
    };
  }, [team.workspaceId, expanded]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
 }, [editing]);

  useEffect(() => {
    if (editingFolderId && folderInputRef.current) {
      folderInputRef.current.focus();
      folderInputRef.current.select();
    }
  }, [editingFolderId]);

  useEffect(() => {
    if (showCreateFolder && createFolderInputRef.current) {
      createFolderInputRef.current.focus();
    }
  }, [showCreateFolder]);

 const startEdit = (e: React.MouseEvent) => {
   e.stopPropagation();
    if (!canManageTeam) return;
   setEditValue(team.workspaceName);
   setEditing(true);
 };

  const commitRename = async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === team.workspaceName) {
      setEditing(false);
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch('/api/hdw/api/team/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: team.workspaceId,
          workspace_name: trimmed,
          operator_member_id: team.workspaceMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        onRenameTeam?.(team.workspaceId, trimmed);
      }
    } catch {
      // ignore — leave name unchanged
    } finally {
      setRenaming(false);
      setEditing(false);
    }
  };

  const cancelEdit = () => {
    setEditValue(team.workspaceName);
    setEditing(false);
  };

  const handleEditKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const confirmDeleteTeam = async () => {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/hdw/api/team/${team.workspaceId}?operator_member_id=${encodeURIComponent(team.workspaceMemberId)}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        onDeleteTeam?.(team.workspaceId);
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleTeamClick = () => {
    navigate({ kind: 'home', view: 'team-space', teamId: team.workspaceId });
  };

  const handleToggle = (e: ReactKeyboardEvent | React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

 const handleFolderClick = (folder: TeamFolder) => {
   navigate({
     kind: 'home',
     view: 'team-folder',
     teamId: team.workspaceId,
     folderId: folder.id,
   });
 };

 const startFolderEdit = (folder: TeamFolder, e: React.MouseEvent) => {
   e.stopPropagation();
    if (!canManageFolders) return;
   setFolderEditValue(folder.name);
   setEditingFolderId(folder.id);
 };

  const commitFolderRename = async (folder: TeamFolder) => {
    const trimmed = folderEditValue.trim();
    if (!trimmed || trimmed === folder.name) {
      setEditingFolderId(null);
      return;
    }
    setRenamingFolder(true);
    try {
      const res = await fetch('/api/hdw/api/folder/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_id: folder.id,
          folder_name: trimmed,
          workspace_id: team.workspaceId,
          operator_member_id: team.workspaceMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        setFolders((prev) =>
          prev ? prev.map((f) => (f.id === folder.id ? { ...f, name: trimmed } : f)) : prev,
        );
        window.dispatchEvent(
          new CustomEvent('hdw:folders-updated', { detail: { teamId: team.workspaceId } }),
        );
      }
    } catch {
      // ignore — leave name unchanged
    } finally {
      setRenamingFolder(false);
      setEditingFolderId(null);
    }
  };

  const cancelFolderEdit = () => {
    setFolderEditValue('');
    setEditingFolderId(null);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    try {
      const res = await fetch('/api/hdw/api/folder/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: team.workspaceId,
          folder_name: name,
          operator_member_id: team.workspaceMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        setNewFolderName('');
        setShowCreateFolder(false);
        setExpanded(true);
        window.dispatchEvent(
          new CustomEvent('hdw:folders-updated', { detail: { teamId: team.workspaceId } }),
        );
      }
    } catch {
      // ignore — user can retry
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleCreateFolderKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleCreateFolder();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setNewFolderName('');
      setShowCreateFolder(false);
    }
  };

  const confirmDeleteFolderAction = async () => {
    const folder = confirmDeleteFolder;
    if (!folder) return;
    setDeletingFolder(true);
    try {
      const res = await fetch(
        `/api/hdw/api/folder/${folder.id}?operator_member_id=${encodeURIComponent(team.workspaceMemberId)}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        setFolders((prev) => (prev ? prev.filter((f) => f.id !== folder.id) : prev));
        window.dispatchEvent(
          new CustomEvent('hdw:folders-updated', { detail: { teamId: team.workspaceId } }),
        );
      }
    } catch {
      // ignore — folder stays in the list
    } finally {
      setDeletingFolder(false);
      setConfirmDeleteFolder(null);
    }
  };

  const handleFolderEditKeyDown = (folder: TeamFolder, e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitFolderRename(folder);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelFolderEdit();
    }
  };

  return (
    <div className={styles.teamNode}>
      <div
        className={`${styles.teamRow}${isTeamSelected ? ` ${styles.isActiveRow}` : ''}${activeProjectDropId === teamDropId ? ` ${styles.projectDropTarget}` : ''}`}
        {...teamDropProps}
      >
        {editing ? (
          <div className={styles.teamLabel}>
            <TeamIcon workspaceId={team.workspaceId} className={styles.teamIcon} />
            <input
              ref={inputRef}
              className={styles.editInput}
              value={editValue}
              disabled={renaming}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={handleEditKeyDown}
            />
          </div>
        ) : (
          <>
            <div
              className={styles.teamLabel}
             onClick={handleTeamClick}
              onDoubleClick={canManageTeam ? startEdit : undefined}
             title={team.workspaceName}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleTeamClick();
                }
              }}
            >
              {(folders === null || folders.length > 0) && (
                <button
                  type="button"
                  className={styles.expandBtn}
                  onClick={handleToggle}
                  aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}
                  aria-expanded={expanded}
                  tabIndex={-1}
                >
                  <Icon
                    name={expanded ? 'chevron-down' : 'chevron-right'}
                    size={12}
                  />
                </button>
              )}
              <TeamIcon workspaceId={team.workspaceId} className={styles.teamIcon} />
              <span className={styles.teamName}>{team.workspaceName}</span>
            </div>
           <span className={styles.actions}>
              {canManageFolders ? (
               <button
                 type="button"
                 className={styles.deleteBtn}
                 onClick={(e) => { e.stopPropagation(); setShowCreateFolder(true); }}
                 aria-label="add folder"
                 tabIndex={-1}
               >
                 <Icon name="plus" size={13} />
               </button>
             ) : null}
              {canManageTeam ? (
               <button
                 type="button"
                 className={styles.deleteBtn}
                 onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                 aria-label="delete"
                 tabIndex={-1}
               >
                 <Icon name="trash" size={13} />
               </button>
             ) : null}
           </span>
          </>
        )}
      </div>
      {showCreateFolder ? (
        <div className={styles.folderList}>
          <div className={styles.folderRow}>
            <Icon name="folder-filled" size={13} className={styles.folderIcon} />
            <input
              ref={createFolderInputRef}
              className={styles.editInput}
              value={newFolderName}
              disabled={creatingFolder}
              placeholder={t('teamSpace.newFolderNamePlaceholder')}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={() => { if (!creatingFolder) { setNewFolderName(''); setShowCreateFolder(false); } }}
              onKeyDown={handleCreateFolderKeyDown}
            />
          </div>
        </div>
      ) : null}
      {expanded && foldersLoading ? (
        <div className={styles.folderList} role="group">
          <div className={styles.skeletonRow} aria-hidden>
            <span className={styles.skeletonChevron} />
            <Skeleton width={13} height={13} radius={4} />
            <Skeleton width="40%" height={13} radius={6} />
          </div>
       </div>
      ) : expanded && folders !== null && folders.length > 0 ? (
        <div className={styles.folderList} role="group">
         {folders.map((folder) => {
           const isActiveFolder =
             isActiveTeam && activeFolderId === folder.id;
           const isEditingFolder = editingFolderId === folder.id;
           const folderDropId = `workspace:${team.workspaceId}:folder:${folder.id}`;
           const folderDropProps = getProjectDropProps?.(team, folder);
           if (isEditingFolder) {
             return (
               <div
                 key={folder.id}
                 className={`${styles.folderRow}${isActiveFolder ? ` ${styles.isActive}` : ''}`}
               >
                 <Icon name="folder-filled" size={13} className={styles.folderIcon} />
                 <input
                   ref={folderInputRef}
                   className={styles.editInput}
                   value={folderEditValue}
                   disabled={renamingFolder}
                   onChange={(e) => setFolderEditValue(e.target.value)}
                   onBlur={() => void commitFolderRename(folder)}
                   onKeyDown={(e) => handleFolderEditKeyDown(folder, e)}
                 />
               </div>
             );
           }
          return (
              <div
                key={folder.id}
                className={`${styles.folderRow}${isActiveFolder ? ` ${styles.isActive}` : ''}${activeProjectDropId === folderDropId ? ` ${styles.projectDropTarget}` : ''}`}
               onClick={() => handleFolderClick(folder)}
                onDoubleClick={canManageFolders ? (e) => startFolderEdit(folder, e) : undefined}
               title={folder.name}
               role="button"
               tabIndex={0}
               {...folderDropProps}
               onKeyDown={(e) => {
                 if (e.key === 'Enter' || e.key === ' ') {
                   e.preventDefault();
                   handleFolderClick(folder);
                 }
               }}
             >
               <Icon name="folder-filled" size={13} className={styles.folderIcon} />
               <span className={styles.folderName}>{folder.name}</span>
                 {canManageFolders && folder.projectCount === 0 && folder.subfolderCount === 0 ? (
                 <span className={styles.actions}>
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteFolder(folder); }}
                      aria-label="delete"
                      tabIndex={-1}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {confirmDelete ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => setConfirmDelete(false)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <button type="button" className={styles.confirmClose} onClick={() => setConfirmDelete(false)} aria-label={t('common.close')}>
                <Icon name="close" size={14} />
              </button>
              <h3 className={styles.confirmTitle}>{t('teamSpace.deleteConfirmTitle')}</h3>
              <p className={styles.confirmMsg}>{t('teamSpace.deleteConfirmMsg')}</p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => setConfirmDelete(false)}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={styles.confirmOk} onClick={confirmDeleteTeam} disabled={deleting}>
                  {t('teamSpace.removeConfirmBtn')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
      {confirmDeleteFolder ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => setConfirmDeleteFolder(null)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <button type="button" className={styles.confirmClose} onClick={() => setConfirmDeleteFolder(null)} aria-label={t('common.close')}>
                <Icon name="close" size={14} />
              </button>
              <h3 className={styles.confirmTitle}>{t('teamSpace.deleteFolderConfirmTitle')}</h3>
               <p className={styles.confirmMsg}>{t('teamSpace.deleteFolderConfirmMsg', { name: confirmDeleteFolder.name })}</p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => setConfirmDeleteFolder(null)}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={styles.confirmOk} onClick={confirmDeleteFolderAction} disabled={deletingFolder}>
                  {t('teamSpace.deleteFolder')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
    </div>
  );
}

/** Shimmer placeholder mirroring a team row's layout (chevron gap + folder
 *  icon + name bar) while the directory is still loading. */
function SkeletonRow() {
  return (
    <div className={styles.skeletonRow} aria-hidden>
      <span className={styles.skeletonChevron} />
      <Skeleton width={16} height={16} radius={4} />
      <Skeleton width="55%" height={13} radius={6} />
    </div>
  );
}

export function TeamTreeSection({
  workspaceItems,
  activeTeamId,
  activeFolderId,
  onCreateTeam,
  onRenameTeam,
  onDeleteTeam,
  activeProjectDropId,
  getProjectDropProps,
  loading,
}: Props) {
  const t = useT();
  // Only show team workspaces in the tree.
  const teamItems = workspaceItems.filter(
    (item) => item.workspaceType === 'team' && !item.isDefaultTeam
  );
  const items = [...teamItems];
  const showSkeleton = loading && items.length === 0;

  return (
    <div className={styles.container} data-testid="team-tree-section">
      {showSkeleton ? (
        <div className={styles.tree} role="status" aria-live="polite">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : (
        items.length > 0 ? (
          <div className={styles.tree}>
            {items.map((team) => (
              <TeamNode
                key={team.workspaceId}
                team={team}
                activeTeamId={activeTeamId}
                activeFolderId={activeFolderId}
                onRenameTeam={onRenameTeam}
                onDeleteTeam={onDeleteTeam}
                activeProjectDropId={activeProjectDropId}
                getProjectDropProps={getProjectDropProps}
              />
            ))}
          </div>
        ) : null
      )}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.createTeamBtn}
          onClick={() => onCreateTeam?.()}
        >
          <Icon name="plus" size={14} />
          <span>{t('workspaceSwitcher.createTeam')}</span>
        </button>
      </div>
    </div>
  );
}
