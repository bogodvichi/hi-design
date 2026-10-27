// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudSkillList } from '../../src/components/CloudSkillList';
import { I18nProvider } from '../../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/skills') return Response.json({ skills: [] });
    if (url.startsWith('/api/workspace/skills/cloud?')) return Response.json({ skills: [
      {
        resourceId: 'community-reference', localId: 'source-skill', title: 'Referenced Skill',
        ownerMemberId: 'publisher', homeWorkspaceId: 'team', homeWorkspaceMemberId: 'publisher',
        homeWorkspaceType: 'team', canManage: true, publicationSourceType: 'reference',
        communitySourceResourceId: 'source-id', version: 1, createdAt: '', updatedAt: '',
      },
      {
        resourceId: 'community-import', localId: 'imported-skill', title: 'Uploaded Skill',
        ownerMemberId: 'publisher', homeWorkspaceId: 'team', homeWorkspaceMemberId: 'publisher',
        homeWorkspaceType: 'team', canManage: true, publicationSourceType: 'local_import',
        version: 1, createdAt: '', updatedAt: '',
      },
    ] });
    return Response.json({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<I18nProvider initial="zh-CN"><CloudSkillList
    workspaceId="team" workspaceMemberId="publisher" workspaceType="team"
    mode="square" scope="public"
  /></I18nProvider>);
  return fetchMock;
}

function openMenu(title: string) {
  const article = screen.getByText(title).closest('article');
  expect(article).toBeTruthy();
  fireEvent.click(within(article!).getByRole('button', { name: '更多' }));
}

describe('community Skill publication menus', () => {
  it('reference publication offers cancellation/manual update but not destructive deletion', async () => {
    const fetchMock = fixture();
    await screen.findByText('Referenced Skill');
    openMenu('Referenced Skill');
    expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '更新发布' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '取消发布' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/个人或团队中的源资源保留/)).toBeTruthy();
    expect(within(dialog).getByText(/如需重新发布请从源路径重新选择/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消发布' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/skills/cloud/community-reference/unpublish',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('local-import publication offers cancellation, but not delete or update', async () => {
    const fetchMock = fixture();
    await screen.findByText('Uploaded Skill');
    openMenu('Uploaded Skill');
    expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '更新发布' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: '取消发布' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/本地导入的社区资源将被移除/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消发布' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/skills/cloud/community-import/unpublish',
      expect.objectContaining({ method: 'POST' }),
    ));
  });
});
