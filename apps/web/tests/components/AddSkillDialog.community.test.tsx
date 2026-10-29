// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { AddSkillDialog } from '../../src/components/AddSkillDialog';

vi.mock('../../src/collab/useWorkspaceContext', async (original) => ({
  ...await original<typeof import('../../src/collab/useWorkspaceContext')>(),
  useWorkspaceContext: () => ({ context: null, loading: false }),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('adding a community Skill to a team', () => {
  it('lists community Skills and installs using the target team and original source', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/install?')) return pending;
      if (url.startsWith('/api/workspace/skills/cloud?')) {
        if (new URL(url, 'http://localhost').searchParams.get('source') === 'maas-skillhub') {
          return Promise.resolve(Response.json({ skills: [] }));
        }
        return Promise.resolve(Response.json({ skills: [{ resourceId: 'publication', localId: 'review',
          title: 'Community review', ownerMemberId: 'author', provider: 'hdw', homeWorkspaceId: 'source-team' }] }));
      }
      return Promise.resolve(Response.json({ skills: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const context = { workspaceId: 'target-team', workspaceMemberId: 'target-member', workspaceType: 'team',
      role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: {} } as WorkspaceCollabContext;
    render(<I18nProvider initial="zh-CN"><AddSkillDialog open onClose={vi.fn()} workspaceContext={context} /></I18nProvider>);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: '社区' }));
    expect(await screen.findByText('Community review')).toBeTruthy();
    expect(screen.queryByText('相关内容将显示在这里。')).toBeNull();
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/skills/cloud/publication/install?home_workspace_id=source-team&source=hdw',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({
        'x-od-workspace-id': 'target-team', 'x-od-workspace-member-id': 'target-member',
      }) }));
    expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true);
    await act(async () => { finish(Response.json({ installed: true, localId: 'review' })); });
    expect(await screen.findByText('已添加')).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(false);
  });
});
