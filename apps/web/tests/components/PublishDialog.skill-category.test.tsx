// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { PublishDialog } from '../../src/components/PublishDialog';

const {
  uploadSkillToCloudMock,
  importProjectFilesMock,
  importProjectZipMock,
  getOpenDesignHostMock,
  fetchProjectFilesMock,
} = vi.hoisted(() => ({
  uploadSkillToCloudMock: vi.fn(),
  importProjectFilesMock: vi.fn(),
  importProjectZipMock: vi.fn(),
  getOpenDesignHostMock: vi.fn(),
  fetchProjectFilesMock: vi.fn(),
}));

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFiles: fetchProjectFilesMock,
  openFolderDialog: vi.fn(),
  projectFileUrl: vi.fn((projectId: string, name: string) => `/api/projects/${projectId}/raw/${name}`),
  uploadSkillToCloud: uploadSkillToCloudMock,
}));

vi.mock('@open-design/host', () => ({
  getOpenDesignHost: getOpenDesignHostMock,
}));

vi.mock('../../src/state/projects', () => ({
  importProjectFiles: importProjectFilesMock,
  importProjectZip: importProjectZipMock,
  resolvedWorkspaceContextForWrite: (state: any) => state.context ?? null,
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
  workspaceProjectHeaders: (context: any) => ({
    'x-od-workspace-id': context.workspaceId,
    'x-od-workspace-member-id': context.workspaceMemberId,
    'x-od-workspace-type': context.workspaceType,
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
  it('publishes a team Skill using its cloud resource id and selected team identity', async () => {
    const onPublish = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/workspace/directory') return jsonResponse({ items: [
        { workspaceId: 'workspace-1', workspaceName: 'Personal', workspaceType: 'team', workspaceMemberId: 'member-1', isDefaultTeam: true, memberStatus: 'active' },
        { workspaceId: 'team-a', workspaceName: '技术平台部', workspaceType: 'team', workspaceMemberId: 'member-a', memberStatus: 'active' },
      ] });
      if (url === '/api/workspace/skills/cloud?owner_member_id=member-a') return jsonResponse({ skills: [
        { localId: 'requirement-analysis', resourceId: 'skill-team-a-requirement-analysis', title: 'Requirement analysis' },
      ] });
      if (url === '/api/workspace/skills/skill-team-a-requirement-analysis/share?scope=public') return jsonResponse({ shared: true, version: 3 });
      return jsonResponse({ skills: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<I18nProvider initial="zh-CN"><PublishDialog initialCategory="skill" onClose={() => {}} onPublish={onPublish} /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /技术平台部/ }));
    fireEvent.click(await screen.findByText('Requirement analysis'));
    fireEvent.click(screen.getByRole('radio', { name: '开发工具' }));
    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/workspace/skills/skill-team-a-requirement-analysis/share?scope=public',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-od-workspace-id': 'team-a', 'x-od-workspace-member-id': 'member-a' }) })));
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ name: 'Requirement analysis' })));
  });

  beforeEach(() => {
    uploadSkillToCloudMock.mockReset();
    uploadSkillToCloudMock.mockResolvedValue({ ok: true, title: 'my-skill' });
    importProjectFilesMock.mockReset();
    importProjectFilesMock.mockResolvedValue({ project: { id: 'imported-project' } });
    importProjectZipMock.mockReset();
    importProjectZipMock.mockResolvedValue({ project: { id: 'imported-zip-project' } });
    getOpenDesignHostMock.mockReset();
    getOpenDesignHostMock.mockReturnValue(null);
    fetchProjectFilesMock.mockReset();
    fetchProjectFilesMock.mockResolvedValue([{
      name: 'index.html',
      path: 'index.html',
      kind: 'html',
      mtime: 1,
      size: 1,
    }]);
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
      if (url === '/api/folders?workspace_id=workspace-1') {
        return jsonResponse({ data: { folders: [] } });
      }
      if (url === '/api/folders/root/projects?workspace_id=workspace-1') {
        return jsonResponse({ data: { projects: [] } });
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
    expect(uploadSkillToCloudMock).not.toHaveBeenCalled();
    expect(onPublish).not.toHaveBeenCalled();
    expect(publishButton).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: '开发工具' }));
    await waitFor(() => expect(publishButton).not.toBeDisabled());
    fireEvent.click(publishButton);

    expect(uploadSkillToCloudMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
      name: 'my-skill',
      category: 'development_tools',
      logoKey: 'craft',
      upload: expect.any(Array),
    })));
  });

  it.each([
    ['native picker', 'design-review.md'],
    ['file input', 'design-review SKILL.md'],
    ['drop files', '设计评审.MD'],
    ['drop entries', 'review.md'],
  ])(
    'publishes a renamed Markdown Skill from %s as SKILL.md',
    async (entryPoint, fileName) => {
      const content = '---\nname: design-review\n---\n# Design review';
      const file = new File([content], fileName, { type: 'text/markdown' });
      if (typeof file.text !== 'function') {
        Object.defineProperty(file, 'text', { value: async () => content });
      }
      if (entryPoint === 'native picker') {
        getOpenDesignHostMock.mockReturnValue({
          project: {
            pickSkillSource: vi.fn().mockResolvedValue({
              ok: true,
              kind: 'files',
              files: [{ path: file.name, data: new TextEncoder().encode(content).buffer }],
            }),
          },
        });
      }
      const onPublish = vi.fn();
      render(
        <I18nProvider initial="zh-CN">
          <PublishDialog initialCategory="skill" onClose={() => {}} onPublish={onPublish} />
        </I18nProvider>,
      );
      fireEvent.click(screen.getByRole('tab', { name: '导入本地 Skill' }));
      const uploadButton = screen.getByRole('button', { name: /选择文件夹 \/ ZIP/ });
      if (entryPoint === 'native picker') {
        fireEvent.click(uploadButton);
      } else if (entryPoint === 'file input') {
        const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
        fireEvent.change(input!, { target: { files: [file] } });
      } else {
        const items = entryPoint === 'drop entries' ? [{
          webkitGetAsEntry: () => ({
            isFile: true,
            isDirectory: false,
            file: (callback: (selected: File) => void) => callback(file),
          }),
        }] : [];
        fireEvent.drop(uploadButton, { dataTransfer: { files: [file], items } });
      }
      fireEvent.click(screen.getByRole('radio', { name: '开发工具' }));
      const publishButton = screen.getByRole('button', { name: '确认发布' });
      await waitFor(() => expect(publishButton).not.toBeDisabled());
      expect(screen.getByText(file.name)).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onPublish).not.toHaveBeenCalled();
      fireEvent.click(publishButton);
      await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        name: 'design-review',
        upload: [{ file: expect.any(File), path: 'SKILL.md' }],
      })));
      const uploaded = onPublish.mock.calls[0]![0].upload[0].file as File;
      expect(await uploaded.text()).toBe(content);
    },
  );

  it.each([
    { fileName: 'review.md', content: ' ', error: 'SKILL.md 内容为空，请补充内容后重新选择。' },
    { fileName: 'review.md', content: '# Review', error: 'SKILL.md 缺少 name 字段，请补充后重新选择。' },
    { fileName: 'review.txt', content: '---\nname: review\n---', error: '单文件导入仅支持 Markdown（.md）文件，请重新选择。' },
    { fileName: 'review.md', content: '---\nname: review\n---', duplicate: true, error: '已存在同名 Skill，请更换 SKILL.md 中的 name 后重新选择。' },
  ])('blocks invalid single-file Skill content: $error', async ({ fileName, content, duplicate, error }) => {
    if (duplicate) {
      const fetchOriginal = globalThis.fetch;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
        String(input).startsWith('/api/workspace/skills/cloud/check?')
          ? jsonResponse({ exists: true })
          : fetchOriginal(input)
      )));
    }
    getOpenDesignHostMock.mockReturnValue({
      project: {
        pickSkillSource: vi.fn().mockResolvedValue({
          ok: true,
          kind: 'files',
          files: [{ path: fileName, data: new TextEncoder().encode(content).buffer }],
        }),
      },
    });
    const onPublish = vi.fn();
    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog initialCategory="skill" onClose={() => {}} onPublish={onPublish} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: '导入本地 Skill' }));
    fireEvent.click(screen.getByRole('button', { name: /选择文件夹 \/ ZIP/ }));
    fireEvent.click(screen.getByRole('radio', { name: '开发工具' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(error);
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('still requires SKILL.md inside an imported folder', async () => {
    const file = new File(['---\nname: review\n---'], 'review.md');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'review/review.md' });
    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog initialCategory="skill" onClose={() => {}} onPublish={() => {}} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: '导入本地 Skill' }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    fireEvent.change(input!, { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('未找到 SKILL.md，请选择包含 SKILL.md 的文件夹或 ZIP 包。');
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();
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
      if (url === '/api/folders?workspace_id=workspace-1') {
        return jsonResponse({ data: { folders: [] } });
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

  it('blocks publishing an empty project and shows a readable error immediately', async () => {
    fetchProjectFilesMock.mockResolvedValue([]);

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
      if (url === '/api/folders?workspace_id=workspace-1') {
        return jsonResponse({ data: { folders: [] } });
      }
      if (url === '/api/workspaces/workspace-1/projects?view=all') {
        return jsonResponse({
          projects: [{
            workspaceId: 'workspace-1',
            visibility: 'personal',
            createdByWorkspaceMemberId: 'member-1',
            project: {
              id: 'empty-project',
              name: '表格页 Copy',
              updatedAt: Date.now(),
            },
          }],
        });
      }
      return jsonResponse({ exists: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog onClose={() => {}} onPublish={() => {}} />
      </I18nProvider>,
    );

    const option = await screen.findByRole('option', { name: /表格页 Copy/ });
    fireEvent.click(option);

    expect(await screen.findByText('项目暂无可发布内容，请先完成项目内容后再发布。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();
  });

  it('shows nested team groups and loads projects from the selected group', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/workspace/directory') {
        return jsonResponse({
          items: [
            {
              workspaceId: 'personal',
              workspaceName: 'Personal',
              workspaceType: 'team',
              workspaceMemberId: 'personal-member',
              isDefaultTeam: true,
              isSharedSpace: false,
              memberStatus: 'active',
              lifecycleState: 'active',
            },
            {
              workspaceId: 'team-testing',
              workspaceName: '测试',
              workspaceType: 'team',
              workspaceMemberId: 'team-member',
              isDefaultTeam: false,
              isSharedSpace: false,
              memberStatus: 'active',
              lifecycleState: 'active',
            },
          ],
        });
      }
      if (url === '/api/folders?workspace_id=personal') {
        return jsonResponse({ data: { folders: [] } });
      }
      if (url === '/api/hdw/api/folder/list?workspace_id=team-testing') {
        return jsonResponse({
          data: {
            folders: [{
              folder_id: 'f-4treter',
              folder_name: '4treter',
              subfolder_count: '1',
            }],
          },
        });
      }
      if (url === '/api/hdw/api/folder/list?workspace_id=team-testing&folder_pid=f-4treter') {
        return jsonResponse({
          data: {
            folders: [{
              folder_id: 'f-342',
              folder_name: '342',
              subfolder_count: '0',
            }],
          },
        });
      }
      if (url === '/api/workspaces/personal/projects?view=all') {
        return jsonResponse({ projects: [] });
      }
      if (url === '/api/workspace/projects/team?folder_id=f-4treter') {
        return jsonResponse({ projects: [] });
      }
      if (url === '/api/workspace/projects/team?folder_id=f-342') {
        return jsonResponse({
          projects: [{
            projectId: 'nested-project',
            ownerMemberId: 'team-member',
            sharedAt: '2026-09-23T03:42:40.011Z',
            folderId: 'f-342',
            name: '霞浦国庆行程',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }],
        });
      }
      return jsonResponse({ projects: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog onClose={() => {}} onPublish={() => {}} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText('4treter')).toBeTruthy());
    expect(screen.queryByText('342')).toBeNull();
    fireEvent.click(screen.getByText('4treter'));

    const project = await screen.findByRole('option', { name: /霞浦国庆行程/ });
    expect(project).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/projects/team?folder_id=f-342',
      expect.objectContaining({
        cache: 'no-store',
        headers: { 'x-od-workspace-id': 'team-testing' },
      }),
    );
  });

  it('stages a local project and creates it only after confirm', async () => {
    const onPublish = vi.fn();
    const sourceData = new TextEncoder().encode('<html>local</html>').buffer;
    const pickSkillSource = vi.fn().mockResolvedValue({
      ok: true,
      kind: 'folder',
      folderName: 'local-project',
      files: [{ path: 'index.html', data: sourceData }],
    });
    getOpenDesignHostMock.mockReturnValue({
      project: { pickSkillSource },
    });

    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog onClose={() => {}} onPublish={onPublish} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: '导入本地项目' }));
    fireEvent.click(screen.getByRole('button', { name: /选择文件夹 \/ ZIP/ }));

    await waitFor(() => expect(screen.getByText('local-project')).toBeTruthy());
    expect(importProjectFilesMock).not.toHaveBeenCalled();
    expect(importProjectZipMock).not.toHaveBeenCalled();
    expect(onPublish).not.toHaveBeenCalled();

    const publishButton = screen.getByRole('button', { name: '确认发布' });
    await waitFor(() => expect(publishButton).not.toBeDisabled());
    fireEvent.click(publishButton);

    await waitFor(() => expect(importProjectFilesMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith({
      projectId: 'imported-project',
      name: 'local-project',
      description: '',
    }));
  });

  it('packages multiple text/image files into one project', async () => {
    const onPublish = vi.fn();
    const pickSkillSource = vi.fn().mockResolvedValue({
      ok: true,
      kind: 'files',
      selectionName: 'landing-assets',
      files: [
        { path: 'index.html', data: new TextEncoder().encode('<html></html>').buffer },
        { path: 'cover.png', data: new Uint8Array([137, 80, 78, 71]).buffer },
      ],
    });
    getOpenDesignHostMock.mockReturnValue({ project: { pickSkillSource } });

    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog onClose={() => {}} onPublish={onPublish} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: '导入本地项目' }));
    fireEvent.click(screen.getByRole('button', { name: /选择文件夹 \/ ZIP/ }));

    await waitFor(() => expect(screen.getByText('landing-assets')).toBeTruthy());
    const publishButton = screen.getByRole('button', { name: '确认发布' });
    await waitFor(() => expect(publishButton).not.toBeDisabled());

    fireEvent.click(publishButton);

    await waitFor(() => expect(importProjectFilesMock).toHaveBeenCalledTimes(1));
    const [files, projectName] = importProjectFilesMock.mock.calls[0]!;
    expect(files).toHaveLength(2);
    expect(files.map((entry: { path: string }) => entry.path)).toEqual(['index.html', 'cover.png']);
    expect(projectName).toBe('landing-assets');
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith({
      projectId: 'imported-project',
      name: 'landing-assets',
      description: '',
    }));
  });

  it('rejects video files when importing a project directly', async () => {
    const pickSkillSource = vi.fn().mockResolvedValue({
      ok: true,
      kind: 'files',
      selectionName: 'video-project',
      files: [{ path: 'demo.mp4', data: new Uint8Array([0, 0, 0, 0]).buffer }],
    });
    getOpenDesignHostMock.mockReturnValue({ project: { pickSkillSource } });

    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog onClose={() => {}} onPublish={() => {}} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: '导入本地项目' }));
    fireEvent.click(screen.getByRole('button', { name: /选择文件夹 \/ ZIP/ }));

    expect(await screen.findByText('暂不支持视频文件，请选择文本或图片文件。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();
  });

  it('validates a local project immediately and clears the error when the file is removed', async () => {
    const pickSkillSource = vi.fn().mockResolvedValue({
      ok: true,
      kind: 'files',
      selectionName: 'Hi-Builder-D2C-EBG行业知识库共建维护指南',
      files: [{
        path: 'Hi-Builder-D2C-EBG行业知识库共建维护指南.docx',
        data: new TextEncoder().encode('not-supported').buffer,
      }],
    });
    getOpenDesignHostMock.mockReturnValue({
      project: { pickSkillSource },
    });

    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog onClose={() => {}} onPublish={() => {}} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: '导入本地项目' }));
    fireEvent.click(screen.getByRole('button', { name: /选择文件夹 \/ ZIP/ }));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toBe('文件类型不支持，仅支持文本类型和图片类型文件。');
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '删除已导入项目' }));
    expect(screen.queryByText('文件类型不支持，仅支持文本类型和图片类型文件。')).toBeNull();
  });

  it('validates a local Skill immediately and clears the error when the file is removed', async () => {
    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog initialCategory="skill" onClose={() => {}} onPublish={() => {}} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: '导入本地 Skill' }));
    const file = new File(['hello'], 'README.md', { type: 'text/markdown' });
    if (typeof file.text !== 'function') {
      Object.defineProperty(file, 'text', { value: async () => 'hello' });
    }
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [file] } });

    const error = await screen.findByRole('alert');
    expect(error.textContent).toBe('SKILL.md 缺少 name 字段，请补充后重新选择。');
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '删除已导入 Skill' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('accepts a single SKILL.md file from the native picker', async () => {
    const skillText = '---\nname: direct-skill\n---\n# Direct Skill';
    const pickSkillSource = vi.fn().mockResolvedValue({
      ok: true,
      kind: 'files',
      selectionName: 'SKILL',
      files: [{ path: 'SKILL.md', data: new TextEncoder().encode(skillText).buffer }],
    });
    getOpenDesignHostMock.mockReturnValue({ project: { pickSkillSource } });

    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog initialCategory="skill" onClose={() => {}} onPublish={() => {}} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: '导入本地 Skill' }));
    fireEvent.click(screen.getByRole('button', { name: /选择文件夹 \/ ZIP \/ Markdown 文件/ }));

    await waitFor(() => expect(screen.getByText('SKILL.md')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rejects multiple direct files for Skill import', async () => {
    const pickSkillSource = vi.fn().mockResolvedValue({
      ok: true,
      kind: 'files',
      selectionName: 'skill-files',
      files: [
        { path: 'SKILL.md', data: new TextEncoder().encode('---\nname: a\n---').buffer },
        { path: 'README.md', data: new TextEncoder().encode('# README').buffer },
      ],
    });
    getOpenDesignHostMock.mockReturnValue({ project: { pickSkillSource } });

    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog initialCategory="skill" onClose={() => {}} onPublish={() => {}} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: '导入本地 Skill' }));
    fireEvent.click(screen.getByRole('button', { name: /选择文件夹 \/ ZIP \/ Markdown 文件/ }));

    expect(await screen.findByText('Skill 单文件导入只支持选择一个 Markdown 文件。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();
  });

  it('shows a readable MCP config error instead of silently disabling publish', async () => {
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
    const config = screen.getByRole('textbox', { name: /JSON/i });
    fireEvent.change(config, { target: { value: '{"type":"stdio"}' } });

    expect(await screen.findByText('当前为 stdio 类型，请填写启动命令（command）。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();
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
