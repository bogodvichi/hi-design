import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { Dialog, DialogFooter, DialogTitle } from '@open-design/components';
import { readWorkspaceDirectoryForCurrentGeneration } from '../collab/useWorkspaceContext';
import { Icon } from './Icon';
import { Skeleton } from './Loading';
import { useT } from '../i18n';
// Keep the dialog chrome component-scoped so unified and legacy trees cannot
// leak layout rules into each other.
import styles from './MoveToTeamTreeDialog.module.css';

interface FolderNode {
  id: string;
  name: string;
  subfolderCount: number;
  parentId?: string | null;
}

interface LocationSearchResult {
  key: string;
  kind: 'folder' | 'project';
  label: string;
  locationLabel: string;
  workspace: WorkspaceDirectoryItem;
  folder: FolderNode | null;
  branchFolder: FolderNode | null;
  expandedFolderIds: readonly string[];
}

interface ActiveBranch {
  workspace: WorkspaceDirectoryItem;
  folder: FolderNode | null;
  expandedFolderIds?: readonly string[];
}

export interface TeamTreeSelection {
  workspaceId: string;
  workspaceName: string;
  folderId: string | null;
  folderName: string | null;
  isDefaultTeam?: boolean;
}

type MoveTreeMode = 'team' | 'personal-folders' | 'tabbed' | 'unified';

interface MoveToTeamTreeDialogProps {
  onConfirm: (selection: TeamTreeSelection) => void;
  onCancel: () => void;
  workspaceItems?: readonly WorkspaceDirectoryItem[];
  busy?: boolean;
  includePersonal?: boolean;
  currentWorkspaceId?: string | null;
  currentFolderId?: string | null;
  restrictToWorkspaceId?: string | null;
  disabledKeys?: Set<string>;
  mode?: MoveTreeMode;
  canMoveToPersonal?: boolean;
  copyMode?: boolean;
}

async function fetchFolders(workspaceId: string, folderPid?: string | null, isDefaultTeam?: boolean): Promise<FolderNode[]> {
  const basePath = isDefaultTeam
    ? `/api/folders?workspace_id=${encodeURIComponent(workspaceId)}`
    : `/api/hdw/api/folder/list?workspace_id=${encodeURIComponent(workspaceId)}`;
  const url = folderPid ? `${basePath}&folder_pid=${encodeURIComponent(folderPid)}` : basePath;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return [];
  const body = await response.json();
  const list: any[] = body?.data?.folders ?? [];
  return list.map((folder) => ({
    id: folder.folder_id || folder.id || '',
    name: folder.folder_name || folder.name || '',
    subfolderCount: Number(folder.subfolder_count) || 0,
    parentId: folderPid ?? null,
  }));
}

async function fetchFolderIndex(workspace: WorkspaceDirectoryItem): Promise<FolderNode[]> {
  const result: FolderNode[] = [];
  const pending: Array<string | null> = [null];
  while (pending.length > 0) {
    const parentId = pending.shift() ?? null;
    const children = await fetchFolders(workspace.workspaceId, parentId, workspace.isDefaultTeam);
    for (const child of children) {
      result.push(child);
      if (child.subfolderCount > 0) pending.push(child.id);
    }
  }
  return result;
}

