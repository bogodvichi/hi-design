// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { AddSkillDialog } from '../../src/components/AddSkillDialog';

vi.mock('../../src/collab/useWorkspaceContext', () => ({
  useWorkspaceContext: () => ({ context: null, loading: false }),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['personal', 'team'])('offers only owned Skill sources in %s', (workspaceId) => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const context = { workspaceId, workspaceMemberId: `${workspaceId}-member`, workspaceType: 'team',
    role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: {} } as WorkspaceCollabContext;
  render(<I18nProvider initial="zh-CN"><AddSkillDialog open onClose={vi.fn()} workspaceContext={context} /></I18nProvider>);
  expect(screen.queryByRole('tab', { name: '社区' })).toBeNull();
  expect(screen.queryByText(/从社区/)).toBeNull();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /拖拽或点击上传/ })).toBeTruthy();
  const uploadTab = screen.getByRole('tab', { name: '上传本地文件' });
  const urlTab = screen.getByRole('tab', { name: '外部链接' });
  expect(uploadTab.getAttribute('aria-selected')).toBe('true');
  fireEvent.click(urlTab);
  expect(screen.getByRole('textbox')).toBeTruthy();
  expect(urlTab.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('button', { name: '确认' })).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});
