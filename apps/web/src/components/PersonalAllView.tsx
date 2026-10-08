// Scope view for the "/personal-all" route. Mirrors TeamSpaceView's layout
// (header + subtitle + type tabs + projects panel with folder cards) and
// reuses its CSS module so the surface stays visually consistent across
// scope pages. Folder CRUD operates on the local SQLite `folders` table
// via `/api/folders` instead of the HDW proxy.
import { useEffect, useId, useState } from 'react';
import { navigate } from '../router';
import { AddSkillDialog } from './AddSkillDialog';
import { AddMcpDialog } from './AddMcpDialog';
import { CloudSkillList } from './CloudSkillList';
import { CloudMcpList } from './CloudMcpList';
import { createPortal } from 'react-dom';
import type { WorkspaceCollabContext, WorkspaceDirectoryItem } from '@open-design/contracts';
import { Dialog, DialogFooter, DialogTitle } from '@open-design/components';
import { Icon } from './Icon';
import { CenteredLoader } from './Loading';
import { FolderCardMenu } from './FolderCardMenu';
import { FolderSelectionCheck } from './FolderSelectionCheck';
import { MoveToTeamTreeDialog, type TeamTreeSelection } from './MoveToTeamTreeDialog';
import { ShareFolderDialog } from './ShareFolderDialog';
import { RecentProjectsStrip } from './RecentProjectsStrip';
import { usePersonalFolderMove } from './usePersonalFolderMove';
import { useProjectFolderDrop } from './useProjectFolderDrop';
import { workspaceContextFromDirectoryItem } from '../collab/useWorkspaceContext';
import type { DesignSystemSummary, Project } from '../types';
import type { ProjectMutationSource, ProjectTitleHint } from './EntryShell';
import { projectCollectionTitleHint } from './project-collection-context';
import { useT } from '../i18n';
import styles from './TeamSpaceView.module.css';
 
const FOLDER_CONTEXT_KEY = 'od:home-folder-context';

interface PersonalFolderItem {
  folderId: string;
  folderName: string;
  projectCount: number;
  subfolderCount: number;
  subfolderPreview: Array<{ name: string; kind: 'folder' | 'project'; projectId?: string | null }>;
  createdAt: string;
}


