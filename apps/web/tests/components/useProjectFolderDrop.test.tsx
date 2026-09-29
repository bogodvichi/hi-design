// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';

import {
  installProjectCardDragPreview,
  PROJECT_CARD_MOVE_RESULT_EVENT,
  type ProjectCardMoveResultDetail,
  writeProjectCardDrag,
} from '../../src/components/project-card-drag';
import { useProjectFolderDrop } from '../../src/components/useProjectFolderDrop';

const mocks = vi.hoisted(() => ({
  moveWorkspaceProject: vi.fn(),
  notifyTeamProjectsChanged: vi.fn(),
}));

vi.mock('../../src/state/projects', () => ({
  moveWorkspaceProject: mocks.moveWorkspaceProject,
}));

vi.mock('../../src/collab/useWorkspaceContext', () => ({
  notifyTeamProjectsChanged: mocks.notifyTeamProjectsChanged,
}));

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string, values?: Record<string, unknown>) => {
    if (key === 'projectDrag.movedTo') return `已移动至「${String(values?.path ?? '')}」`;
    if (key === 'projectDrag.permissionDenied') return '移动失败，无权限';
    if (key === 'common.dismiss') return '关闭';
    return key;
  },
}));

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  const transfer = {
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as string[],
    clearData: vi.fn(),
    getData: (type: string) => values.get(type) ?? '',
    setData(type: string, value: string) {
      values.set(type, value);
      transfer.types = [...values.keys()];
    },
    setDragImage: vi.fn(),
  };
  return transfer as unknown as DataTransfer;
}

const workspaceContext = {
  workspaceId: 'workspace-1',
} as WorkspaceCollabContext;

function Harness({ canMove }: { canMove: boolean }) {
  const { activeFolderId, feedback, getFolderDropProps } = useProjectFolderDrop({
    workspaceId: 'workspace-1',
    workspaceContext,
    visibility: 'team',
  });

  return (
    <>
      <article
        data-testid="target-folder"
        data-active={activeFolderId === 'folder-2' ? 'true' : 'false'}
        {...getFolderDropProps('folder-2', '团队名称/路径/路径')}
      />
      <button
        type="button"
        data-testid="drag-source"
        onDragStart={(event) => writeProjectCardDrag(event.dataTransfer, {
          projectId: 'project-1',
          projectName: 'Project One',
          sourceWorkspaceId: 'workspace-1',
          sourceFolderId: 'folder-1',
          canMove,
        })}
      />
      {feedback}
    </>
  );
}

function CrossWorkspaceHarness({
  destinationCanMove = true,
  currentWorkspaceContext = workspaceContext,
  resolveWorkspaceContext,
}: {
  destinationCanMove?: boolean;
  currentWorkspaceContext?: WorkspaceCollabContext;
  resolveWorkspaceContext?: (workspaceId: string) => WorkspaceCollabContext | null;
}) {
  const { activeFolderId, feedback, getFolderDropProps } = useProjectFolderDrop({
    workspaceId: currentWorkspaceContext.workspaceId,
    workspaceContext: currentWorkspaceContext,
    visibility: currentWorkspaceContext.workspaceType === 'team' ? 'team' : 'personal',
    resolveWorkspaceContext,
  });
  const dropId = 'workspace:personal-workspace:root';

  return (
    <>
      <article
        data-testid="personal-root"
        data-active={activeFolderId === dropId ? 'true' : 'false'}
        {...getFolderDropProps(null, '个人', {
          workspaceId: 'personal-workspace',
          visibility: 'personal',
          canMove: destinationCanMove,
          dropId,
        })}
      />
      <button
        type="button"
        data-testid="cross-workspace-source"
        onDragStart={(event) => writeProjectCardDrag(event.dataTransfer, {
          projectId: 'project-1',
          projectName: 'Project One',
          sourceWorkspaceId: 'workspace-1',
          sourceFolderId: 'folder-1',
          canMove: true,
        })}
      />
      {feedback}
    </>
  );
}

