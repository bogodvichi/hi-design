import { ModuleBreadcrumb } from './ModuleBreadcrumb';
// Folder view for the "/personal/folder/:folderId" route. Mirrors
// TeamSpaceView's FolderView + FoldersPanel but operates on the local
// SQLite folders table via `/api/folders` instead of the HDW proxy.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { navigate } from '../router';
import { Icon } from './Icon';
import { FolderCardMenu } from './FolderCardMenu';
import { FolderSelectionCheck } from './FolderSelectionCheck';
import { ShareFolderDialog } from './ShareFolderDialog';
import { RecentProjectsStrip } from './RecentProjectsStrip';
import type { DesignSystemSummary, Project } from '../types';
import { useT } from '../i18n';
import styles from './TeamSpaceView.module.css';

 const FOLDER_CONTEXT_KEY = 'od:home-folder-context';
 
 function buildDisplayPath(names: string[]): string {
   if (names.length <= 2) return names.join(' / ');
   return `${names[0]} / ... / ${names[names.length - 1]}`;
 }

interface BreadcrumbItem {
  folderId: string;
  folderName: string;
}

interface PersonalFolderItem {
  folderId: string;
  folderName: string;
  projectCount: number;
  subfolderCount: number;
  subfolderPreview: Array<{ name: string; kind: 'folder' | 'project'; projectId?: string | null }>;
  createdAt: string;
}

interface Props {
  folderId?: string;
  designSystems?: DesignSystemSummary[];
  onOpenProject?: (id: string) => void;
  onDeleteProject?: (id: string) => Promise<boolean | void> | boolean | void;
  onRenameProject?: (id: string, name: string) => void;
}

export function PersonalFolderView({
  folderId,
  designSystems = [],
  onOpenProject,
  onDeleteProject,
  onRenameProject,
}: Props) {
  const t = useT();
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceMemberId, setWorkspaceMemberId] = useState<string | null>(null);
 const [loading, setLoading] = useState(Boolean(folderId));
