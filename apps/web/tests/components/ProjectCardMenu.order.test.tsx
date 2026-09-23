// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import { DesignsTab } from '../../src/components/DesignsTab';
import { I18nProvider } from '../../src/i18n';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import type { Project } from '../../src/types';
import { workspaceContextFixture } from '../helpers/workspace-context';

const state = vi.hoisted(() => ({
  context: null as WorkspaceCollabContext | null,
  shareDialogProps: null as null | { workspaceId?: string; canPublishToCommunity?: boolean; canShareFile?: boolean },
}));
vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>(),
  useWorkspaceContext: () => ({ context: state.context, loading: false, failure: null }),
  useSharedSpaceTeamId: () => null,
  notifyTeamProjectsChanged: vi.fn(),
}));
vi.mock('../../src/auth/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/auth/auth')>(),
  getStoredUsername: () => null,
}));
vi.mock('../../src/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/providers/registry')>(),
  fetchProjectFiles: vi.fn(async () => []),
  fetchProjectFileText: vi.fn(async () => null),
  fetchLiveArtifacts: vi.fn(async () => []),
}));
vi.mock('../../src/collab/workspace-events', () => ({ useWorkspaceInvalidation: vi.fn(() => ({ connected: false })) }));
vi.mock('../../src/components/UnifiedShareDialog', () => ({
  UnifiedShareDialog: (props: { projectId: string; workspaceId?: string; canPublishToCommunity?: boolean; canShareFile?: boolean }) => {
    state.shareDialogProps = props;
    return <div role="dialog" aria-label="share target">{props.projectId}</div>;
  },
}));
vi.mock('../../src/components/MoveToTeamTreeDialog', () => ({
  MoveToTeamTreeDialog: ({ copyMode }: { copyMode?: boolean }) => <div role="dialog" aria-label={copyMode ? 'copy target' : 'move target'} />,
}));

beforeEach(() => {
  localStorage.clear();
  state.context = workspaceContextFixture({ workspaceId: 'ws-1', workspaceMemberId: 'wm-1', teamId: 'ws-1' });
  state.shareDialogProps = null;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], members: [], projects: [] }))));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

function project(): Project {
  return { id: 'menu-project', name: 'Menu project', skillId: null, designSystemId: null,
    createdAt: 1, updatedAt: 2, createdByWorkspaceMemberId: 'wm-1', workspaceId: 'ws-1', status: { value: 'not_started' } };
}
async function recent(overrides: Partial<ComponentProps<typeof RecentProjectsStrip>> = {}) {
  const props: ComponentProps<typeof RecentProjectsStrip> = {
    projects: [project()], onOpen: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(),
    homeWorkspaceId: 'personal-ws', space: 'drafts', collaborationEnabled: true, ...overrides,
  };
  await act(async () => { render(<I18nProvider initial="zh-CN"><RecentProjectsStrip {...props} /></I18nProvider>); });
  return props;
}
function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  return screen.getByRole('menu');
}
function order(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]'),
    (item) => item.getAttribute('role') === 'separator' ? 'separator' : item.textContent?.trim() ?? '');
}

