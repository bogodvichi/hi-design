// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { ToastProvider } from '../../src/components/ToastProvider';
import { buildZip } from '../../src/runtime/zip';
import { AddSkillDialog } from '../../src/components/AddSkillDialog';

const { uploadSkillToCloud, getOpenDesignHost, isMacPlatform } = vi.hoisted(() => ({
  uploadSkillToCloud: vi.fn(), getOpenDesignHost: vi.fn(), isMacPlatform: vi.fn(),
}));
vi.mock('../../src/providers/registry', () => ({
  uploadSkillToCloud, installSkill: vi.fn(), deleteSkill: vi.fn(),
}));
vi.mock('@open-design/host', () => ({ getOpenDesignHost }));
vi.mock('../../src/utils/platform', () => ({ isMacPlatform }));
vi.mock('../../src/collab/useWorkspaceContext', () => ({
  useWorkspaceContext: () => ({ context: null, loading: false }),
}));

const content = '---\nname: renamed-skill\ndescription: Upload example\n---\n# Instructions\nKeep this content.\n';
const workspaces = ['personal', 'team'].map((id) => ({
  workspaceId: id, workspaceMemberId: `${id}-member`, workspaceType: id as 'personal' | 'team',
  role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: {},
} as WorkspaceCollabContext));

