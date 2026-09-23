// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { PublishDialog } from '../../src/components/PublishDialog';

const { uploadSkillToCloudMock, importFolderProjectMock } = vi.hoisted(() => ({
  uploadSkillToCloudMock: vi.fn(),
  importFolderProjectMock: vi.fn(),
}));

vi.mock('../../src/providers/registry', () => ({
  openFolderDialog: vi.fn(),
  uploadSkillToCloud: uploadSkillToCloudMock,
}));

vi.mock('../../src/state/projects', () => ({
  importFolderProject: importFolderProjectMock,
}));

vi.mock('../../src/collab/useWorkspaceContext', () => ({
  workspaceContextFromDirectoryItem: (item: any) => ({
    workspaceId: item.workspaceId,
    workspaceType: item.workspaceType,
    workspaceMemberId: item.workspaceMemberId,
    role: item.role ?? 'owner',
    memberStatus: item.memberStatus ?? 'active',
    lifecycleState: item.lifecycleState ?? 'active',
    permissions: {},
  }),
  useWorkspaceContext: () => ({
    context: {
      workspaceId: 'workspace-1',
      workspaceType: 'team',
      workspaceMemberId: 'member-1',
      role: 'owner',
      memberStatus: 'active',
      lifecycleState: 'active',
      permissions: {},
    },
    loading: false,
  }),
}));

vi.mock('../../src/collab/workspace-identity', () => ({
  workspaceProjectHeaders: () => ({
    'x-od-workspace-id': 'workspace-1',
    'x-od-workspace-member-id': 'member-1',
    'x-od-workspace-type': 'team',
  }),
}));

vi.mock('../../src/utils/platform', () => ({
  isMacPlatform: () => false,
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PublishDialog Skill category', () => {
  beforeEach(() => {
    uploadSkillToCloudMock.mockReset();
    uploadSkillToCloudMock.mockResolvedValue({ ok: true, title: 'my-skill' });
    importFolderProjectMock.mockReset();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/workspace/directory') {
        return jsonResponse({
          items: [{
            workspaceId: 'workspace-1',
            workspaceName: 'Personal',
            workspaceType: 'team',
            workspaceMemberId: 'member-1',
            isDefaultTeam: true,
            isSharedSpace: false,
            memberStatus: 'active',
            lifecycleState: 'active',
          }],
        });
      }
      if (url === '/api/workspaces/workspace-1/projects?view=all') {
        return jsonResponse({ projects: [] });
      }
      if (url === '/api/workspace/skills/cloud?owner_member_id=member-1') {
        return jsonResponse({ skills: [] });
      }
      return jsonResponse({ exists: false });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requires a category and sends the canonical category with community publishing', async () => {
    const onPublish = vi.fn();
    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog
          initialCategory="skill"
          onClose={() => {}}
          onPublish={onPublish}
        />
      </I18nProvider>,
    );

    const publishButton = screen.getByRole('button', { name: '确认发布' });
    await waitFor(() => expect(screen.getByRole('button', { name: /个人所有/ })).toBeTruthy());
    expect(screen.getByRole('searchbox', { name: '搜索 Skill' })).toBeTruthy();
    expect(publishButton).toBeDisabled();
    expect(screen.getByRole('radio', { name: '开发工具' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '构建' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '导入本地 Skill' }));
    expect(screen.getByRole('radio', { name: '开发工具' })).toBeTruthy();

    const file = new File([
      '---\nname: my-skill\ndescription: Example\n---\n# Skill',
    ], 'SKILL.md', { type: 'text/markdown' });
    if (typeof file.text !== 'function') {
      Object.defineProperty(file, 'text', {
        value: async () => '---\nname: my-skill\ndescription: Example\n---\n# Skill',
      });
    }
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('SKILL.md')).toBeTruthy());
    expect(publishButton).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: '开发工具' }));
    await waitFor(() => expect(publishButton).not.toBeDisabled());
    fireEvent.click(publishButton);

    await waitFor(() => expect(uploadSkillToCloudMock).toHaveBeenCalledTimes(1));
    expect(uploadSkillToCloudMock.mock.calls[0]?.[2]).toBe('public');
    expect(uploadSkillToCloudMock.mock.calls[0]?.[3]).toBe('development_tools');
    expect(uploadSkillToCloudMock.mock.calls[0]?.[4]).toBe('craft');
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
      name: 'my-skill',
      category: 'development_tools',
    })));
  });

  it('publishes a project selected directly from Personal All', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/workspace/directory') {
        return jsonResponse({
          items: [{
            workspaceId: 'workspace-1',
            workspaceName: 'Personal',
            workspaceType: 'team',
            workspaceMemberId: 'member-1',
            isDefaultTeam: true,
            isSharedSpace: false,
            memberStatus: 'active',
            lifecycleState: 'active',
          }],
        });
      }
      if (url === '/api/workspaces/workspace-1/projects?view=all') {
        return jsonResponse({
          projects: [{
            workspaceId: 'workspace-1',
            visibility: 'personal',
            createdByWorkspaceMemberId: 'member-1',
            project: {
              id: 'project-1',
              name: 'Landing page',
              updatedAt: Date.now(),
            },
          }],
        });
      }
      return jsonResponse({ exists: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onPublish = vi.fn();
    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog onClose={() => {}} onPublish={onPublish} />
      </I18nProvider>,
    );

    const option = await screen.findByRole('option', { name: /Landing page/ });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/projects?view=all',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({
          'x-od-workspace-member-id': 'member-1',
        }),
      }),
    );
    const search = screen.getByRole('searchbox', { name: '搜索项目' });
    fireEvent.change(search, { target: { value: 'Landing' } });
    expect(screen.getByRole('option', { name: /Landing page/ })).toBeTruthy();
    fireEvent.click(option);
    const publishButton = screen.getByRole('button', { name: '确认发布' });
    await waitFor(() => expect(publishButton).not.toBeDisabled());
    fireEvent.click(publishButton);

    await waitFor(() => expect(onPublish).toHaveBeenCalledWith({
      projectId: 'project-1',
      name: 'Landing page',
      description: '',
    }));
  });

  it('uses one MCP name field plus an optional description for manual entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/mcp/servers') return jsonResponse({ servers: [] });
      return jsonResponse({ exists: false });
    }));
    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog initialCategory="mcp" onClose={() => {}} onPublish={() => {}} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: '手动输入' }));
    expect(screen.getByText('MCP 名称')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'MCP 名称' })).toBeTruthy();
    expect(screen.getByText('简介')).toBeTruthy();
    expect(screen.queryByText('显示名称')).toBeNull();
  });
});