describe('useProjectFolderDrop', () => {
  beforeEach(() => {
    mocks.moveWorkspaceProject.mockReset().mockResolvedValue(undefined);
    mocks.notifyTeamProjectsChanged.mockReset();
  });

  afterEach(() => cleanup());

  it('moves a project and shows its full destination path', async () => {
    const moveResults: ProjectCardMoveResultDetail[] = [];
    const onMoveResult = (event: Event) => {
      moveResults.push((event as CustomEvent<ProjectCardMoveResultDetail>).detail);
    };
    window.addEventListener(PROJECT_CARD_MOVE_RESULT_EVENT, onMoveResult);
    render(<Harness canMove />);
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getByTestId('drag-source'), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('target-folder'), { dataTransfer });
    expect(screen.getByTestId('target-folder')).toHaveAttribute('data-active', 'true');

    fireEvent.drop(screen.getByTestId('target-folder'), { dataTransfer });

    await waitFor(() => expect(mocks.moveWorkspaceProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      visibility: 'team',
      workspaceContext,
      targetWorkspaceId: 'workspace-1',
      targetFolderId: 'folder-2',
    }));
    const successMessage = await screen.findByText('已移动至「团队名称/路径/路径」');
    expect(successMessage).toBeInTheDocument();
    expect(successMessage.closest('.od-toast')).toHaveClass('placement-top');
    expect(mocks.notifyTeamProjectsChanged).toHaveBeenCalledTimes(1);
    expect(moveResults).toContainEqual({ projectId: 'project-1', moved: true });
    window.removeEventListener(PROJECT_CARD_MOVE_RESULT_EVENT, onMoveResult);
  });

  it('does not send a move request when the project has no permission', async () => {
    const moveResults: ProjectCardMoveResultDetail[] = [];
    const onMoveResult = (event: Event) => {
      moveResults.push((event as CustomEvent<ProjectCardMoveResultDetail>).detail);
    };
    window.addEventListener(PROJECT_CARD_MOVE_RESULT_EVENT, onMoveResult);
    render(<Harness canMove={false} />);
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getByTestId('drag-source'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('target-folder'), { dataTransfer });

    const permissionMessage = await screen.findByText('移动失败，无权限');
    expect(permissionMessage).toBeInTheDocument();
    expect(permissionMessage.closest('.od-toast')).toHaveClass('placement-top');
    expect(mocks.moveWorkspaceProject).not.toHaveBeenCalled();
    expect(moveResults).toContainEqual({ projectId: 'project-1', moved: false });
    window.removeEventListener(PROJECT_CARD_MOVE_RESULT_EVENT, onMoveResult);
  });

  it('moves a project across workspaces into a navigation root', async () => {
    render(<CrossWorkspaceHarness />);
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getByTestId('cross-workspace-source'), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('personal-root'), { dataTransfer });
    expect(screen.getByTestId('personal-root')).toHaveAttribute('data-active', 'true');

    fireEvent.drop(screen.getByTestId('personal-root'), { dataTransfer });

    await waitFor(() => expect(mocks.moveWorkspaceProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      visibility: 'personal',
      workspaceContext,
      targetWorkspaceId: 'personal-workspace',
      targetFolderId: null,
    }));
    expect(await screen.findByText('已移动至「个人」')).toBeInTheDocument();
  });

  it('uses the source workspace identity when the current workspace context is stale', async () => {
    const stalePersonalContext = {
      workspaceId: 'personal-workspace',
      workspaceType: 'personal',
    } as WorkspaceCollabContext;
    const sourceTeamContext = {
      workspaceId: 'workspace-1',
      workspaceType: 'team',
      workspaceMemberId: 'member-1',
      role: 'owner',
    } as WorkspaceCollabContext;

    render(
      <CrossWorkspaceHarness
        currentWorkspaceContext={stalePersonalContext}
        resolveWorkspaceContext={(workspaceId) => (
          workspaceId === sourceTeamContext.workspaceId ? sourceTeamContext : null
        )}
      />,
    );
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getByTestId('cross-workspace-source'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('personal-root'), { dataTransfer });

    await waitFor(() => expect(mocks.moveWorkspaceProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      visibility: 'personal',
      workspaceContext: sourceTeamContext,
      targetWorkspaceId: 'personal-workspace',
      targetFolderId: null,
    }));
    expect(await screen.findByText('已移动至「个人」')).toBeInTheDocument();
  });

  it('shows permission feedback for a read-only navigation destination', async () => {
    render(<CrossWorkspaceHarness destinationCanMove={false} />);
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getByTestId('cross-workspace-source'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('personal-root'), { dataTransfer });

    expect(await screen.findByText('移动失败，无权限')).toBeInTheDocument();
    expect(mocks.moveWorkspaceProject).not.toHaveBeenCalled();
  });

  it('builds a thumbnail drag preview with a single-item count badge', () => {
    const sourceCard = document.createElement('div');
    const thumbnail = document.createElement('div');
    thumbnail.className = 'recent-projects__card-thumb';
    sourceCard.appendChild(thumbnail);
    const dataTransfer = createDataTransfer();

    const cleanupPreview = installProjectCardDragPreview(dataTransfer, sourceCard, 1);

    const preview = document.querySelector<HTMLElement>('.project-card-drag-preview');
    expect(preview).not.toBeNull();
    expect(preview?.querySelector('.project-card-drag-source')).not.toBeNull();
    expect(preview?.querySelector('.project-card-drag-preview__count')).toHaveTextContent('1');
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(preview, 40, 40);

    cleanupPreview();
    expect(document.querySelector('.project-card-drag-preview')).toBeNull();
  });
});
