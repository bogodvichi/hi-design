import { useCallback, useState, type DragEventHandler, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectVisibility, WorkspaceCollabContext } from '@open-design/contracts';
import { notifyTeamProjectsChanged } from '../collab/useWorkspaceContext';
import { useT } from '../i18n';
import { moveWorkspaceProject } from '../state/projects';
import { Toast } from './Toast';
import {
  hasProjectCardDrag,
  notifyProjectCardMoveResult,
  readProjectCardDrag,
} from './project-card-drag';

export interface FolderDropProps {
  onDragEnter: DragEventHandler<HTMLElement>;
  onDragOver: DragEventHandler<HTMLElement>;
  onDragLeave: DragEventHandler<HTMLElement>;
  onDrop: DragEventHandler<HTMLElement>;
}

export interface ProjectFolderDropDestination {
  workspaceId: string;
  visibility: ProjectVisibility;
  /** A workspace the current member cannot write to remains a drop target so
   * dropping can provide the existing permission-denied feedback. */
  canMove?: boolean;
  /** Distinguishes roots and identically-named folder ids across workspaces. */
  dropId?: string;
}

interface ProjectMoveNotice {
  message: string;
  tone: 'success' | 'error';
}

export function useProjectFolderDrop(input: {
  workspaceId: string | null | undefined;
  workspaceContext: WorkspaceCollabContext | null;
  visibility: ProjectVisibility;
  resolveWorkspaceContext?: (workspaceId: string) => WorkspaceCollabContext | null;
}) {
  const t = useT();
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [notice, setNotice] = useState<ProjectMoveNotice | null>(null);

  const fail = useCallback((projectId?: string) => {
    setNotice({ message: t('projectDrag.permissionDenied'), tone: 'error' });
    if (projectId) notifyProjectCardMoveResult({ projectId, moved: false });
  }, [t]);

  const getFolderDropProps = useCallback((
    folderId: string | null,
    destinationPath: string,
    destination?: ProjectFolderDropDestination,
  ): FolderDropProps => {
    const targetWorkspaceId = destination?.workspaceId ?? input.workspaceId ?? null;
    const targetVisibility = destination?.visibility ?? input.visibility;
    const dropId = destination?.dropId ?? folderId ?? `${targetWorkspaceId ?? 'unknown'}:root`;
    return {
      onDragEnter: (event) => {
        if (!hasProjectCardDrag(event.dataTransfer)) return;
        event.preventDefault();
        setActiveFolderId(dropId);
      },
      onDragOver: (event) => {
        if (!hasProjectCardDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setActiveFolderId(dropId);
      },
      onDragLeave: (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setActiveFolderId((current) => current === dropId ? null : current);
      },
      onDrop: (event) => {
        if (!hasProjectCardDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        setActiveFolderId(null);
        const payload = readProjectCardDrag(event.dataTransfer);
        const sourceWorkspaceContext = payload
          ? input.workspaceContext?.workspaceId === payload.sourceWorkspaceId
            ? input.workspaceContext
            : input.resolveWorkspaceContext?.(payload.sourceWorkspaceId) ?? null
          : null;
        if (
          !payload
          || !payload.canMove
          || destination?.canMove === false
          || !targetWorkspaceId
          || !sourceWorkspaceContext
          || (!destination && payload.sourceWorkspaceId !== input.workspaceId)
        ) {
          fail(payload?.projectId);
          return;
        }
        if (
          (payload.sourceWorkspaceId === targetWorkspaceId && payload.sourceFolderId === folderId)
          || moving
        ) return;

        setMoving(true);
        setNotice(null);
        void moveWorkspaceProject({
          projectId: payload.projectId,
          visibility: targetVisibility,
          workspaceContext: sourceWorkspaceContext,
          targetWorkspaceId,
          targetFolderId: folderId,
        }).then(() => {
          notifyProjectCardMoveResult({ projectId: payload.projectId, moved: true });
          notifyTeamProjectsChanged();
          window.dispatchEvent(new CustomEvent('personal:folders-updated'));
          window.dispatchEvent(new CustomEvent('personal:projects-refresh'));

          const affectedTeamIds = new Set<string>();
          if (sourceWorkspaceContext.workspaceType === 'team') {
            affectedTeamIds.add(payload.sourceWorkspaceId);
          }
          if (targetVisibility === 'team') affectedTeamIds.add(targetWorkspaceId);
          for (const teamId of affectedTeamIds) {
            window.dispatchEvent(new CustomEvent('hdw:folders-updated', {
              detail: { teamId },
            }));
            if (teamId === payload.sourceWorkspaceId && payload.sourceFolderId) {
              window.dispatchEvent(new CustomEvent('hdw:subfolders-updated', {
                detail: { teamId, folderId: payload.sourceFolderId },
              }));
            }
            if (teamId === targetWorkspaceId && folderId) {
              window.dispatchEvent(new CustomEvent('hdw:subfolders-updated', {
                detail: { teamId, folderId },
              }));
            }
          }
          setNotice({
            message: t('projectDrag.movedTo', { path: destinationPath }),
            tone: 'success',
          });
        }).catch(() => {
          fail(payload.projectId);
        }).finally(() => {
          setMoving(false);
        });
      },
    };
  }, [
    fail,
    input.resolveWorkspaceContext,
    input.visibility,
    input.workspaceContext,
    input.workspaceId,
    moving,
    t,
  ]);

  const feedback: ReactNode = notice && typeof document !== 'undefined'
    ? createPortal(
      <Toast
        message={notice.message}
        tone={notice.tone}
        placement="top"
        role={notice.tone === 'error' ? 'alert' : 'status'}
        ttlMs={3000}
        onDismiss={() => setNotice(null)}
      />,
      document.body,
    )
    : null;

  return { activeFolderId, feedback, getFolderDropProps, moving };
}
