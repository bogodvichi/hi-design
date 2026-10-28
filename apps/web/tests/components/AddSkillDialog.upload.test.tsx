// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
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
  workspaceId: id, workspaceMemberId: `${id}-member`, workspaceType: 'team',
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
      render(<I18nProvider initial="zh-CN">
        <AddSkillDialog open onClose={onClose} workspaceContext={workspace} />
      </I18nProvider>);
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
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
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
  render(<I18nProvider initial="zh-CN">
    <AddSkillDialog open onClose={vi.fn()} workspaceContext={workspaces[0]} />
  </I18nProvider>);
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
  render(<I18nProvider initial="zh-CN">
    <AddSkillDialog open onClose={onClose} workspaceContext={workspaces[0]} />
  </I18nProvider>);
  fireEvent.change(document.querySelector('input[type="file"][multiple]')!, {
    target: { files: [manifest, reference] },
  });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(uploadSkillToCloud).toHaveBeenCalledWith([
    { file: manifest, path: 'example/SKILL.md' },
    { file: reference, path: 'example/references/guide.md' },
  ], workspaces[0]);
});