beforeEach(() => {
  vi.clearAllMocks();
  getOpenDesignHost.mockReturnValue(null);
  isMacPlatform.mockReturnValue(true);
  uploadSkillToCloud.mockResolvedValue({ ok: true, title: 'renamed-skill', resourceId: 'skill-source' });
  const OriginalFile = File;
  vi.stubGlobal('File', class extends OriginalFile {
    text(): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    }
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/skills/cloud/check?')) return Response.json({ exists: false });
    if (url.includes('/skills/cloud/skill-source/install?')) return Response.json({ installed: true });
    throw new Error(`Unexpected request ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each(workspaces)('Skill upload in $workspaceId', (workspace) => {
  it.each(['native picker', 'file input', 'Mac browser file input', 'drop files', 'drop entries'])(
    'uploads a renamed Markdown file from %s as SKILL.md',
    async (entryPoint) => {
      const file = new File([content], entryPoint.startsWith('drop') ? '2skill.MD' : '2skill.md', { type: 'text/markdown' });
      if (entryPoint === 'native picker') {
        getOpenDesignHost.mockReturnValue({ project: { pickSkillSource: vi.fn().mockResolvedValue({
          ok: true, kind: 'files', files: [{ path: file.name, data: new TextEncoder().encode(content).buffer }],
        }) } });
      }
      if (entryPoint === 'file input') isMacPlatform.mockReturnValue(false);
      const onClose = vi.fn();
      render(<I18nProvider initial="zh-CN"><ToastProvider>
        <AddSkillDialog open onClose={onClose} workspaceContext={workspace} />
      </ToastProvider></I18nProvider>);
      const zone = screen.getByRole('button', { name: /拖拽或点击上传/ });
      if (entryPoint === 'native picker') {
        fireEvent.click(zone);
      } else if (entryPoint.endsWith('file input')) {
        expect(screen.getByRole('button', { name: '选择文件' })).toBeTruthy();
        const input = document.querySelector<HTMLInputElement>('input[type="file"][accept=".zip,.md"]');
        expect(input).not.toBeNull();
        fireEvent.change(input!, { target: { files: [file] } });
      } else {
        const items = entryPoint === 'drop entries' ? [{ webkitGetAsEntry: () => ({
          isFile: true, isDirectory: false, file: (callback: (file: File) => void) => callback(file),
        }) }] : [];
        fireEvent.drop(zone, { dataTransfer: { files: [file], items } });
      }
      await screen.findByText(file.name);
      const summary = screen.getByRole('group', {name: '已选择的 Skill'});
      expect(summary).toHaveTextContent('Markdown 文件');
      expect(summary).toHaveTextContent(`${new TextEncoder().encode(content).length} B`);
      expect(summary).toContainElement(screen.getByRole('button', {name: '删除已导入 Skill'}));
      await waitFor(() => expect(screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(uploadSkillToCloud).toHaveBeenCalledWith(
        [{ file: expect.any(File), path: 'SKILL.md' }], workspace,
      );
      expect(await uploadSkillToCloud.mock.calls[0]![0][0].file.text()).toBe(content);
      expect(file.name).toBe(entryPoint.startsWith('drop') ? '2skill.MD' : '2skill.md');
      expect(fetch).toHaveBeenCalledWith(
        `/api/workspace/skills/cloud/skill-source/install?home_workspace_id=${workspace.workspaceId}`,
        expect.objectContaining({ headers: expect.objectContaining({
          'x-od-workspace-id': workspace.workspaceId,
          'x-od-workspace-member-id': workspace.workspaceMemberId,
        }) }),
      );
    },
  );
});

it('rejects a non-Markdown single file before uploading', async () => {
  render(<I18nProvider initial="zh-CN"><ToastProvider>
    <AddSkillDialog open onClose={vi.fn()} workspaceContext={workspaces[0]} />
  </ToastProvider></I18nProvider>);
  fireEvent.drop(screen.getByRole('button', { name: /拖拽或点击上传/ }), {
    dataTransfer: { files: [new File([content], 'skill.txt')], items: [] },
  });
  expect(await screen.findByText(/单文件导入仅支持 Markdown/)).toBeTruthy();
  expect(uploadSkillToCloud).not.toHaveBeenCalled();
});

it('preserves a folder manifest and its accompanying files', async () => {
  const manifest = new File([content], 'SKILL.md');
  const reference = new File(['Reference'], 'guide.md');
  Object.defineProperty(manifest, 'webkitRelativePath', { value: 'example/SKILL.md' });
  Object.defineProperty(reference, 'webkitRelativePath', { value: 'example/references/guide.md' });
  const onClose = vi.fn();
  render(<I18nProvider initial="zh-CN"><ToastProvider>
    <AddSkillDialog open onClose={onClose} workspaceContext={workspaces[0]} />
  </ToastProvider></I18nProvider>);
  fireEvent.change(document.querySelector('input[type="file"][multiple]')!, {
    target: { files: [manifest, reference] },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(uploadSkillToCloud).toHaveBeenCalledWith([
    { file: manifest, path: 'SKILL.md' },
    { file: reference, path: 'references/guide.md' },
  ], workspaces[0]);
});


describe.each(workspaces)('shared Skill upload rules in $workspaceId', workspace => {
  function show() {
    render(<I18nProvider initial="zh-CN"><ToastProvider>
      <AddSkillDialog open onClose={vi.fn()} workspaceContext={workspace} />
    </ToastProvider></I18nProvider>);
  }
  it('shows the supported formats and 500 MB limit inside the selection zone', () => {
    show();
    expect(screen.getByRole('button', { name: /拖拽或点击上传/ })).toHaveTextContent('支持文件夹/.zip包/.md文件，总大小不超过500MB');
  });
  it('recognizes a deep native folder and normalizes its renamed entry', async () => {
    getOpenDesignHost.mockReturnValue({ project: { pickSkillSource: vi.fn().mockResolvedValue({
      ok: true, kind: 'folder', folderName: 'original-skill-folder', files: [
        { path: 'one/two/three/2SKILL.md', data: new TextEncoder().encode(content).buffer },
        { path: 'one/two/three/references/guide.md', data: new TextEncoder().encode('Reference').buffer },
        { path: 'README.md', data: new TextEncoder().encode('Wrapper').buffer },
      ],
    }) } });
    show();
    fireEvent.click(screen.getByRole('button', { name: /拖拽或点击上传/ }));
    const confirm = screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    const summary = screen.getByRole('group', {name: '已选择的 Skill'});
    expect(summary).toHaveTextContent('original-skill-folder');
    expect(summary).toHaveTextContent('3 个文件');
    expect(summary).toHaveTextContent(`${new TextEncoder().encode(content + 'Reference' + 'Wrapper').length} B`);
    expect(summary).toContainElement(screen.getByRole('button', {name: '删除已导入 Skill'}));
    expect(screen.queryByRole('button', {name: /拖拽或点击上传/})).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(uploadSkillToCloud).toHaveBeenCalled());
    expect(uploadSkillToCloud.mock.calls[0]![0].map((file: {path:string}) => file.path)).toEqual(['SKILL.md', 'references/guide.md']);

  });
  it('keeps the folder name when a nested folder contains only one Markdown file', async () => {
    show();
    const file = new File([content], '2SKILL.md');
    Object.defineProperty(file, 'webkitRelativePath', {value: '选中的文件夹/one/two/2SKILL.md'});
    fireEvent.change(document.querySelector('input[multiple]')!, {target: {files: [file]}});
    const summary = screen.getByRole('group', {name: '已选择的 Skill'});
    expect(summary).toHaveTextContent('选中的文件夹');
    expect(summary).toHaveTextContent('1 个文件');
    expect(summary).toHaveTextContent(`${new TextEncoder().encode(content).length} B`);
    await waitFor(() => expect(screen.getByRole('button', {name: /^(确认|校验中\.\.\.)$/})).not.toBeDisabled());
  });
  it.each([500, 501])('checks the total size at %s MB before upload', async mb => {
    show();
    const file = new File([content], 'custom.md');
    Object.defineProperty(file, 'size', { value: mb * 1024 * 1024 });
    fireEvent.change(document.querySelector('input[accept=".zip,.md"]')!, { target: { files: [file] } });
    const confirm = screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ });
    if (mb === 501) {
      expect(await screen.findByRole('alert')).toHaveTextContent('文件太大（超过500MB）');
      expect(confirm).toBeDisabled();
      expect(uploadSkillToCloud).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(confirm).not.toBeDisabled());
    }
  });
  it.each([
    { paths: ['one/two/example.txt'], text: 'Reference', error: '未找到skill.md文件' },
    { paths: ['one/first.md', 'two/three/second.md'], text: content, error: '无法上传多个skill，请单独上传' },
  ])('rejects invalid folders: $error', async ({paths, text, error}) => {
    show();
    const files = paths.map(path => {
      const file = new File([text], path.split('/').pop()!);
      Object.defineProperty(file, 'webkitRelativePath', { value: path });
      return file;
    });
    fireEvent.change(document.querySelector('input[multiple]')!, { target: { files } });
    expect(await screen.findByRole('alert')).toHaveTextContent(error);
    expect(screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ })).toBeDisabled();
    expect(uploadSkillToCloud).not.toHaveBeenCalled();
  });
  it('locks removal during upload and restores selection after a readable failure', async () => {
    let finish!: (value: unknown) => void;
    uploadSkillToCloud.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    show();
    fireEvent.change(document.querySelector('input[accept=".zip,.md"]')!, { target: { files: [new File([content], 'custom.md')] } });
    const confirm = screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    const remove = screen.getByRole('button', { name: '删除已导入 Skill' });
    fireEvent.click(confirm);
    await waitFor(() => expect(uploadSkillToCloud).toHaveBeenCalledTimes(1));
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(screen.getByText('custom.md')).toBeVisible();
    finish({ error: { code: 'PAYLOAD_TOO_LARGE', status: 413, message: 'Skill upload exceeds 500 MB.' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('文件太大（超过500MB）');
    await waitFor(() => expect(remove).not.toBeDisabled());
    fireEvent.click(remove);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ })).toBeDisabled();
  });
  it.each([
    { entries: [{path: 'one/two/three/2SKILL.md', content}], error: null },
    { entries: [{path: 'one/first.md', content}, {path: 'two/second.md', content}], error: '无法上传多个skill，请单独上传' },
    { entries: [{path: 'one/readme.txt', content: 'Reference'}], error: '未找到skill.md文件' },
  ])('validates ZIP entry contents before upload (error=$error)', async ({entries, error}) => {
    const blob = buildZip(entries);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const file = new File([bytes], 'skill.zip');
    Object.defineProperty(file, 'slice', { value: (start = 0, end = file.size) => ({ arrayBuffer: async () => bytes.slice(start, end) }) });
    show();
    fireEvent.change(document.querySelector('input[accept=".zip,.md"]')!, { target: { files: [file] } });
    const summary = screen.getByRole('group', {name: '已选择的 Skill'});
    expect(summary).toHaveTextContent('skill.zip');
    expect(summary).toHaveTextContent('ZIP 压缩包');
    const confirm = screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ });
    if (error) {
      expect(await screen.findByRole('alert')).toHaveTextContent(error);
      expect(confirm).toBeDisabled();
      expect(uploadSkillToCloud).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(confirm).not.toBeDisabled());
      fireEvent.click(confirm);
      await waitFor(() => expect(uploadSkillToCloud).toHaveBeenCalledWith({ zip: file }, workspace));
    }
  });
  it('rejects an aggregate folder size over 500 MB', async () => {
    show();
    const files = [new File([content], '2SKILL.md'), new File(['asset'], 'data.bin')];
    files.forEach((file, i) => {
      Object.defineProperty(file, 'size', { value: (i ? 250 : 251) * 1024 * 1024 });
      Object.defineProperty(file, 'webkitRelativePath', { value: `one/two/${file.name}` });
    });
    fireEvent.change(document.querySelector('input[multiple]')!, { target: { files } });
    expect(await screen.findByRole('alert')).toHaveTextContent('文件太大（超过500MB）');
    expect(uploadSkillToCloud).not.toHaveBeenCalled();
  });
  it('does not apply a file count cap to folder contents', async () => {
    show();
    const files = [new File([content], '2SKILL.md'), ...Array.from({length: 600}, (_, i) => new File(['asset'], `${i}.txt`))];
    files.forEach(file => Object.defineProperty(file, 'webkitRelativePath', { value: `one/two/${file.name}` }));
    fireEvent.change(document.querySelector('input[multiple]')!, { target: { files } });
    const confirm = screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(uploadSkillToCloud).toHaveBeenCalled());
    expect(uploadSkillToCloud.mock.calls[0]![0]).toHaveLength(601);
  });
  it('ignores stale validation after a newer selection replaces it', async () => {
    show();
    let fail!: (error: Error) => void;
    const old = new File([content], 'old.md');
    Object.defineProperty(old, 'text', { value: () => new Promise((_resolve, reject) => { fail = reject; }) });
    const input = document.querySelector('input[accept=".zip,.md"]')!;
    fireEvent.change(input, { target: {files: [old]} });
    fireEvent.change(input, { target: {files: [new File([content], 'new.md')]} });
    const confirm = screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fail(new Error('EACCES'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(confirm).not.toBeDisabled();
    expect(screen.getByText('new.md')).toBeVisible();
  });
  it('allows retry after a transient upload failure', async () => {
    uploadSkillToCloud.mockResolvedValueOnce({error: {code: 'network_error', message: 'Failed to fetch'}});
    show();
    fireEvent.change(document.querySelector('input[accept=".zip,.md"]')!, { target: {files: [new File([content], 'custom.md')]} });
    const confirm = screen.getByRole('button', { name: /^(确认|校验中\.\.\.)$/ });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('网络连接失败');
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(uploadSkillToCloud).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a nested directory read failure instead of hiding it as a missing manifest', async () => {
    show();
    fireEvent.drop(screen.getByRole('button', {name: /拖拽或点击上传/}), {dataTransfer: {
      files: [], items: [{webkitGetAsEntry: () => ({
        isDirectory: true, isFile: false, name: 'nested',
        createReader: () => ({readEntries: (_success: unknown, failure: (error: Error) => void) => failure(new Error('EACCES'))}),
      })}],
    }});
    expect(await screen.findByRole('alert')).toHaveTextContent('文件读取失败，请检查访问权限');
    expect(screen.getByRole('button', {name: /^(确认|校验中\.\.\.)$/})).toBeDisabled();
    expect(uploadSkillToCloud).not.toHaveBeenCalled();
  });

});