async function fetchProjectsAtLocation(workspace: WorkspaceDirectoryItem, folderId: string | null): Promise<Array<{ id: string; name: string }>> {
  const personal = workspace.isDefaultTeam === true;
  const url = personal
    ? `/api/folders/${encodeURIComponent(folderId ?? 'root')}/projects?workspace_id=${encodeURIComponent(workspace.workspaceId)}`
    : `/api/workspace/projects/team?folder_id=${encodeURIComponent(folderId ?? 'root')}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: personal
      ? { 'x-od-workspace-member-id': workspace.workspaceMemberId }
      : { 'x-od-workspace-id': workspace.workspaceId },
  });
  if (!response.ok) return [];
  const body = await response.json();
  const projects: any[] = personal ? body?.data?.projects ?? [] : body?.projects ?? [];
  return projects.map((project) => ({
    id: String(project.projectId || project.id || ''),
    name: String(project.name || project.title || project.metadata?.name || ''),
  })).filter((project) => project.id && project.name);
}

async function createFolder(workspace: WorkspaceDirectoryItem, parentId: string | null, folderName: string): Promise<FolderNode> {
  const personal = workspace.isDefaultTeam === true;
  const response = await fetch(personal ? '/api/folders' : '/api/hdw/api/folder/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(personal && workspace.workspaceMemberId ? { 'x-od-workspace-member-id': workspace.workspaceMemberId } : {}),
    },
    body: JSON.stringify({
      workspace_id: workspace.workspaceId,
      folder_name: folderName,
      folder_pid: parentId,
      ...(!personal ? { operator_member_id: workspace.workspaceMemberId } : {}),
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.code !== 0) throw new Error(body?.error || body?.msg || 'Could not create folder');
  const folderId = body?.data?.folder_id || body?.data?.id;
  if (!folderId) throw new Error('Folder response did not include an id');
  window.dispatchEvent(new CustomEvent(personal ? 'personal:folders-updated' : 'hdw:folders-updated', {
    detail: personal ? undefined : { teamId: workspace.workspaceId },
  }));
  return { id: String(folderId), name: folderName, subfolderCount: 0, parentId };
}

function canCreateFolders(workspace: WorkspaceDirectoryItem): boolean {
  return workspace.isDefaultTeam === true || workspace.role === 'owner' || workspace.role === 'admin';
}

function InlineFolderCreator({ depth, icon = 'folder', onCreate, onCancel }: {
  depth: number;
  icon?: 'folder' | 'folder-project' | null;
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => inputRef.current?.focus(), []);

  const commit = async () => {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onCreate(name);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div className={styles.createRow} style={{ paddingLeft: `${38 + depth * 18}px` }}>
      {icon ? <Icon name={icon} size={16} className={styles.folderIcon} /> : null}
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        placeholder={t('teamSpace.newFolderNamePlaceholder')}
        aria-invalid={failed || undefined}
        onChange={(event) => { setValue(event.target.value); setFailed(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void commit(); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
        }}
        onBlur={() => { if (!busy && !value.trim()) onCancel(); }}
      />
      <button type="button" aria-label={t('designs.renameSave')} onMouseDown={(event) => event.preventDefault()} onClick={() => void commit()} disabled={!value.trim() || busy}>
        <Icon name="check" size={13} />
      </button>
      <button type="button" aria-label={t('common.cancel')} onMouseDown={(event) => event.preventDefault()} onClick={onCancel} disabled={busy}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

function FolderTreeItem({ folder, depth, workspace, selectedKey, onSelect, disabledKeys, initialExpanded = false, expandedFolderIds, showEmpty = false }: {
  folder: FolderNode;
  depth: number;
  workspace: WorkspaceDirectoryItem;
  selectedKey: string | null;
  onSelect: (folder: FolderNode) => void;
  disabledKeys?: Set<string>;
  initialExpanded?: boolean;
  expandedFolderIds?: ReadonlySet<string>;
  showEmpty?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(initialExpanded);
  const [children, setChildren] = useState<FolderNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [knownChildCount, setKnownChildCount] = useState(folder.subfolderCount);
  const itemKey = `${workspace.workspaceId}:${folder.id}`;
  const isSelected = selectedKey === itemKey;
  const showSelected = isSelected && !creating;
  const isDisabled = disabledKeys?.has(itemKey) ?? false;
  const hasChildren = knownChildCount > 0;
  const allowCreate = canCreateFolders(workspace);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchFolders(workspace.workspaceId, folder.id, workspace.isDefaultTeam);
      setChildren(next);
      setKnownChildCount(next.length);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [folder.id, workspace.isDefaultTeam, workspace.workspaceId]);

  useEffect(() => { if (expanded && children === null) void loadChildren(); }, [children, expanded, loadChildren]);
  useEffect(() => {
    if (expandedFolderIds?.has(folder.id)) setExpanded(true);
  }, [expandedFolderIds, folder.id]);

  const handleCreate = async (name: string) => {
    const child = await createFolder(workspace, folder.id, name);
    setChildren((current) => [...(current ?? []), child]);
    setKnownChildCount((count) => count + 1);
    setExpanded(true);
    setCreating(false);
    onSelect(child);
  };

  return (
    <div className={styles.folderItem}>
      <div
        className={`${styles.row}${showSelected ? ` ${styles.selected}` : ''}${isDisabled ? ` ${styles.disabled}` : ''}`}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        onClick={isDisabled ? undefined : () => onSelect(folder)}
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        onKeyDown={(event) => {
          if (!isDisabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(folder); }
        }}
      >
        <button
          type="button"
          className={styles.expandBtn}
          onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}
          aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}
          aria-expanded={expanded}
          disabled={!hasChildren}
          tabIndex={-1}
        >
          {hasChildren ? <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} /> : null}
        </button>
        <Icon name={folder.parentId == null ? 'folder-project' : 'folder'} size={16} className={styles.folderIcon} />
        <span className={styles.rowLabel}>{folder.name}</span>
        {allowCreate ? (
          <button
            type="button"
            className={styles.addFolderBtn}
            aria-label={t('settings.projectLocationsAddFolder')}
            onClick={(event) => { event.stopPropagation(); setExpanded(true); setCreating(true); }}
          >
            <Icon name="plus" size={13} />
          </button>
        ) : null}
      </div>
      {creating ? <InlineFolderCreator depth={depth + 1} onCreate={handleCreate} onCancel={() => setCreating(false)} /> : null}
      {expanded && loading ? (
        <div className={styles.skeletonRow} style={{ paddingLeft: `${12 + (depth + 1) * 18}px` }}>
          <Skeleton width={14} height={14} radius={4} /><Skeleton width="50%" height={13} radius={6} />
        </div>
      ) : expanded && children?.length ? (
        <div className={styles.childList}>
          {children.map((child) => (
            <FolderTreeItem key={child.id} folder={child} depth={depth + 1} workspace={workspace} selectedKey={selectedKey} onSelect={onSelect} disabledKeys={disabledKeys} expandedFolderIds={expandedFolderIds} />
          ))}
        </div>
      ) : expanded && showEmpty ? <div className={styles.emptyHint}>{t('recentProjects.treeNoFolders')}</div> : null}
    </div>
  );
}

function UnifiedLocationPane({ workspaces, selectedKey, activeBranch, currentWorkspaceId, onSelectRoot, onSelectFolder, onBranchChange, disabledKeys }: {
  workspaces: readonly WorkspaceDirectoryItem[];
  selectedKey: string | null;
  activeBranch: ActiveBranch | null;
  currentWorkspaceId?: string | null;
  onSelectRoot: (workspace: WorkspaceDirectoryItem) => void;
  onSelectFolder: (workspace: WorkspaceDirectoryItem, folder: FolderNode) => void;
  onBranchChange: (workspace: WorkspaceDirectoryItem, folder: FolderNode | null, expandedFolderIds?: readonly string[]) => void;
  disabledKeys?: Set<string>;
}) {
  const t = useT();
  const [foldersByWorkspace, setFoldersByWorkspace] = useState<Record<string, FolderNode[]>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set(currentWorkspaceId ? [currentWorkspaceId] : []));
  const [creatingRootId, setCreatingRootId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedSearchKinds, setExpandedSearchKinds] = useState<Set<LocationSearchResult['kind']>>(() => new Set());
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadRootFolders = useCallback(async (workspace: WorkspaceDirectoryItem) => {
    setLoadingKeys((current) => new Set(current).add(workspace.workspaceId));
    try {
      const folders = await fetchFolders(workspace.workspaceId, null, workspace.isDefaultTeam);
      setFoldersByWorkspace((current) => ({ ...current, [workspace.workspaceId]: folders }));
    } finally {
      setLoadingKeys((current) => { const next = new Set(current); next.delete(workspace.workspaceId); return next; });
    }
  }, []);

  useEffect(() => { for (const workspace of workspaces) void loadRootFolders(workspace); }, [loadRootFolders, workspaces]);
  useEffect(() => {
    if (currentWorkspaceId) setExpandedKeys(new Set([currentWorkspaceId]));
  }, [currentWorkspaceId]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!searchAreaRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const handleCreateRoot = async (workspace: WorkspaceDirectoryItem, name: string) => {
    const folder = await createFolder(workspace, null, name);
    setFoldersByWorkspace((current) => ({ ...current, [workspace.workspaceId]: [...(current[workspace.workspaceId] ?? []), folder] }));
    setCreatingRootId(null);
    setExpandedKeys((current) => new Set(current).add(workspace.workspaceId));
    onSelectFolder(workspace, folder);
  };

  useEffect(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void Promise.all(workspaces.map(async (workspace) => {
        const folders = await fetchFolderIndex(workspace);
        const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
        const folderPath = (folder: FolderNode | null): FolderNode[] => {
          const path: FolderNode[] = [];
          const visited = new Set<string>();
          let current = folder;
          while (current && !visited.has(current.id)) {
            visited.add(current.id);
            path.unshift(current);
            current = current.parentId ? foldersById.get(current.parentId) ?? null : null;
          }
          return path;
        };
        const folderMatches: LocationSearchResult[] = folders
          .filter((folder) => folder.name.toLocaleLowerCase().includes(normalizedQuery))
          .map((folder) => {
            const path = folderPath(folder);
            return {
              key: `folder:${workspace.workspaceId}:${folder.id}`,
              kind: 'folder' as const,
              label: folder.name,
              locationLabel: workspace.isDefaultTeam ? t('personalFunc.all') : workspace.workspaceName,
              workspace,
              folder,
              branchFolder: path[0] ?? folder,
              expandedFolderIds: path.slice(0, -1).map((item) => item.id),
            };
          });
        const locations = [null, ...folders.map((folder) => folder.id)];
        const projectLists = await Promise.all(locations.map((folderId) => fetchProjectsAtLocation(workspace, folderId)));
        const projectMatches: LocationSearchResult[] = [];
        projectLists.forEach((projects, index) => {
          const folderId = locations[index];
          const folder = folderId ? foldersById.get(folderId) ?? null : null;
          const path = folderPath(folder);
          for (const project of projects) {
            if (!project.name.toLocaleLowerCase().includes(normalizedQuery)) continue;
            projectMatches.push({
              key: `project:${workspace.workspaceId}:${project.id}`,
              kind: 'project',
              label: project.name,
              locationLabel: folder?.name ?? (workspace.isDefaultTeam ? t('personalFunc.all') : workspace.workspaceName),
              workspace,
              folder,
              branchFolder: path[0] ?? null,
              expandedFolderIds: path.slice(0, -1).map((item) => item.id),
            });
          }
        });
        return [...folderMatches, ...projectMatches];
      })).then((groups) => {
        if (!cancelled) setSearchResults(groups.flat());
      }).finally(() => {
        if (!cancelled) setSearching(false);
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, t, workspaces]);

  const revealSearchResult = (result: LocationSearchResult) => {
    setExpandedKeys((current) => new Set(current).add(result.workspace.workspaceId));
    if (result.folder) {
      onBranchChange(result.workspace, result.branchFolder ?? result.folder, result.expandedFolderIds);
      onSelectFolder(result.workspace, result.folder);
    } else {
      onBranchChange(result.workspace, null);
      onSelectRoot(result.workspace);
    }
    setSearchOpen(false);
  };

  const folderSearchResults = searchResults.filter((result) => result.kind === 'folder');
  const projectSearchResults = searchResults.filter((result) => result.kind === 'project');
  const renderSearchGroup = (kind: LocationSearchResult['kind'], results: LocationSearchResult[]) => {
    const expanded = expandedSearchKinds.has(kind);
    const visibleResults = expanded ? results : results.slice(0, 5);
    return (
      <section className={styles.searchGroup}>
        <div className={styles.searchGroupTitle}>
          {kind === 'folder' ? t('recentProjects.moveSearchFolders') : t('recentProjects.moveSearchProjects')}
        </div>
        {visibleResults.length ? visibleResults.map((result) => (
          <button key={result.key} type="button" className={styles.searchResult} onClick={() => revealSearchResult(result)}>
            <span>{result.label}</span>
            <small>{kind === 'project' ? `${t('recentProjects.moveSearchProjectIn')} ${result.locationLabel}` : result.locationLabel}</small>
          </button>
        )) : (
          <div className={styles.searchGroupEmpty}>{t('recentProjects.moveSearchGroupEmpty')}</div>
        )}
        {results.length > 5 ? (
          <button
            type="button"
            className={styles.searchMore}
            onClick={() => setExpandedSearchKinds((current) => {
              const next = new Set(current);
              if (next.has(kind)) next.delete(kind);
              else next.add(kind);
              return next;
            })}
          >
            {expanded ? t('recentProjects.moveSearchCollapse') : t('recentProjects.moveSearchMore')}
          </button>
        ) : null}
      </section>
    );
  };

  return (
    <div className={styles.locationTree}>
      <div ref={searchAreaRef} className={styles.searchArea}>
        <label className={styles.searchBox}>
          <Icon name="search" size={14} />
          <input
            ref={searchInputRef}
            value={query}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setExpandedSearchKinds(new Set()); }}
            placeholder={t('recentProjects.moveSearchPlaceholder')}
            aria-label={t('recentProjects.moveSearchPlaceholder')}
          />
          {query ? (
            <button
              type="button"
              className={styles.searchClear}
              aria-label={t('common.clear')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { setQuery(''); setSearchResults([]); setExpandedSearchKinds(new Set()); searchInputRef.current?.focus(); }}
            >
              <Icon name="close" size={11} />
            </button>
          ) : null}
        </label>
        {searchOpen && query.trim() ? (
          <div className={styles.searchPanel}>
            {searching ? (
              <div className={styles.searchStatus}>{t('common.loading')}</div>
            ) : searchResults.length ? (
              <div className={styles.searchResults}>
                {renderSearchGroup('folder', folderSearchResults)}
                {renderSearchGroup('project', projectSearchResults)}
              </div>
            ) : (
              <div className={styles.searchStatus}>{t('recentProjects.moveSearchEmpty')}</div>
            )}
          </div>
        ) : null}
      </div>
      {workspaces.map((workspace) => {
        const rootKey = `${workspace.workspaceId}:root`;
        const expanded = expandedKeys.has(workspace.workspaceId);
        const rootFolders = foldersByWorkspace[workspace.workspaceId];
        const rootDisabled = disabledKeys?.has(rootKey) ?? false;
        const rootSelected = selectedKey === rootKey;
        const label = workspace.isDefaultTeam ? t('personalFunc.all') : workspace.workspaceName;
        return (
          <div key={workspace.workspaceId} className={styles.teamItem}>
            <div
              className={`${styles.row} ${styles.rootRow}${rootSelected && creatingRootId !== workspace.workspaceId ? ` ${styles.selected}` : ''}${rootDisabled ? ` ${styles.disabled}` : ''}`}
              data-can-create={canCreateFolders(workspace)}
              onClick={rootDisabled ? undefined : () => onSelectRoot(workspace)}
              role="button"
              tabIndex={rootDisabled ? -1 : 0}
              onKeyDown={(event) => {
                if (!rootDisabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectRoot(workspace); }
              }}
            >
              <button
                type="button"
                className={styles.expandBtn}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedKeys((current) => { const next = new Set(current); if (next.has(workspace.workspaceId)) next.delete(workspace.workspaceId); else next.add(workspace.workspaceId); return next; });
                }}
                aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}
                aria-expanded={expanded}
                tabIndex={-1}
              >
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
              <span className={styles.rootLabelGroup}>
                <span className={styles.rowLabel}>{label}</span>
                <span className={`${styles.rootTypeBadge} recent-projects__card-badge recent-projects__card-badge--${workspace.isDefaultTeam ? 'personal' : 'team'} recent-projects__card-badge--inline`}>
                  <Icon name={workspace.isDefaultTeam ? 'lock' : 'users'} size={11} />
                  {workspace.isDefaultTeam ? t('recentProjects.personalBadge') : t('recentProjects.teamBadge')}
                </span>
              </span>
              {canCreateFolders(workspace) ? (
                <button
                  type="button"
                  className={styles.addFolderBtn}
                  aria-label={t('settings.projectLocationsAddFolder')}
                  onClick={(event) => { event.stopPropagation(); setExpandedKeys((current) => new Set(current).add(workspace.workspaceId)); setCreatingRootId(workspace.workspaceId); }}
                >
                  <Icon name="plus" size={13} />
                </button>
              ) : null}
            </div>
            {creatingRootId === workspace.workspaceId ? (
              <InlineFolderCreator depth={0} icon={null} onCreate={(name) => handleCreateRoot(workspace, name)} onCancel={() => setCreatingRootId(null)} />
            ) : null}
            {expanded && loadingKeys.has(workspace.workspaceId) ? (
              <div className={styles.skeletonRow} style={{ paddingLeft: '42px' }}><Skeleton width={14} height={14} radius={4} /><Skeleton width="48%" height={13} radius={6} /></div>
            ) : expanded && rootFolders?.length ? rootFolders.map((folder) => {
              const key = `${workspace.workspaceId}:${folder.id}`;
              const disabled = disabledKeys?.has(key) ?? false;
              const selected = selectedKey === key;
              const active = activeBranch?.workspace.workspaceId === workspace.workspaceId && activeBranch.folder?.id === folder.id;
              return (
                <div key={folder.id} className={styles.levelTwoItem}>
                  <div
                    className={`${styles.row} ${styles.levelTwoRow}${selected ? ` ${styles.selected}` : ''}${active && !selected ? ` ${styles.activeBranch}` : ''}${disabled ? ` ${styles.disabled}` : ''}`}
                    onClick={() => { onBranchChange(workspace, folder); if (!disabled) onSelectFolder(workspace, folder); }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className={styles.rowLabel}>{folder.name}</span>
                  </div>
                </div>
              );
            }) : expanded && rootFolders && creatingRootId !== workspace.workspaceId ? (
              <div className={styles.rootEmpty}>{t('recentProjects.treeNoFolders')}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function LegacyWorkspaceTree({ workspace, selectedKey, onSelectRoot, onSelectFolder, disabledKeys }: {
  workspace: WorkspaceDirectoryItem;
  selectedKey: string | null;
  onSelectRoot: (workspace: WorkspaceDirectoryItem) => void;
  onSelectFolder: (workspace: WorkspaceDirectoryItem, folder: FolderNode) => void;
  disabledKeys?: Set<string>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const [folders, setFolders] = useState<FolderNode[] | null>(null);
  const rootKey = `${workspace.workspaceId}:root`;
  const rootDisabled = disabledKeys?.has(rootKey) ?? false;
  useEffect(() => { void fetchFolders(workspace.workspaceId, null, workspace.isDefaultTeam).then(setFolders); }, [workspace.isDefaultTeam, workspace.workspaceId]);
  return (
    <div className={styles.teamItem}>
      <div className={`${styles.row}${selectedKey === rootKey ? ` ${styles.selected}` : ''}${rootDisabled ? ` ${styles.disabled}` : ''}`} onClick={rootDisabled ? undefined : () => onSelectRoot(workspace)} role="button" tabIndex={rootDisabled ? -1 : 0}>
        <button type="button" className={styles.expandBtn} onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} aria-expanded={expanded} aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}>
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
        <Icon name="folder" size={16} className={styles.teamIcon} />
        <span className={styles.rowLabel}>{workspace.isDefaultTeam ? t('personalFunc.all') : workspace.workspaceName}</span>
      </div>
      {expanded && folders === null ? (
        <div className={styles.skeletonRow}><Skeleton width={14} height={14} radius={4} /><Skeleton width="50%" height={13} radius={6} /></div>
      ) : expanded ? folders?.map((folder) => (
        <FolderTreeItem key={folder.id} folder={folder} depth={1} workspace={workspace} selectedKey={selectedKey} onSelect={(node) => onSelectFolder(workspace, node)} disabledKeys={disabledKeys} />
      )) : null}
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
  currentFolderId,
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
  const [activeBranch, setActiveBranch] = useState<ActiveBranch | null>(null);
  const initializedLocationRef = useRef(false);

  useEffect(() => {
    if (propItems) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const directory = await readWorkspaceDirectoryForCurrentGeneration();
        if (cancelled) return;
        let next = (directory.items ?? []).filter((item) => !item.isSharedSpace);
        if (mode === 'personal-folders') next = next.filter((item) => item.isDefaultTeam === true);
        else if (mode === 'team') next = next.filter((item) => item.workspaceType === 'team' && !item.isDefaultTeam);
        else next = next.filter((item) => item.workspaceType === 'team' || item.isDefaultTeam === true);
        if (!canMoveToPersonal) next = next.filter((item) => !item.isDefaultTeam);
        if (restrictToWorkspaceId) next = next.filter((item) => item.workspaceId === restrictToWorkspaceId);
        setItems(next);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [canMoveToPersonal, includePersonal, currentWorkspaceId, mode, propItems, restrictToWorkspaceId]);

  useEffect(() => {
    if (initializedLocationRef.current || mode !== 'unified' || !currentWorkspaceId || !items?.length) return;
    const workspace = items.find((item) => item.workspaceId === currentWorkspaceId);
    if (!workspace) return;
    initializedLocationRef.current = true;
    if (!currentFolderId) {
      setSelected({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.isDefaultTeam ? t('personalFunc.all') : workspace.workspaceName,
        folderId: null,
        folderName: null,
        isDefaultTeam: workspace.isDefaultTeam,
      });
      setActiveBranch({ workspace, folder: null });
      return;
    }
    let cancelled = false;
    void fetchFolderIndex(workspace).then((folders) => {
      if (cancelled) return;
      const folder = folders.find((item) => item.id === currentFolderId);
      if (!folder) return;
      setSelected({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.isDefaultTeam ? t('personalFunc.all') : workspace.workspaceName,
        folderId: folder.id,
        folderName: folder.name,
        isDefaultTeam: workspace.isDefaultTeam,
      });
      const foldersById = new Map(folders.map((item) => [item.id, item]));
      const path: FolderNode[] = [];
      const visited = new Set<string>();
      let pathItem: FolderNode | null = folder;
      while (pathItem && !visited.has(pathItem.id)) {
        visited.add(pathItem.id);
        path.unshift(pathItem);
        pathItem = pathItem.parentId ? foldersById.get(pathItem.parentId) ?? null : null;
      }
      setActiveBranch({
        workspace,
        folder: path[0] ?? folder,
        expandedFolderIds: path.slice(0, -1).map((item) => item.id),
      });
    });
    return () => { cancelled = true; };
  }, [currentFolderId, currentWorkspaceId, items, mode, t]);

  const selectedKey = useMemo(() => selected ? `${selected.workspaceId}:${selected.folderId ?? 'root'}` : null, [selected]);
  const selectRoot = useCallback((workspace: WorkspaceDirectoryItem) => {
    setSelected({ workspaceId: workspace.workspaceId, workspaceName: workspace.isDefaultTeam ? t('personalFunc.all') : workspace.workspaceName, folderId: null, folderName: null, isDefaultTeam: workspace.isDefaultTeam });
    setActiveBranch({ workspace, folder: null });
  }, [t]);
  const selectFolder = useCallback((workspace: WorkspaceDirectoryItem, folder: FolderNode) => {
    setSelected({ workspaceId: workspace.workspaceId, workspaceName: workspace.isDefaultTeam ? t('personalFunc.all') : workspace.workspaceName, folderId: folder.id, folderName: folder.name, isDefaultTeam: workspace.isDefaultTeam });
  }, [t]);
  const showUnifiedLayout = mode === 'unified';
  const visibleItems = items ?? [];
  const activeExpandedFolderIds = useMemo(
    () => new Set(activeBranch?.expandedFolderIds ?? []),
    [activeBranch?.expandedFolderIds],
  );
  const handleConfirm = () => {
    if (!selected || disabledKeys?.has(selectedKey ?? '') || busy) return;
    onConfirm(selected);
  };

  const dialog = (
    <Dialog className={`${styles.dialog}${showUnifiedLayout ? ` ${styles.dialogWide}` : ''}`} onClose={onCancel} closeOnEscape ariaLabelledBy={titleId}>
      <DialogTitle id={titleId}>{copyMode ? t('recentProjects.copyToPersonal') : showUnifiedLayout ? t('recentProjects.moveTo') : (includePersonal || mode !== 'team') ? t('recentProjects.moveTo') : t('recentProjects.moveToTeam')}</DialogTitle>
      {loading ? (
        <div className={styles.skeletonList}>
          <div className={styles.skeletonRow}><Skeleton width={16} height={16} radius={4} /><Skeleton width="60%" height={13} radius={6} /></div>
          <div className={styles.skeletonRow}><Skeleton width={16} height={16} radius={4} /><Skeleton width="45%" height={13} radius={6} /></div>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className={styles.emptyState}>{t('recentProjects.treeNoWorkspaces')}</div>
      ) : showUnifiedLayout ? (
        <div className={styles.splitTree}>
          <div className={styles.leftPane}>
            <UnifiedLocationPane workspaces={visibleItems} selectedKey={selectedKey} activeBranch={activeBranch} currentWorkspaceId={currentWorkspaceId} onSelectRoot={selectRoot} onSelectFolder={selectFolder} onBranchChange={(workspace, folder, expandedFolderIds) => setActiveBranch({ workspace, folder, expandedFolderIds })} disabledKeys={disabledKeys} />
          </div>
          <div className={styles.rightPane}>
            {!activeBranch?.folder ? (
              <div className={styles.paneEmpty}>
                {selected?.folderId === null && activeBranch?.workspace.workspaceId === selected.workspaceId
                  ? t('recentProjects.moveTreeRootSelected')
                  : t('recentProjects.moveTreeDesc')}
              </div>
            ) : (
              <div className={styles.deepTree}>
                <FolderTreeItem
                  key={`${activeBranch.workspace.workspaceId}:${activeBranch.folder.id}`}
                  folder={activeBranch.folder}
                  depth={0}
                  workspace={activeBranch.workspace}
                  selectedKey={selectedKey}
                  onSelect={(node) => selectFolder(activeBranch.workspace, node)}
                  disabledKeys={disabledKeys}
                  initialExpanded
                  expandedFolderIds={activeExpandedFolderIds}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.treeContainer}>
          <div className={styles.tree}>
            {visibleItems.map((workspace) => <LegacyWorkspaceTree key={workspace.workspaceId} workspace={workspace} selectedKey={selectedKey} onSelectRoot={selectRoot} onSelectFolder={selectFolder} disabledKeys={disabledKeys} />)}
          </div>
        </div>
      )}
      <DialogFooter className={styles.footer}>
        <button type="button" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button type="button" className={`primary ${styles.confirmBtn}`} onClick={handleConfirm} disabled={!selected || busy || disabledKeys?.has(selectedKey ?? '')}>
          {copyMode ? t('recentProjects.confirmCopyToPersonal') : t('recentProjects.confirmMove')}
        </button>
      </DialogFooter>
    </Dialog>
  );
  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog;
}
