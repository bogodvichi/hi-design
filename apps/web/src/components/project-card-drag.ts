import { captureHostPage, isOpenDesignHostAvailable } from '@open-design/host';

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
  /** Team manager reorganizing someone else's project: metadata-only path. */
  managerOnlyFolderMove?: boolean;
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
      managerOnlyFolderMove: value.managerOnlyFolderMove === true,
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

interface FrameCoverCapture {
  frame: HTMLIFrameElement;
  source: string;
  image: HTMLImageElement | null;
  pending?: Promise<void>;
}

const frameCoverCaptures = new WeakMap<HTMLElement, FrameCoverCapture>();

function frameSource(frame: HTMLIFrameElement): string {
  return `${frame.src}\n${frame.srcdoc}`;
}

/** Prepare real iframe pixels before dragstart, which cannot await a capture. */
export async function prepareProjectCardDragPreview(sourceCard: HTMLElement): Promise<void> {
  const thumbnail = sourceCard.querySelector<HTMLElement>('.recent-projects__card-thumb');
  const frame = thumbnail?.querySelector('iframe');
  if (!thumbnail || !frame || !isOpenDesignHostAvailable()) return;
  const source = frameSource(frame);
  const existing = frameCoverCaptures.get(thumbnail);
  if (existing?.frame === frame && existing.source === source) return existing.pending;

  const rect = thumbnail.getBoundingClientRect();
  // A clipped capture would include neighboring UI instead of the full cover.
  if (rect.width < 1 || rect.height < 1 || rect.left < 0 || rect.top < 0
    || rect.right > window.innerWidth || rect.bottom > window.innerHeight) return;

  const capture: FrameCoverCapture = { frame, source, image: null };
  frameCoverCaptures.set(thumbnail, capture);
  capture.pending = (async () => {
    try {
      const result = await captureHostPage({ clip: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      } });
      if (!result.ok || !result.dataUrl || result.w < 1 || result.h < 1) return;
      const image = new Image();
      image.src = result.dataUrl;
      await image.decode();
      if (frame.isConnected && frameSource(frame) === source) capture.image = image;
    } catch {
      // The live thumbnail remains available when capture or decoding fails.
    } finally {
      if (!capture.image && frameCoverCaptures.get(thumbnail) === capture) {
        frameCoverCaptures.delete(thumbnail);
      }
    }
  })();
  return capture.pending;
}

function createDragCountBadge(count: number): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'project-card-drag-preview__count';
  badge.textContent = String(count);
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

export function installProjectCardDragPreview(
  dataTransfer: DataTransfer,
  sourceCard: HTMLElement,
  count = 1,
): () => void {
  if (typeof document === 'undefined') return () => {};
  const sourceThumbnail = sourceCard.querySelector<HTMLElement>('.recent-projects__card-thumb');
  if (!sourceThumbnail) return () => {};

  const frame = sourceThumbnail.querySelector('iframe');
  const capture = frameCoverCaptures.get(sourceThumbnail);
  const capturedImage = frame && capture?.frame === frame && capture.source === frameSource(frame)
    ? capture.image : null;

  // Cloning an iframe creates a new, unloaded document. Preserve the live
  // cover when no decoded screenshot is ready (including browser-only mode).
  if (frame && !capturedImage) {
    const badge = createDragCountBadge(count);
    sourceThumbnail.append(badge);
    dataTransfer.setDragImage(sourceThumbnail, 24, 24);
    const cleanup = () => badge.remove();
    const frameId = window.requestAnimationFrame(cleanup);
    return () => {
      window.cancelAnimationFrame(frameId);
      cleanup();
    };
  }

  const preview = document.createElement('div');
  preview.className = 'project-card-drag-preview';
  preview.setAttribute('aria-hidden', 'true');

  const thumbnail = sourceThumbnail.cloneNode(!capturedImage) as HTMLElement;
  if (capturedImage) {
    // Reuse the decoded image so dragstart never waits for another image load.
    capturedImage.className = 'recent-projects__thumb-media';
    thumbnail.append(capturedImage);
    frameCoverCaptures.delete(sourceThumbnail);
  }
  const sourceRect = sourceThumbnail.getBoundingClientRect();
  preview.style.left = `${Math.max(0, Math.min(sourceRect.left - 16, window.innerWidth - sourceRect.width - 32))}px`;
  preview.style.top = `${Math.max(0, Math.min(sourceRect.top - 16, window.innerHeight - sourceRect.height - 32))}px`;
  thumbnail.classList.add('project-card-drag-source');
  if (sourceRect.width > 0) thumbnail.style.width = `${sourceRect.width}px`;
  if (sourceRect.height > 0) thumbnail.style.height = `${sourceRect.height}px`;

  const badge = createDragCountBadge(count);
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