describe('project card action order', () => {
  it.each(['grid', 'list'] as const)('orders personal actions and the separator in %s view', async (view) => {
    await recent();
    if (view === 'list') fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    expect(order(openMenu())).toEqual(['分享', '复制', 'separator', '重命名', '移动项目', '删除']);
  });
  it('keeps copy-to-personal for the recent-projects surface', async () => {
    await recent({ space: 'recent' });
    expect(order(openMenu())).toEqual(['分享', '复制', zhCN['recentProjects.copyToPersonal'], 'separator', '重命名', '移动项目', '删除']);
  });
  it('uses the shared-with-me menu and limits sharing to links', async () => {
    await recent({
      space: 'team',
      badgeOverride: 'shared',
      sharedWithMeHomeWorkspaceId: () => 'owner-workspace',
      onRemoveSharedWithMe: vi.fn(),
    });
    expect(order(openMenu())).toEqual(['分享', '复制', 'separator', '从分享给我的删除']);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '分享' }));
    expect(state.shareDialogProps).toMatchObject({
      workspaceId: 'owner-workspace',
      canPublishToCommunity: false,
      canShareFile: false,
    });
  });
  it('routes shared-with-me removal through the dedicated access-removal callback', async () => {
    const onRemoveSharedWithMe = vi.fn();
    await recent({
      space: 'team',
      badgeOverride: 'shared',
      sharedWithMeHomeWorkspaceId: () => 'owner-workspace',
      onRemoveSharedWithMe,
    });
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '从分享给我的删除' }));
    expect(onRemoveSharedWithMe).toHaveBeenCalledExactlyOnceWith('menu-project');
  });
  it('gives a team project creator the same project actions as personal', async () => {
    await recent({ space: 'team', operator: { memberId: 'wm-1', role: 'member' } });
    expect(order(openMenu())).toEqual(['分享', '复制', 'separator', '重命名', '移动项目', '删除']);
  });
  it('gives a non-creator team member only share and copy, without an orphan separator', async () => {
    await recent({ space: 'team', operator: { memberId: 'member-other', role: 'member' } });
    expect(order(openMenu())).toEqual(['分享', '复制']);
  });
  it('omits the separator when there are no share/copy actions', async () => {
    await recent({ homeWorkspaceId: null, onDuplicate: undefined });
    expect(order(openMenu())).toEqual(['重命名', '移动项目', '删除']);
  });
  it('omits the separator when there are no management actions', async () => {
    await recent({ space: 'recent', homeWorkspaceId: null, collaborationEnabled: false, onRename: undefined, onDelete: undefined });
    expect(order(openMenu())).toEqual(['复制']);
  });
  it.each(['owner', 'admin'] as const)('gives a non-creator team %s share, copy, then move', async (role) => {
    await recent({ space: 'team', operator: { memberId: 'another-member', role } });
    expect(order(openMenu())).toEqual(['分享', '复制', 'separator', '移动项目']);
  });
  it('does not reveal actions for a guest', async () => {
    await recent({ space: 'team', operator: { memberId: 'wm-1', role: 'guest' } });
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
  });
  it('preserves the copy callback and does not open the project', async () => {
    const props = await recent();
    const menu = openMenu();
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: '复制' })); });
    expect(props.onDuplicate).toHaveBeenCalledExactlyOnceWith('menu-project');
    expect(props.onOpen).not.toHaveBeenCalled();
  });
  it('still opens sharing for the selected project', async () => {
    await recent();
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '分享' }));
    expect(screen.getByRole('dialog', { name: 'share target' }).textContent).toBe('menu-project');
  });
  it('gives a team project creator all three share capabilities', async () => {
    await recent({ space: 'team', operator: { memberId: 'wm-1', role: 'member' } });
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '分享' }));
    expect(state.shareDialogProps).toMatchObject({ canPublishToCommunity: true, canShareFile: true });
  });
  it.each(['member', 'owner', 'admin'] as const)('limits a non-creator team %s to share links', async (role) => {
    await recent({ space: 'team', operator: { memberId: 'member-other', role } });
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '分享' }));
    expect(state.shareDialogProps).toMatchObject({ canPublishToCommunity: false, canShareFile: false });
  });
  it('still opens the existing move selector', async () => {
    await recent();
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '移动项目' }));
    expect(screen.getByRole('dialog', { name: 'move target' })).toBeTruthy();
  });
});

describe('legacy project card action order', () => {
  it.each([true, false])('keeps only supported operations and handles copy availability: %s', async (copyAvailable) => {
    await act(async () => {
      render(<I18nProvider initial="zh-CN"><DesignsTab projects={[project()]} skills={[]} designSystems={[]}
        onOpen={vi.fn()} onOpenLiveArtifact={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onDuplicate={copyAvailable ? vi.fn() : undefined} isActive={false} /></I18nProvider>);
    });
    expect(order(openMenu())).toEqual(copyAvailable ? ['复制', 'separator', '重命名', '删除'] : ['重命名', '删除']);
  });
});