const [showCreateFolder, setShowCreateFolder] = useState(false);

 // Resolve the personal workspace ID from the workspace directory.
 // Resolve the personal workspace ID from the workspace directory.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/workspace/directory', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as { items?: WorkspaceDirectoryItem[] };
        if (cancelled) return;
       const personal = body.items?.find((item) => item.isDefaultTeam === true);
       setWorkspaceId(personal?.workspaceId ?? null);
       setWorkspaceMemberId(personal?.workspaceMemberId ?? null);
     } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

 // Build breadcrumb path by fetching the folder detail (which includes the
 // full path array from the recursive CTE in getFolderPath).
 useEffect(() => {
   if (!folderId || !workspaceId) { setBreadcrumb([]); return; }
   setLoading(true);
   let cancelled = false;
   void (async () => {
     try {
       const res = await fetch(
         `/api/folders/${encodeURIComponent(folderId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
         { cache: 'no-store' },
       );
       if (!res.ok) { if (!cancelled) setBreadcrumb([]); return; }
       const body = await res.json();
       if (cancelled) return;
       const path: any[] = body?.data?.path ?? [];
       setBreadcrumb(path.map((p) => ({
         folderId: p.folder_id,
         folderName: p.folder_name || '',
       })));
     } catch {
       // leave empty breadcrumb
     } finally {
       if (!cancelled) setLoading(false);
     }
   })();
   return () => { cancelled = true; };
 }, [folderId, workspaceId]);

  const currentFolderName = breadcrumb.length > 0
    ? (breadcrumb[breadcrumb.length - 1]?.folderName ?? '').trim()
    : '';
  const title = currentFolderName || t('teamSpace.folderSubtitle');

  if (loading) {
    return (
      <section className={styles.view}>
        <div className={styles.loading}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
        </div>
      </section>
    );
  }

  return (
    <section className={styles.view} aria-labelledby="personal-folder-title">
      <ModuleBreadcrumb items={[
        { key: 'root', label: t('personalFunc.all'), onNavigate: () => navigate({ kind: 'home', view: 'personal-all' }) },
        ...breadcrumb.slice(0, -1).map((item) => ({
          key: item.folderId,
          label: item.folderName,
          onNavigate: () => navigate({ kind: 'home', view: 'personal-folder', folderId: item.folderId }),
        })),
      ]} />
      <header className={`${styles.header} ${styles.secondaryHeader}`}>
        <div className={styles.titleBlock}>
          <h1 id="personal-folder-title" className={styles.title}>{title}</h1>
        </div>
    <div className={styles.headerActions}>
      <button
         type="button"
          className={styles.solidBtn}
          onClick={() => {
            const names = breadcrumb.map((b) => b.folderName).filter(Boolean);
            if (folderId && names.length > 0) {
              localStorage.setItem(FOLDER_CONTEXT_KEY, JSON.stringify({
                folderId,
                folderPath: buildDisplayPath(names),
              }));
              window.dispatchEvent(new Event('od:folder-context-changed'));
            }
            navigate({ kind: 'home', view: 'home' });
          }}
         >
           <Icon name="plus" size={16} aria-hidden />
           <span>{t('entry.navNewProject')}</span>
         </button>
          <button
            type="button"
            className={styles.outlineBtn}
            onClick={() => setShowCreateFolder(true)}
          >
            <Icon name="folder" size={16} aria-hidden />
            <span>{t('teamSpace.newSubFolder')}</span>
          </button>
        </div>
      </header>

      <div className={styles.content} role="tabpanel">
     <PersonalFoldersPanel
       workspaceId={workspaceId}
       workspaceMemberId={workspaceMemberId}
       folderId={folderId}
       showCreateFolder={showCreateFolder}
       onShowCreateFolderChange={setShowCreateFolder}
       designSystems={designSystems}
       onOpenProject={onOpenProject}
       onDeleteProject={onDeleteProject}
       onRenameProject={onRenameProject}
     />
      </div>
    </section>
  );
}

function PersonalFoldersPanel({
  workspaceId,
  workspaceMemberId,
  folderId,
  showCreateFolder,
  onShowCreateFolderChange,
  designSystems,
 onOpenProject,
 onDeleteProject,
onRenameProject,
}: {
 workspaceId: string | null;
  workspaceMemberId: string | null;
 folderId?: string;
 showCreateFolder: boolean;
 onShowCreateFolderChange: (v: boolean) => void;
 designSystems: DesignSystemSummary[];
 onOpenProject?: (id: string) => void;
 onDeleteProject?: (id: string) => Promise<boolean | void> | boolean | void;
 onRenameProject?: (id: string, name: string) => void;
}) {
 const t = useT();
 const [folders, setFolders] = useState<PersonalFolderItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
 const [loading, setLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
const [removeTarget, setRemoveTarget] = useState<PersonalFolderItem | null>(null);
const [removing, setRemoving] = useState(false);
const [folderSelectionMode, setFolderSelectionMode] = useState(false);
const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(() => new Set());
const [bulkbarEl, setBulkbarEl] = useState<HTMLDivElement | null>(null);

useEffect(() => {
  setSelectedFolderIds((current) => {
    const available = new Set(folders.map((folder) => folder.folderId));
    const next = new Set([...current].filter((id) => available.has(id)));
    return next.size === current.size ? current : next;
  });
}, [folders]);

const [shareFolderTarget, setShareFolderTarget] = useState<PersonalFolderItem | null>(null);

 const [controlsEl, setControlsEl] = useState<HTMLDivElement | null>(null);

 // Fetch subfolders whose folder_pid equals the current folderId.
  useEffect(() => {
    if (!workspaceId || !folderId) { setFolders([]); return; }
    let cancelled = false;
    const loadFolders = async () => {
      setLoading(true);
      try {
       const res = await fetch(
         `/api/folders?workspace_id=${encodeURIComponent(workspaceId)}&folder_pid=${encodeURIComponent(folderId)}`,
         {
           cache: 'no-store',
           headers: workspaceMemberId
             ? { 'x-od-workspace-member-id': workspaceMemberId }
             : undefined,
         },
       );
        if (!res.ok) { if (!cancelled) setFolders([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.folders ?? [];
        setFolders(list.map((f) => ({
          folderId: f.folder_id || f.id || '',
          folderName: f.folder_name || f.name || '',
          projectCount: Number(f.project_count) || 0,
          subfolderCount: Number(f.subfolder_count) || 0,
          subfolderPreview: Array.isArray(f.subfolder_preview)
            ? f.subfolder_preview.map((p: any) =>
                typeof p === 'string'
                  ? { name: p, kind: 'folder' as const }
                  : { name: p.name || '', kind: (p.kind === 'project' ? 'project' : 'folder') as 'folder' | 'project', projectId: p.projectId || null })
            : [],
          createdAt: f.created_at || '',
        })))
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadFolders();
    function onFoldersUpdated() {
      void loadFolders();
    }
   window.addEventListener('personal:folders-updated', onFoldersUpdated);
   return () => {
     cancelled = true;
     window.removeEventListener('personal:folders-updated', onFoldersUpdated);
   };
}, [workspaceId, folderId, workspaceMemberId]);

 // Fetch projects directly inside this folder (folder_id = folderId).
 // Refreshes alongside subfolders on the `personal:folders-updated` event.
 useEffect(() => {
   if (!workspaceId || !folderId) { setProjects([]); return; }
   let cancelled = false;
   const loadProjects = async () => {
     setProjectsLoading(true);
     try {
       const res = await fetch(
         `/api/folders/${encodeURIComponent(folderId)}/projects?workspace_id=${encodeURIComponent(workspaceId)}`,
         {
           cache: 'no-store',
           headers: workspaceMemberId
             ? { 'x-od-workspace-member-id': workspaceMemberId }
             : undefined,
         },
       );
       if (!res.ok) { if (!cancelled) setProjects([]); return; }
       const body = await res.json();
       if (cancelled) return;
       const list: any[] = body?.data?.projects ?? [];
       setProjects(list);
     } catch {
       if (!cancelled) setProjects([]);
     } finally {
       if (!cancelled) setProjectsLoading(false);
     }
   };
   void loadProjects();
   function onFoldersUpdated() {
     void loadProjects();
   }
   window.addEventListener('personal:folders-updated', onFoldersUpdated);
   return () => {
     cancelled = true;
     window.removeEventListener('personal:folders-updated', onFoldersUpdated);
   };
 }, [workspaceId, folderId, workspaceMemberId]);

 async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) { setCreateError(t('teamSpace.folderNameRequired')); return; }
    if (!workspaceId || !folderId) return;
    setCreating(true);
    setCreateError(null);
    try {
     const res = await fetch('/api/folders', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         ...(workspaceMemberId ? { 'x-od-workspace-member-id': workspaceMemberId } : {}),
       },
       body: JSON.stringify({
         workspace_id: workspaceId,
         folder_pid: folderId,
         folder_name: name,
       }),
     });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        setCreateError(body?.error || body?.msg || t('teamSpace.createFolderError'));
        return;
      }
      setNewFolderName('');
      onShowCreateFolderChange(false);
      window.dispatchEvent(new CustomEvent('personal:folders-updated'));
    } catch (err: any) {
      setCreateError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  }

  async function confirmRemoveFolder() {
    const folder = removeTarget;
    if (!folder || !workspaceId) return;
    setRemoving(true);
    setRemoveTarget(null);
    setFolders((prev) => prev.filter((f) => f.folderId !== folder.folderId));
    try {
      const res = await fetch(
        `/api/folders/${encodeURIComponent(folder.folderId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        setFolders((prev) => [...prev, folder]);
      } else {
        window.dispatchEvent(new CustomEvent('personal:folders-updated'));
      }
    } catch {
      setFolders((prev) => [...prev, folder]);
    } finally {
      setRemoving(false);
    }
  }

  async function deleteSelectedFolders(): Promise<number> {
    if (!workspaceId || selectedFolderIds.size === 0) return 0;
    const ids = [...selectedFolderIds];
    const results = await Promise.all(ids.map(async (selectedId) => {
      try {
        const res = await fetch(
          `/api/folders/${encodeURIComponent(selectedId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
          {
            method: 'DELETE',
            headers: workspaceMemberId ? { 'x-od-workspace-member-id': workspaceMemberId } : undefined,
          },
        );
        const body = await res.json().catch(() => null);
        return res.ok && body?.code === 0 ? selectedId : null;
      } catch {
        return null;
      }
    }));
    const deletedIds = new Set(results.filter((id): id is string => id !== null));
    if (deletedIds.size > 0) {
      setFolders((current) => current.filter((folder) => !deletedIds.has(folder.folderId)));
      window.dispatchEvent(new CustomEvent('personal:folders-updated'));
    }
    return deletedIds.size;
  }

  function toggleFolderSelection(folderId: string) {
    setSelectedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  async function moveSelectedFolders(
    action: 'to-team' | 'to-personal',
    options?: { targetWorkspaceId?: string; targetFolderId?: string | null },
  ): Promise<number> {
    if (
      action !== 'to-personal'
      || !workspaceId
      || options?.targetWorkspaceId !== workspaceId
      || selectedFolderIds.size === 0
    ) return 0;
    const ids = [...selectedFolderIds];
    const results = await Promise.all(ids.map(async (selectedId) => {
      try {
        const response = await fetch(
          `/api/folders/${encodeURIComponent(selectedId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...(workspaceMemberId ? { 'x-od-workspace-member-id': workspaceMemberId } : {}),
            },
            body: JSON.stringify({ folder_pid: options.targetFolderId ?? null }),
          },
        );
        const body = await response.json().catch(() => null);
        return response.ok && body?.code === 0 ? selectedId : null;
      } catch {
        return null;
      }
    }));
    const movedIds = new Set(results.filter((id): id is string => id !== null));
    if (movedIds.size > 0) {
      setFolders((current) => current.filter((folder) => !movedIds.has(folder.folderId)));
      window.dispatchEvent(new CustomEvent('personal:folders-updated'));
    }
    return movedIds.size;
  }

  function handleFolderClick(folder: PersonalFolderItem) {
    if (!workspaceId) return;
    navigate({
      kind: 'home',
      view: 'personal-folder',
      folderId: folder.folderId,
    });
  }

  return (
    <div className={styles.projectsWrap}>
      <div ref={setControlsEl} className={styles.folderControls} />
      <div ref={setBulkbarEl} className={styles.folderBulkbar} />
      {folders.length > 0 ? <div className={styles.folderList}>
        {folders.map((folder) => {
          const selected = selectedFolderIds.has(folder.folderId);
          return (
          <article
            key={folder.folderId}
            className={`${styles.folderCard}${selected ? ` ${styles.folderCardSelected}` : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={folderSelectionMode ? selected : undefined}
            onClick={() => folderSelectionMode ? toggleFolderSelection(folder.folderId) : handleFolderClick(folder)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (folderSelectionMode) toggleFolderSelection(folder.folderId);
              else handleFolderClick(folder);
            }}
            title={folder.folderName}
          >
           {folderSelectionMode ? (
             <FolderSelectionCheck selected={selected} />
           ) : (
             <FolderCardMenu
               onDelete={() => setRemoveTarget(folder)}
               deleteLabel={t('teamSpace.deleteFolder')}
               onShare={() => setShareFolderTarget(folder)}
               shareLabel={t('sharedSpace.shareFolderMenuLabel')}
             />
           )}
            <div className={styles.folderCardGrid}>
              {Array.from({ length: 4 }, (_, i) => {
                const item = folder.subfolderPreview[i];
               if (!item) {
                 return <div key={i} className={styles.gridCellEmpty} />;
               }
                if (item.kind === 'project') {
                 if (item.projectId) {
                    return (
                      <div
                        key={i}
                        className={`${styles.gridCell} ${styles.gridCellCover}`}
                        style={{ backgroundImage: `url(/api/projects/${encodeURIComponent(item.projectId)}/cover)` }}
                        title={item.name}
                      />
                    );
                  }
                  return (
                    <div key={i} className={`${styles.gridCell} ${styles.gridCellProject}`} title={item.name} />
                  );
                }
                return (
                  <div key={i} className={styles.gridCell} title={item.name}>
                    <svg viewBox="0 0 16 16" width="24" height="24" fill="none" className={styles.gridCellIcon} aria-hidden="true">
                      <path d="M1.5 1L7.11362 1C7.75952 1 8.36567 1.31193 8.74109 1.83752L11 5L0 5L0 2.5C0 1.67157 0.671573 1 1.5 1Z" fill="rgb(253,153,52)" fillRule="evenodd" />
                      <path d="M0 3L14 3C15.1046 3 16 3.89543 16 5L16 13C16 14.1046 15.1046 15 14 15L2 15C0.89543 15 0 14.1046 0 13L0 3Z" fill="rgb(255,197,15)" fillRule="evenodd" />
                    </svg>
                  </div>
                );
              })}
            </div>
            <div className={styles.folderCardInfo}>
              <div className={styles.folderCardTitle}>
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" className={styles.folderIcon} aria-hidden="true">
                  <path d="M1.5 1L7.11362 1C7.75952 1 8.36567 1.31193 8.74109 1.83752L11 5L0 5L0 2.5C0 1.67157 0.671573 1 1.5 1Z" fill="rgb(253,153,52)" fillRule="evenodd" />
                  <path d="M0 3L14 3C15.1046 3 16 3.89543 16 5L16 13C16 14.1046 15.1046 15 14 15L2 15C0.89543 15 0 14.1046 0 13L0 3Z" fill="rgb(255,197,15)" fillRule="evenodd" />
                </svg>
                <span className={styles.folderName}>{folder.folderName}</span>
              </div>
              <div className={styles.folderCardMeta}>
                <div className={styles.folderCounts}>
                  <span className={styles.folderCount}>
                    {t('teamSpace.subFolderCount', { n: folder.subfolderCount })}
                  </span>
                  <span className={styles.folderCountDot} aria-hidden="true" />
                  <span className={styles.folderCount}>
                    {t('teamSpace.projectGroupCount', { n: folder.projectCount })}
                  </span>
                </div>
              </div>
            </div>
        </article>
          );
        })}
     </div> : null}
      {/* Projects directly inside this folder (folder_id = folderId).
          Rendered below the subfolder cards so the two areas stay
          visually separate, mirroring the personal-all layout. */}
      <div className={styles.projectsSection}>
       <RecentProjectsStrip
          loading={projectsLoading}
          emptyContent={folders.length > 0 || loading ? null : undefined}
          projects={projects}
          designSystems={designSystems}
          limit={1000}
          heading={t('entry.navDrafts')}
          space="drafts"
          onOpen={(id) => onOpenProject?.(id)}
          onDelete={onDeleteProject}
         onRename={(id, name) => {
           setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name } : p));
           onRenameProject?.(id, name);
         }}
        hideTitle
         currentWorkspaceId={workspaceId}
         currentFolderId={folderId ?? null}
         controlsPortalTarget={controlsEl}
         bulkbarPortalTarget={bulkbarEl}
         selectionExtension={{
           selectedCount: selectedFolderIds.size,
           selectedLabels: folders.filter((folder) => selectedFolderIds.has(folder.folderId)).map((folder) => folder.folderName),
           onMoveSelected: moveSelectedFolders,
           moveTreeMode: 'personal-folders',
           canMoveToTeam: false,
           disabledMoveKeys: new Set([...selectedFolderIds].map((id) => `${workspaceId}:${id}`)),
           onDeleteSelected: deleteSelectedFolders,
           onModeChange: setFolderSelectionMode,
           onClear: () => setSelectedFolderIds(new Set()),
         }}
      />
     </div>
     {showCreateFolder ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => onShowCreateFolderChange(false)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <button type="button" className={styles.confirmClose} onClick={() => onShowCreateFolderChange(false)} aria-label={t('common.close')}>
                <Icon name="close" size={14} />
              </button>
              <h3 className={styles.confirmTitle}>{t('teamSpace.newSubFolder')}</h3>
              <label className={styles.createLabel}>
                {t('teamSpace.newFolderNameLabel')}
                <input
                  className={styles.createInput}
                  value={newFolderName}
                  disabled={creating}
                  placeholder={t('teamSpace.newFolderNamePlaceholder')}
                  onChange={(e) => { setNewFolderName(e.target.value); setCreateError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateFolder(); } }}
                  autoFocus
                />
              </label>
              {createError ? <p className={styles.roleError}>{createError}</p> : null}
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => onShowCreateFolderChange(false)} disabled={creating}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={styles.confirmOk} onClick={handleCreateFolder} disabled={creating}>
                  {t('teamSpace.createFolderBtn')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
      {removeTarget ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => setRemoveTarget(null)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <button type="button" className={styles.confirmClose} onClick={() => setRemoveTarget(null)} aria-label={t('common.close')}>
                <Icon name="close" size={14} />
              </button>
              <h3 className={styles.confirmTitle}>{t('teamSpace.deleteFolderConfirmTitle')}</h3>
              <p className={styles.confirmMsg}>{t('teamSpace.deleteFolderConfirmMsg')}</p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => setRemoveTarget(null)} disabled={removing}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={`${styles.confirmOk} ${styles.confirmDanger}`} onClick={confirmRemoveFolder} disabled={removing}>
                  {t('teamSpace.deleteFolder')}
                </button>
              </div>
            </div>
          </div>,
         document.body,
       )
     ) : null}
      {shareFolderTarget && workspaceId ? (
        <ShareFolderDialog
          folderId={shareFolderTarget.folderId}
          workspaceId={workspaceId}
          homeWorkspaceId={workspaceId}
          folderName={shareFolderTarget.folderName}
          onClose={() => setShareFolderTarget(null)}
          onShared={() => window.dispatchEvent(new CustomEvent('personal:folders-updated'))}
        />
      ) : null}
   </div>
 );
}
