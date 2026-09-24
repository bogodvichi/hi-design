import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { currentWorkspaceAccountGeneration, notifyTeamProjectsChanged } from '../collab/useWorkspaceContext';
import { useT } from '../i18n';
import { Toast } from './Toast';
import { movePersonalFolderRoots, type PersonalFolderMoveRoot, type PersonalFolderMoveResult } from './personal-folder-move';

type Destination = { targetWorkspaceId?: string; targetFolderId?: string | null };

/** Root and nested personal views apply exactly the same per-folder outcomes. */
export function usePersonalFolderMove<T extends PersonalFolderMoveRoot>(input: {
  workspaceId: string | null;
  workspaceMemberId: string | null;
  setFolders: Dispatch<SetStateAction<T[]>>;
  setSelectedFolderIds: Dispatch<SetStateAction<Set<string>>>;
}) {
  const t = useT();
  const [moving, setMoving] = useState(false);
  const [notice, setNotice] = useState<PersonalFolderMoveResult | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const identity = JSON.stringify([input.workspaceId, input.workspaceMemberId]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setNotice(null); }, [identity]);

  async function moveFolders(roots: T[], action: 'to-team' | 'to-personal', destination: Destination = {}): Promise<PersonalFolderMoveResult> {
    const rejected = (): PersonalFolderMoveResult => ({ succeededFolderIds: [], failures: roots.map((root) => ({ ...root, code: 'failed', completedProjectIds: [] })) });
    if (pending.current) return rejected();
    if (!input.workspaceId || !input.workspaceMemberId) {
      const result = rejected(); setNotice(result); return result;
    }
    const generation = currentWorkspaceAccountGeneration();
    const stillCurrent = () => mounted.current && identityRef.current === identity && currentWorkspaceAccountGeneration() === generation;
    pending.current = true; setMoving(true); setNotice(null);
    let result: PersonalFolderMoveResult;
    try {
      result = await movePersonalFolderRoots({
        sourceWorkspaceId: input.workspaceId, sourceWorkspaceMemberId: input.workspaceMemberId,
        roots, action, ...destination,
      });
    } catch {
      result = rejected();
    }
    if (stillCurrent()) {
      const succeeded = new Set(result.succeededFolderIds);
      input.setFolders((current) => current.filter((folder) => !succeeded.has(folder.folderId)));
      input.setSelectedFolderIds((current) => new Set([...current].filter((id) => !succeeded.has(id))));
      setNotice(result);
      // Interrupted moves can change both projections even with zero completed
      // roots. Refresh these too; last-good lists survive a refresh outage.
      window.dispatchEvent(new CustomEvent('personal:folders-updated'));
      if (action === 'to-team') {
        notifyTeamProjectsChanged();
        const targets = new Map([[destination.targetWorkspaceId, destination.targetFolderId ?? null]]);
        for (const item of result.failures) if (item.targetWorkspaceId) targets.set(item.targetWorkspaceId, item.targetParentId ?? null);
        for (const [teamId, folderId] of targets) if (teamId) {
          window.dispatchEvent(new CustomEvent('hdw:folders-updated', { detail: { teamId } }));
          window.dispatchEvent(new CustomEvent('hdw:subfolders-updated', { detail: { teamId, folderId } }));
        }
      }
    }
    pending.current = false;
    if (mounted.current) setMoving(false);
    return result;
  }

  const feedback = notice && typeof document !== 'undefined' ? createPortal(
    <Toast
      message={t('personalScope.folderMoveSummary', { succeeded: notice.succeededFolderIds.length, failed: notice.failures.length })}
      details={notice.failures.map((item) => {
        const target = `${item.targetWorkspaceName ?? item.targetWorkspaceId ?? ''}${item.targetParentId ? ` / [${item.targetParentId}]` : ''}`;
        if (item.code === 'destination-locked') return t('personalScope.folderMoveLocked', { name: item.folderName, target });
        if (item.code === 'interrupted') return t('personalScope.folderMoveInterrupted', { name: item.folderName, count: item.completedProjectIds.length, target });
        return t('personalScope.folderMoveFailed', { name: item.folderName });
      }).join('\n') || null}
      role={notice.failures.length ? 'alert' : 'status'}
      tone={notice.failures.length ? 'error' : 'success'}
      placement="top"
      ttlMs={notice.failures.length ? 0 : 4000}
      onDismiss={() => setNotice(null)}
    />,
    document.body,
  ) : null;
  return { moveFolders, moving, feedback };
}
