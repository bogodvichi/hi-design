// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { AddMcpDialog } from '../../src/components/AddMcpDialog';

vi.mock('../../src/collab/useWorkspaceContext', () => ({
  useWorkspaceContext: () => ({ context: null, loading: false }),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['personal', 'team'])('offers only owned Mcp sources in %s', (workspaceId) => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const context = { workspaceId, workspaceMemberId: `${workspaceId}-member`, workspaceType: 'team',
    role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: {} } as WorkspaceCollabContext;
  render(<I18nProvider initial="zh-CN"><AddMcpDialog open onClose={vi.fn()} workspaceContext={context} /></I18nProvider>);
  expect(screen.queryByRole('tab', { name: '社区' })).toBeNull();
  expect(screen.queryByText(/从社区/)).toBeNull();
  expect(screen.getByRole('textbox', { name: 'MCP 名称' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: '完整 JSON 配置' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'fetch' }));
  expect((screen.getByRole('textbox', { name: 'MCP 名称' }) as HTMLInputElement).value).toBe('fetch');
  expect(screen.getByRole('button', { name: '确认' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: '确认' })).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});
