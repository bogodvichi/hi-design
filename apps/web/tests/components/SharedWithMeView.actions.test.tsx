// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedWithMeView } from '../../src/components/SharedWithMeView';
import { I18nProvider } from '../../src/i18n';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  folders: [] as Array<Record<string, unknown>>,
  directoryItems: [] as Array<Record<string, unknown>>,
  unshare: vi.fn(async (_shareId: string) => {
    state.rows = [];
    return true;
  }),
  unshareFolder: vi.fn(async (_input: {
    folderId: string;
    workspaceId: string;
    recipientMemberId: string;
  }) => true),
}));

vi.mock('../../src/collab/shared-space-catalog', () => ({
  fetchSharedWithMeCatalog: vi.fn(async () => state.rows),
  unshareFromSharedSpace: state.unshare,
  unshareFolderFromSharedSpace: state.unshareFolder,
}));

vi.mock('../../src/collab/useWorkspaceContext', () => ({
  useWorkspaceContext: () => ({ context: null, loading: false, failure: null }),
}));

vi.mock('../../src/components/RecentProjectsStrip', () => ({
  RecentProjectsStrip: (props: {
    projects: Array<{ id: string }>;
    onDuplicate?: (id: string) => void;
    onRemoveSharedWithMe?: (id: string) => void;
  }) => props.projects.length > 0 ? (
    <div>
      <button type="button" onClick={() => props.onDuplicate?.(props.projects[0]!.id)}>
        trigger copy
      </button>
      <button type="button" onClick={() => props.onRemoveSharedWithMe?.(props.projects[0]!.id)}>
        trigger remove
      </button>
    </div>
  ) : null,
}));

beforeEach(() => {
  state.rows = [{
    shareId: 'share-1',
    projectId: 'project-1',
    homeWorkspaceId: 'owner-workspace',
    recipientMemberId: 'viewer-member',
    ownerMemberId: 'owner-member',
    sharedByDisplayname: 'Owner',
    displayName: 'Shared project',
    sharedAt: '2026-09-23T00:00:00.000Z',
    folderId: null,
  }];
  state.folders = [];
  state.directoryItems = [];
  state.unshare.mockClear();
  state.unshareFolder.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/workspace/directory')) {
      return new Response(JSON.stringify({ items: state.directoryItems }), { status: 200 });
    }
    if (url.includes('/api/workspace/folders/shared-with-me')) {
      return new Response(JSON.stringify({ folders: state.folders }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SharedWithMeView project actions', () => {
  it('copies using the source workspace recorded on the share', async () => {
    const onCopySharedProject = vi.fn(async () => {});
    await act(async () => {
      render(
        <I18nProvider initial="zh-CN">
          <SharedWithMeView onOpenProject={vi.fn()} onCopySharedProject={onCopySharedProject} />
        </I18nProvider>,
      );
    });

    fireEvent.click(await screen.findByRole('button', { name: 'trigger copy' }));
    await waitFor(() => {
      expect(onCopySharedProject).toHaveBeenCalledExactlyOnceWith('project-1', 'owner-workspace');
    });
  });

  it('confirms removal and deletes only the share record by shareId', async () => {
    await act(async () => {
      render(
        <I18nProvider initial="zh-CN">
          <SharedWithMeView onOpenProject={vi.fn()} onCopySharedProject={vi.fn()} />
        </I18nProvider>,
      );
    });

    fireEvent.click(await screen.findByRole('button', { name: 'trigger remove' }));

    expect(screen.getByText('删除后，该用户将不再可访问和使用')).toBeTruthy();
    expect(state.unshare).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(state.unshare).toHaveBeenCalledExactlyOnceWith('share-1');
    });
  });

  it('removes a shared folder through the recipient-only unshare path', async () => {
    state.rows = [];
    state.directoryItems = [{
      isDefaultTeam: true,
      workspaceId: 'shared-space',
      workspaceMemberId: 'viewer-member',
      workspaceType: 'team',
    }];
    state.folders = [{
      folder_id: 'folder-1',
      workspace_id: 'owner-workspace',
      folder_name: 'Shared folder',
      project_count: 1,
      subfolder_count: 0,
      subfolder_preview: [],
      created_at: '2026-09-23T00:00:00.000Z',
    }];

    await act(async () => {
      render(
        <I18nProvider initial="zh-CN">
          <SharedWithMeView onOpenProject={vi.fn()} onCopySharedProject={vi.fn()} />
        </I18nProvider>,
      );
    });

    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '从分享给我的删除' }));

    expect(screen.getByText('删除后，该用户将不再可访问和使用')).toBeTruthy();
    expect(state.unshareFolder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(state.unshareFolder).toHaveBeenCalledExactlyOnceWith({
        folderId: 'folder-1',
        workspaceId: 'owner-workspace',
        recipientMemberId: 'viewer-member',
      });
    });
  });
});
