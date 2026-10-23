// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { CloudMcpList } from '../../src/components/CloudMcpList';
import { CloudToolList } from '../../src/components/CloudToolList';
import { CardActionMenu } from '../../src/components/CardActionMenu';

const openTool = vi.hoisted(() => vi.fn());
vi.mock('../../src/components/WorkspaceTabsBar', () => ({ openWorkspaceTab: openTool, activateWorkspaceResource: () => false }));
vi.mock('../../src/components/Icon', () => ({ Icon: ({ name }: { name: string }) => <svg data-icon={name} /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); openTool.mockReset(); });

it('preserves keyboard navigation and returns focus to the trigger on Escape', () => {
  render(<I18nProvider initial="zh-CN"><CardActionMenu items={[
    { id: 'unpublish', label: '取消发布', onClick: vi.fn() },
    { id: 'delete', label: '删除', onClick: vi.fn() },
  ]} /></I18nProvider>);
  const trigger = screen.getByRole('button', { name: '更多' });
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '取消发布' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '删除' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

describe.each(['skill', 'mcp', 'tool'] as const)('%s uses the shared card menu', (kind) => {
  it('uses project menu styles and a neutral trash action without opening the card', async () => {
    const row = { resourceId: 'resource', id: 'resource', localId: 'resource', title: 'My resource', name: 'My resource', label: 'My resource',
      ownerMemberId: 'me', transport: 'http', url: 'https://example.test', createdAt: '', updatedAt: '' };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/cloud?')) return Response.json({ skills: [row], templates: [row], tools: [row] });
      return Response.json({ skills: [], servers: [] });
    }));
    const List = kind === 'skill' ? CloudSkillList : kind === 'mcp' ? CloudMcpList : CloudToolList;
    render(<I18nProvider initial="zh-CN"><List workspaceId="personal" workspaceMemberId="me" workspaceType="team" mode="square" /></I18nProvider>);
    const card = (await screen.findByText('My resource')).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: '更多' }));
    const menu = card.querySelector('.recent-projects__card-menu')!;
    expect(menu).toBeTruthy();
    const deletion = within(menu as HTMLElement).getByRole('menuitem', { name: '删除' });
    expect(deletion.querySelector('[data-icon="trash"]')).toBeTruthy();
    expect(deletion.className).toBe(within(menu as HTMLElement).getByRole('menuitem', { name: '取消发布' }).className);
    expect(deletion.className).not.toMatch(/danger/i);
    fireEvent.click(deletion);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(openTool).not.toHaveBeenCalled();
  });
});

it('uses the project remove-reference icon for received shares', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/resource-share/')
    ? Response.json({ resources: [{ shareId: 'share', resourceId: 'resource', homeWorkspaceId: 'origin', metadata: { title: 'Received', localId: 'received' } }] })
    : Response.json({ skills: [] })));
  render(<I18nProvider initial="zh-CN"><CloudSkillList workspaceId="personal" workspaceMemberId="me" workspaceType="team" mode="shared" /></I18nProvider>);
  await screen.findByText('Received');
  fireEvent.click(screen.getByRole('button', { name: '更多' }));
  const action = screen.getByRole('menuitem', { name: '从分享给我的删除' });
  expect(action.querySelector('[data-icon="minus-circle"]')).toBeTruthy();
  expect(action.className).toBe(screen.getByRole('menuitem', { name: '分享' }).className);
});
