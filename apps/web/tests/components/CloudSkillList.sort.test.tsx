// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { I18nProvider } from '../../src/i18n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname !== '/api/workspace/skills/cloud') return Response.json({ skills: [] });
    const skills = url.searchParams.get('source') === 'hdw' ? [
      { resourceId: 'popular', title: 'Popular review', category: 'development_tools', peopleCount: 10, actionCount: 11, updatedAt: '2026-10-27T00:00:00Z' },
    ] : [
      { resourceId: 'recent', title: 'Recent review', category: 'other', peopleCount: 1, actionCount: 100, updatedAt: '2026-10-29T00:00:00Z' },
      { resourceId: 'middle', title: 'Middle review', category: 'development_tools', peopleCount: 10, actionCount: 12, updatedAt: '2026-10-28T00:00:00Z' },
    ];
    return Response.json({ skills: skills.map((skill) => ({ ...skill, localId: skill.resourceId, ownerMemberId: 'author' })) });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const titles = () => screen.getAllByRole('article').map((card) => card.querySelector('strong')?.textContent);
const chooseSort = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: '排序' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name }));
};

it('sorts the merged catalog after Category, combines search and category without fetching again', async () => {
  render(<I18nProvider initial="zh-CN"><CloudSkillList workspaceId="workspace" workspaceMemberId="me"
    workspaceType="team" mode="square" scope="public" sourceProvider="all" /></I18nProvider>);
  await act(async () => {});
  const original = titles();
  const category = screen.getByRole('button', { name: '分类' });
  const sort = screen.getByRole('button', { name: '排序' });
  expect(category.compareDocumentPosition(sort) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  chooseSort('最受欢迎');
  expect(titles()).toEqual(['Middle review', 'Popular review', 'Recent review']);
  chooseSort('最近更新');
  expect(titles()).toEqual(['Recent review', 'Middle review', 'Popular review']);
  fireEvent.click(category);
  fireEvent.click(screen.getByRole('menuitemradio', { name: '开发工具 (2)' }));
  expect(screen.getByRole('button', { name: '开发工具' })).toBe(category);
  expect(titles()).toEqual(['Middle review', 'Popular review']);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Popular' } });
  expect(titles()).toEqual(['Popular review']);
  fireEvent.click(category);
  fireEvent.click(screen.getByRole('menuitemradio', { name: '全部 (1)' }));
  expect(screen.getByRole('button', { name: '分类' })).toBe(category);
  expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).startsWith('/api/workspace/skills/cloud?'))).toHaveLength(2);
  expect(original).toEqual(['Recent review', 'Middle review', 'Popular review']);
});

it('renders sorting in the header portal and closes the menu on Escape or outside click', async () => {
  const header = document.createElement('div');
  document.body.append(header);
  try {
    render(<I18nProvider initial="zh-CN"><CloudSkillList workspaceId="workspace" workspaceMemberId="me"
      workspaceType="team" mode="square" scope="public" sourceProvider="all"
      controlsPortalTarget={header} externalSearchQuery="" /></I18nProvider>);
    await act(async () => {});
    expect(header.contains(screen.getByRole('button', { name: '排序' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '排序' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '排序' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  } finally { header.remove(); }
});