function PersonalProjectsPanel({
  workspaceId,
  workspaceContext,
  workspaceMemberId,
  showCreateGroup,
  onShowCreateGroupChange,
  designSystems,
  onOpenProject,
  onDeleteProject,
 onDuplicateProject,
 onRenameProject,
 controlsPortalTarget,
 onCopyProject,
}: {
  workspaceId: string | null;
  workspaceContext: WorkspaceCollabContext | null;
  workspaceMemberId: string | null;
  showCreateGroup: boolean;
  onShowCreateGroupChange: (v: boolean) => void;
  designSystems: DesignSystemSummary[];
  onOpenProject: (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ) => Promise<boolean> | boolean | void;
  onDeleteProject: (id: string) => Promise<boolean | void> | boolean | void;
 onDuplicateProject?: (id: string) => Promise<void> | void;
 onRenameProject: (id: string, name: string, source?: ProjectMutationSource) => void;
 controlsPortalTarget?: HTMLElement | null;
 onCopyProject?: (
   id: string,
   options?: { targetFolderId?: string | null },
 ) => Promise<void> | void;
}) {
  const t = useT();
  const [folders, setFolders] = useState<PersonalFolderItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
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
const [moveFolderTarget, setMoveFolderTarget] = useState<PersonalFolderItem | null>(null);
const { moveFolders, moving: movingFolder, feedback: moveFeedback } = usePersonalFolderMove({
  workspaceId, workspaceMemberId, setFolders, setSelectedFolderIds,
});
const {
  activeFolderId: projectDropFolderId,
  feedback: projectDropFeedback,
  getFolderDropProps,
} = useProjectFolderDrop({ workspaceId, workspaceContext, visibility: 'personal' });

  const [renameFolderTarget, setRenameFolderTarget] = useState<PersonalFolderItem | null>(null);
  const [renameFolderInput, setRenameFolderInput] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(false);
  const renameFolderTitleId = useId();

 // Fetch root-level folders from the local SQLite folders table, and
 // refresh when a create/delete dispatches the `personal:folders-updated`
 // event.
  useEffect(() => {
    if (!workspaceId) { setFolders([]); return; }
    let cancelled = false;
   const loadFolders = async () => {
     setLoading(true);
     try {
       const res = await fetch(
         `/api/folders?workspace_id=${encodeURIComponent(workspaceId)}`,
         {
           cache: 'no-store',
           headers: workspaceMemberId
             ? { 'x-od-workspace-member-id': workspaceMemberId }
             : undefined,
         },
       );
        if (!res.ok) return; // Preserve the last-good folder list on refresh failure.
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
        // A refresh outage is not an authoritative empty folder list.
      } finally {
        if (!cancelled) setLoading(false);
      }
   };
  void loadFolders();
  function onFoldersUpdated() {
    void loadFolders();
  }
  window.addEventListener('personal:folders-updated', onFoldersUpdated);
  window.addEventListener('personal:projects-refresh', onFoldersUpdated);
  return () => {
    cancelled = true;
    window.removeEventListener('personal:folders-updated', onFoldersUpdated);
    window.removeEventListener('personal:projects-refresh', onFoldersUpdated);
  };
}, [workspaceId, workspaceMemberId]);

  // Fetch root-level projects (folder_id IS NULL) from the local SQLite
  // workspace_projects table. Refreshes alongside folders on the
  // `personal:folders-updated` event so a move/create stays in sync.
  useEffect(() => {
    if (!workspaceId) { setProjects([]); return; }
    let cancelled = false;
    const loadProjects = async () => {
      setProjectsLoading(true);
      try {
       const res = await fetch(
         `/api/folders/root/projects?workspace_id=${encodeURIComponent(workspaceId)}&personal_scope=1`,
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
  }, [workspaceId, workspaceMemberId]);

 async function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) { setCreateError(t('teamSpace.folderNameRequired')); return; }
    if (!workspaceId) return;
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
         folder_name: name,
       }),
     });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        setCreateError(body?.error || body?.msg || t('teamSpace.createGroupError'));
        return;
      }
      setNewGroupName('');
      onShowCreateGroupChange(false);
      window.dispatchEvent(new CustomEvent('personal:folders-updated'));
    } catch (err: any) {
      setCreateError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  }

  async function confirmRemoveGroup() {
    const folder = removeTarget;
    if (!folder || !workspaceId) return;
    setRemoving(true);
    setRemoveTarget(null);
    setFolders((prev) => prev.filter((f) => f.folderId !== folder.folderId));
    try {
      const res = await fetch(
        `/api/folders/${encodeURIComponent(folder.folderId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          method: 'DELETE',
          headers: workspaceMemberId ? { 'x-od-workspace-member-id': workspaceMemberId } : undefined,
        },
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
    const results = await Promise.all(ids.map(async (folderId) => {
      try {
        const res = await fetch(
          `/api/folders/${encodeURIComponent(folderId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
          {
            method: 'DELETE',
            headers: workspaceMemberId ? { 'x-od-workspace-member-id': workspaceMemberId } : undefined,
          },
        );
        const body = await res.json().catch(() => null);
        return res.ok && body?.code === 0 ? folderId : null;
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
    if (movingFolder) return;
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
    const selected = folders.filter((folder) => selectedFolderIds.has(folder.folderId));
    const result = await moveFolders(selected, action, options);
    return result.succeededFolderIds.length;
  }

  async function commitFolderMove(selection: TeamTreeSelection) {
    const target = moveFolderTarget;
    if (!target || movingFolder) return;
    const result = await moveFolders([target], selection.isDefaultTeam ? 'to-personal' : 'to-team', {
      targetWorkspaceId: selection.workspaceId, targetFolderId: selection.folderId,
    });
    if (result.succeededFolderIds.includes(target.folderId)) setMoveFolderTarget(null);
  }

function handleFolderClick(folder: PersonalFolderItem) {
  if (!workspaceId) return;
  navigate({
    kind: 'home',
    view: 'personal-folder',
    folderId: folder.folderId,
  });
}

  function startFolderRename(folder: PersonalFolderItem) {
    setRenameFolderInput(folder.folderName);
    setRenameFolderTarget(folder);
  }

  function cancelFolderRename() {
    setRenameFolderTarget(null);
    setRenameFolderInput('');
  }

  async function commitFolderRename() {
    if (!renameFolderTarget || !workspaceId) return;
    const trimmed = renameFolderInput.trim();
    if (!trimmed || trimmed === renameFolderTarget.folderName) {
      cancelFolderRename();
      return;
    }
    setRenamingFolder(true);
    try {
      const res = await fetch(
        `/api/folders/${encodeURIComponent(renameFolderTarget.folderId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(workspaceMemberId ? { 'x-od-workspace-member-id': workspaceMemberId } : {}),
          },
          body: JSON.stringify({ folder_name: trimmed }),
        },
      );
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        setFolders((prev) => prev.map((f) => f.folderId === renameFolderTarget.folderId ? { ...f, folderName: trimmed } : f));
        window.dispatchEvent(new CustomEvent('personal:folders-updated'));
      }
    } catch {
      // ignore
    } finally {
      setRenamingFolder(false);
      cancelFolderRename();
    }
  }

  if (!workspaceId) {
    return (
      <div className={styles.projectsWrap}>
        <div className={styles.folderEmpty}>
          <CenteredLoader label={t('teamSpace.loading')} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.projectsWrap}>
     <div ref={setBulkbarEl} className={styles.folderBulkbar} />
     <div className={styles.folderList}>
       {loading ? (
         <div className={styles.folderEmpty}>
           <CenteredLoader label={t('teamSpace.loading')} />
         </div>
       ) : folders.length === 0 ? (
         null
       ) : folders.map((folder) => {
         const selected = selectedFolderIds.has(folder.folderId);
         return (
          <article
            key={folder.folderId}
            className={`${styles.folderCard}${selected ? ` ${styles.folderCardSelected}` : ''}${projectDropFolderId === folder.folderId ? ` ${styles.folderCardDropActive}` : ''}`}
            {...getFolderDropProps(folder.folderId, `${t('personalFunc.all')}/${folder.folderName}`)}
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
              onRename={() => startFolderRename(folder)}
              renameLabel={t('common.rename')}
              onMove={() => setMoveFolderTarget(folder)}
              moveLabel={t('designFiles.move')}
              onDelete={() => setRemoveTarget(folder)}
              deleteLabel={t('teamSpace.deleteGroup')}
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
                  <span className={styles.folderCountDot} aria-hidden />
                  <span className={styles.folderCount}>
                    {t('teamSpace.projectGroupCount', { n: folder.projectCount })}
                  </span>
                </div>
              </div>
            </div>
         </article>
         );
       })}
     </div>
      {/* Projects at the workspace root (folder_id IS NULL). Rendered
          below the folder cards so the two areas stay visually separate. */}
     <div className={styles.projectsSection}>
       <RecentProjectsStrip
          loading={projectsLoading}
          emptyContent={folders.length > 0 || loading ? null : undefined}
         projects={projects}
         designSystems={designSystems}
         limit={1000}
         heading={t('entry.navDrafts')}
         space="drafts"
         homeWorkspaceId={workspaceId}
        onOpen={(id) => {
          const sourceProject = projects.find((project) => project.id === id);
          onOpenProject(
            id,
            undefined,
            sourceProject && workspaceContext
              ? projectCollectionTitleHint(sourceProject, workspaceContext)
              : undefined,
          );
        }}
         onDelete={onDeleteProject}
         onDuplicate={onCopyProject ?? onDuplicateProject}
        onRename={(id, name) => {
          const sourceProject = projects.find((project) => project.id === id);
          setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name } : p));
          onRenameProject?.(
            id,
            name,
            sourceProject
              ? { project: sourceProject, workspaceContext }
              : undefined,
          );
        }}
         hideTitle
          currentWorkspaceId={workspaceId}
          currentFolderId={null}
          controlsPortalTarget={controlsPortalTarget}
          bulkbarPortalTarget={bulkbarEl}
          selectionExtension={{
            selectedCount: selectedFolderIds.size,
            selectedLabels: folders.filter((folder) => selectedFolderIds.has(folder.folderId)).map((folder) => folder.folderName),
            onMoveSelected: moveSelectedFolders,
            preserveFailedMoveSelection: true,
            blocksMove: movingFolder,
            moveTreeMode: 'unified',
            canMoveToTeam: true,
            moveDialogTitle: t('designFiles.move'),
            moveTreeDescription: t('designFiles.moveLabel'),
            moveRootSelectedLabel: t('designFiles.moveLabel'),
            disabledMoveKeys: new Set([...selectedFolderIds].map((id) => `${workspaceId}:${id}`)),
            onDeleteSelected: deleteSelectedFolders,
            onModeChange: setFolderSelectionMode,
            onClear: () => setSelectedFolderIds(new Set()),
          }}
       />
      </div>
      {showCreateGroup ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => onShowCreateGroupChange(false)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <button type="button" className={styles.confirmClose} onClick={() => onShowCreateGroupChange(false)} aria-label={t('common.close')}>
                <Icon name="close" size={14} />
              </button>
              <h3 className={styles.confirmTitle}>{t('teamSpace.newSubFolder')}</h3>
              <label className={styles.createLabel}>
                {t('teamSpace.newFolderNameLabel')}
                <input
                  className={styles.createInput}
                  value={newGroupName}
                  disabled={creating}
                  placeholder={t('teamSpace.newFolderNamePlaceholder')}
                  onChange={(e) => { setNewGroupName(e.target.value); setCreateError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateGroup(); } }}
                  autoFocus
                />
              </label>
              {createError ? <p className={styles.roleError}>{createError}</p> : null}
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => onShowCreateGroupChange(false)} disabled={creating}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={styles.confirmOk} onClick={handleCreateGroup} disabled={creating}>
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
              <p className={styles.confirmMsg}>{t('personalFolders.deleteRootConfirmMsg', { name: removeTarget.folderName })}</p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => setRemoveTarget(null)}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={`${styles.confirmOk} ${styles.confirmDanger}`} onClick={confirmRemoveGroup} disabled={removing}>
                  {t('teamSpace.deleteFolder')}
                </button>
              </div>
            </div>
         </div>,
         document.body,
       )
     ) : null}
      {renameFolderTarget ? (
        <Dialog
          as="form"
          className="modal-rename"
          onClose={cancelFolderRename}
          closeOnEscape
          ariaLabelledBy={renameFolderTitleId}
          onSubmit={(e) => {
            e.preventDefault();
            void commitFolderRename();
          }}
        >
          <DialogTitle id={renameFolderTitleId}>{t('designs.renameTitle')}</DialogTitle>
          <label>
            {t('designs.renamePrompt', { name: renameFolderTarget.folderName })}
            <input
              type="text"
              value={renameFolderInput}
              autoFocus
              onChange={(e) => setRenameFolderInput(e.target.value)}
            />
          </label>
          <DialogFooter className="row">
            <button type="button" onClick={cancelFolderRename}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!renameFolderInput.trim() || renameFolderInput.trim() === renameFolderTarget.folderName || renamingFolder}
            >
              {t('designs.renameSave')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
      {moveFeedback}
      {projectDropFeedback}
      {moveFolderTarget ? (
        <MoveToTeamTreeDialog
          onConfirm={(selection) => { void commitFolderMove(selection); }}
          onCancel={() => { if (!movingFolder) setMoveFolderTarget(null); }}
          busy={movingFolder}
          mode="unified"
          currentWorkspaceId={workspaceId}
          currentFolderId={null}
          disabledSubtreeKeys={new Set([`${workspaceId}:${moveFolderTarget.folderId}`])}
          disabledKeys={new Set([
            `${workspaceId}:root`,
            `${workspaceId}:${moveFolderTarget.folderId}`,
          ])}
          canMoveToPersonal
          titleLabel={t('designFiles.move')}
          treeDescription={t('designFiles.moveLabel')}
          rootSelectedLabel={t('designFiles.moveLabel')}
        />
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

export function PersonalAllView({
  tab,
  designSystems = [],
  onOpenProject,
  onDeleteProject,
  onDuplicateProject,
  onRenameProject,
  onCopyProject,
}: {
  tab?: string;
  designSystems?: DesignSystemSummary[];
  onOpenProject: (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ) => Promise<boolean> | boolean | void;
  onDeleteProject: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicateProject?: (id: string) => Promise<void> | void;
 onRenameProject: (id: string, name: string, source?: ProjectMutationSource) => void;
  onCopyProject?: (id: string) => Promise<void> | void;
}) {
const t = useT();
type ScopeTab = 'projects' | 'skill' | 'mcp';
const TABS: { id: ScopeTab; icon: string; labelKey: string }[] = [
  { id: 'projects', icon: 'folder', labelKey: 'personalScope.tabProjects' },
  { id: 'skill', icon: 'sparkles', labelKey: 'personalScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'personalScope.tabMcp' },
];
const routeTab = tab === 'skill' || tab === 'mcp' ? tab : 'projects';
const [activeTab, setActiveTab] = useState<ScopeTab>(routeTab);

// Keep the local tab in sync with the URL when the browser back/forward
// (or an external deep link) changes the route.
useEffect(() => {
  setActiveTab(routeTab);
}, [routeTab]);
const [skillDialogOpen, setSkillDialogOpen] = useState(false);
const [mcpDialogOpen, setMcpDialogOpen] = useState(false);

const [workspaceId, setWorkspaceId] = useState<string | null>(null);
const [workspaceMemberId, setWorkspaceMemberId] = useState<string | null>(null);
const [workspaceContext, setWorkspaceContext] = useState<WorkspaceCollabContext | null>(null);
const [workspaceType, setWorkspaceType] = useState<string | null>(null);
const [showCreateGroup, setShowCreateGroup] = useState(false);
 const [typeTabsEl, setTypeTabsEl] = useState<HTMLDivElement | null>(null);

 // Resolve the personal workspace ID from the workspace directory.
 // item with isDefaultTeam === true.
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
      setWorkspaceContext(personal ? workspaceContextFromDirectoryItem(personal) : null);
      setWorkspaceType(personal?.workspaceType ?? null);
    } catch {
       // leave workspaceId null
     }
   })();
   return () => { cancelled = true; };
 }, []);

 const title = t('personalFunc.all');
 const subtitle = t('personalScope.subtitlePersonal');

 return (
   <section className={styles.view} aria-labelledby="personal-all-title">
     <header className={styles.header}>
       <div className={styles.titleBlock}>
         <h1 id="personal-all-title" className={styles.title}>{title}</h1>
         <span className={styles.subtitle}>
           <span className={styles.dot} aria-hidden />
           {subtitle}
         </span>
       </div>
       <div className={styles.headerActions}>
          {activeTab === 'projects' && workspaceId ? (
            <>
              <button
               type="button"
                className={styles.solidBtn}
                onClick={() => {
                  localStorage.removeItem(FOLDER_CONTEXT_KEY);
                  window.dispatchEvent(new Event('od:folder-context-changed'));
                  navigate({ kind: 'home', view: 'home' });
                }}
              >
                <Icon name="plus" size={16} aria-hidden />
                <span>{t('entry.navNewProject')}</span>
              </button>
              <button
                type="button"
                className={styles.outlineBtn}
                onClick={() => setShowCreateGroup(true)}
              >
                <Icon name="folder" size={16} aria-hidden />
                <span>{t('teamSpace.newSubFolder')}</span>
              </button>
            </>
          ) : null}
          {activeTab === 'skill' ? (
            <button
              type="button"
              className={styles.outlineBtn}
              onClick={() => setSkillDialogOpen(true)}
            >
              <Icon name="sparkles" size={16} aria-hidden />
              <span>{t('personalScope.addSkill')}</span>
            </button>
          ) : null}
          {activeTab === 'mcp' ? (
           <button
             type="button"
             className={styles.outlineBtn}
           onClick={() => setMcpDialogOpen(true)}
           >
              <Icon name="terminal" size={16} aria-hidden />
              <span>{t('personalScope.addMcp')}</span>
            </button>
          ) : null}

        </div>
      </header>

     <div ref={setTypeTabsEl} className={styles.typeTabs} role="tablist">
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
          { kind: 'home', view: 'personal-all', tab: tab.id === 'projects' ? undefined : tab.id },
          { replace: true },
        );
      }}
         >
           <Icon name={tab.icon as any} size={16} aria-hidden />
           <span>{t(tab.labelKey as any)}</span>
         </button>
       ))}
     </div>

     <div className={styles.content} role="tabpanel">
       {activeTab === 'projects' ? (
         <PersonalProjectsPanel
           controlsPortalTarget={typeTabsEl}
           workspaceId={workspaceId}
           workspaceContext={workspaceContext}
           workspaceMemberId={workspaceMemberId}
           showCreateGroup={showCreateGroup}
           onShowCreateGroupChange={setShowCreateGroup}
           designSystems={designSystems}
           onOpenProject={onOpenProject}
           onDeleteProject={onDeleteProject}
           onDuplicateProject={onDuplicateProject}
           onCopyProject={onCopyProject}
           onRenameProject={onRenameProject}
         />
) : activeTab === 'skill' ? (
 <CloudSkillList workspaceId={workspaceId} workspaceMemberId={workspaceMemberId} workspaceType={workspaceType} />
) : (
         <CloudMcpList workspaceId={workspaceId} workspaceMemberId={workspaceMemberId} workspaceType={workspaceType} />
       )}
      </div>

     {activeTab === 'skill' ? (
       <AddSkillDialog open={skillDialogOpen} onClose={() => setSkillDialogOpen(false)} />
     ) : null}
     {activeTab === 'mcp' ? (
       <AddMcpDialog open={mcpDialogOpen} onClose={() => setMcpDialogOpen(false)} />
     ) : null}
    </section>
 );
}
