export const PROJECT_CARD_DRAG_TYPE = 'application/x-open-design-project-card';
export const PROJECT_CARD_MOVE_RESULT_EVENT = 'od:project-card-move-result';

export interface ProjectCardMoveResultDetail {
  projectId: string;
  moved: boolean;
}

export interface ProjectCardDragPayload {
  projectId: string;
  projectName: string;
  sourceWorkspaceId: string;
  sourceFolderId: string | null;
  canMove: boolean;
}

export function writeProjectCardDrag(
  dataTransfer: DataTransfer,
  payload: ProjectCardDragPayload,
): void {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(PROJECT_CARD_DRAG_TYPE, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.projectName);
}

export function hasProjectCardDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes(PROJECT_CARD_DRAG_TYPE);
}

export function readProjectCardDrag(dataTransfer: DataTransfer): ProjectCardDragPayload | null {
  try {
    const raw = dataTransfer.getData(PROJECT_CARD_DRAG_TYPE);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ProjectCardDragPayload>;
    if (
      typeof value.projectId !== 'string'
      || !value.projectId.trim()
      || typeof value.projectName !== 'string'
      || typeof value.sourceWorkspaceId !== 'string'
      || typeof value.canMove !== 'boolean'
      || (value.sourceFolderId !== null && typeof value.sourceFolderId !== 'string')
    ) {
      return null;
    }
    return {
      projectId: value.projectId,
      projectName: value.projectName,
      sourceWorkspaceId: value.sourceWorkspaceId,
      sourceFolderId: value.sourceFolderId ?? null,
      canMove: value.canMove,
    };
  } catch {
    return null;
  }
}

export function notifyProjectCardMoveResult(detail: ProjectCardMoveResultDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ProjectCardMoveResultDetail>(
    PROJECT_CARD_MOVE_RESULT_EVENT,
    { detail },
  ));
}

export function installProjectCardDragPreview(
  dataTransfer: DataTransfer,
  sourceCard: HTMLElement,
  count = 1,
): () => void {
  if (typeof document === 'undefined') return () => {};
  const sourceThumbnail = sourceCard.querySelector<HTMLElement>('.recent-projects__card-thumb');
  if (!sourceThumbnail) return () => {};

  const preview = document.createElement('div');
  preview.className = 'project-card-drag-preview';
  preview.setAttribute('aria-hidden', 'true');

  const thumbnail = sourceThumbnail.cloneNode(true) as HTMLElement;
  const sourceRect = sourceThumbnail.getBoundingClientRect();
  thumbnail.classList.add('project-card-drag-source');
  if (sourceRect.width > 0) thumbnail.style.width = `${sourceRect.width}px`;
  if (sourceRect.height > 0) thumbnail.style.height = `${sourceRect.height}px`;

  const badge = document.createElement('span');
  badge.className = 'project-card-drag-preview__count';
  badge.textContent = String(count);
  badge.setAttribute('aria-hidden', 'true');
  preview.append(thumbnail, badge);
  document.body.appendChild(preview);

  dataTransfer.setDragImage(preview, 40, 40);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    preview.remove();
  };
  const frameId = window.requestAnimationFrame(cleanup);

  return () => {
    window.cancelAnimationFrame(frameId);
    cleanup();
  };
}
