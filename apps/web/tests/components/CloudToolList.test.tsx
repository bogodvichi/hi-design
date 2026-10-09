// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudToolList } from '../../src/components/CloudToolList';

const { activateWorkspaceResourceMock, openWorkspaceTabMock } = vi.hoisted(() => ({
  activateWorkspaceResourceMock: vi.fn(() => false),
  openWorkspaceTabMock: vi.fn(),
}));

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => key,
  useI18n: () => ({ locale: 'zh-CN' }),
}));

vi.mock('../../src/components/WorkspaceTabsBar', () => ({
  activateWorkspaceResource: activateWorkspaceResourceMock,
  openWorkspaceTab: openWorkspaceTabMock,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  openWorkspaceTabMock.mockReset();
  activateWorkspaceResourceMock.mockReset();
  activateWorkspaceResourceMock.mockReturnValue(false);
});

describe('CloudToolList', () => {
  it('opens HiMind immediately and leaves SSO to the persistent tool tab', async () => {
    const launchUrl = 'http://himind.hikvision.com/api/v1/auth/hidesign/callback?ticket=opaque';
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tools: [{
          resourceId: 'himind-tool',
          ownerMemberId: 'member-1',
          url: 'http://himind.hikvision.com/login',
          name: 'HiMind',
          label: 'HiMind',
          description: '',
          createdAt: '2026-09-15T00:00:00.000Z',
          updatedAt: '2026-09-15T00:00:00.000Z',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ launchUrl, expiresIn: 60 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    const { container } = render(
      <CloudToolList
        workspaceId="workspace-1"
        workspaceMemberId="member-1"
        workspaceType="team"
      />,
    );

    expect(await screen.findByText('汇聚产品知识与设计经验，支持智能检索、图文问答与来源追溯。')).toBeTruthy();
    expect(container.querySelector('img[src="/himind/himind-icon.svg"]')).toBeTruthy();

    fireEvent.click(await screen.findByText('personalScope.cloudToolOpen'));

    expect(openWorkspaceTabMock).toHaveBeenCalledWith({
      kind: 'external',
      url: 'http://himind.hikvision.com/login',
      resourceKey: 'himind',
      title: 'HiMind',
    });
    expect(openWorkspaceTabMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(activateWorkspaceResourceMock).toHaveBeenCalledWith('himind');
  });

  it('does not gate opening HiMind on a launch response', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tools: [{
          resourceId: 'himind-tool',
          ownerMemberId: 'member-1',
          url: 'http://himind.hikvision.com/login',
          name: 'HiMind',
          label: 'HiMind',
          description: '',
          createdAt: '2026-09-15T00:00:00.000Z',
          updatedAt: '2026-09-15T00:00:00.000Z',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'OA login is required' },
      }), { status: 401, headers: { 'content-type': 'application/json' } }));

    render(
      <CloudToolList
        workspaceId="workspace-1"
        workspaceMemberId="member-1"
        workspaceType="team"
      />,
    );

    fireEvent.click(await screen.findByText('personalScope.cloudToolOpen'));

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(openWorkspaceTabMock).toHaveBeenCalledTimes(1);
    expect(openWorkspaceTabMock).toHaveBeenCalledWith({
      kind: 'external',
      url: 'http://himind.hikvision.com/login',
      resourceKey: 'himind',
      title: 'HiMind',
    });
  });

  it('reactivates an open HiMind tab without issuing a duplicate ticket', async () => {
    activateWorkspaceResourceMock.mockReturnValue(true);
    const launchUrl = 'http://himind.hikvision.com/api/v1/auth/hidesign/callback?ticket=renewed';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tools: [{
          resourceId: 'himind-tool',
          ownerMemberId: 'member-1',
          url: 'http://himind.hikvision.com/login',
          name: 'HiMind',
          label: 'HiMind',
          description: '',
          createdAt: '2026-09-15T00:00:00.000Z',
          updatedAt: '2026-09-15T00:00:00.000Z',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ launchUrl, expiresIn: 60 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    render(
      <CloudToolList
        workspaceId="workspace-1"
        workspaceMemberId="member-1"
        workspaceType="team"
      />,
    );
    fireEvent.click(await screen.findByText('personalScope.cloudToolOpen'));

    expect(activateWorkspaceResourceMock).toHaveBeenCalledWith('himind');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(openWorkspaceTabMock).not.toHaveBeenCalled();
  });

  it('restores the official community tools when cloud records are missing', async () => {
    const launchUrl = 'https://drw.hikvision.com/api/auth/platform?ticket=opaque&next=%2F';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tools: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ launchUrl, expiresIn: 60 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const { container } = render(
      <CloudToolList
        workspaceId="workspace-1"
        workspaceMemberId="member-1"
        workspaceType="team"
        mode="square"
        scope="public"
      />,
    );

    expect(await screen.findByText('HiMind')).toBeTruthy();
    expect(await screen.findByText('AI用研工作台')).toBeTruthy();
    expect(screen.getByText('提供AI可用性测试、真人可用性测试、AI启发式评估、体验度量等功能。')).toBeTruthy();
    expect(container.querySelector('img[src="/himind/himind-icon.svg"]')).toBeTruthy();
    expect(container.querySelector('img[src="/ai-research-workbench/logo.svg"]')).toBeTruthy();
    expect(container.querySelectorAll('article')).toHaveLength(2);
    expect(Array.from(container.querySelectorAll('article')).some((card) => card.className.includes('aiResearchCard'))).toBe(true);
    expect(container.querySelector('[class*="cardMenuBtn"]')).toBeNull();

    fireEvent.click(screen.getAllByText('personalScope.cloudToolOpen')[1]!);

    expect(activateWorkspaceResourceMock).toHaveBeenCalledWith('ai-research-workbench');
    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/auth/ai-research/launch', expect.anything());
    await waitFor(() => expect(openWorkspaceTabMock).toHaveBeenCalledWith({
      kind: 'external',
      url: 'https://drw.hikvision.com/',
      resourceKey: 'ai-research-workbench',
      title: 'AI用研工作台',
    }));
    expect(openWorkspaceTabMock).toHaveBeenCalledTimes(1);
  });

  it('filters community tools with the shared search query', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      tools: [
        {
          resourceId: 'data-visualizer', ownerMemberId: '', url: 'https://data.test',
          name: 'Data Visualizer', label: 'Data Visualizer', description: 'Analytics visualization tool',
          createdAt: '', updatedAt: '', publisherName: '王五',
        },
        {
          resourceId: 'design-helper', ownerMemberId: '', url: 'https://design.test',
          name: 'Design Helper', label: 'Design Helper', description: 'Design workflow tool',
          createdAt: '', updatedAt: '',
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const { container } = render(
      <CloudToolList
        workspaceId="workspace-1"
        workspaceMemberId="member-1"
        workspaceType="team"
        mode="square"
        scope="public"
        searchQuery="analytics"
      />,
    );

    expect(await screen.findByText('Data Visualizer')).toBeTruthy();
    expect(container.querySelector('img[src="/community/default-tool-logo.svg"]')).toBeTruthy();
    expect(screen.getByText('王五')).toBeTruthy();
    expect(screen.getByLabelText('使用人数 0, 使用次数 0')).toBeTruthy();
    expect(screen.queryByText('Design Helper')).toBeNull();
    expect(screen.queryByText('HiMind')).toBeNull();
    expect(screen.queryByText('AI用研工作台')).toBeNull();
  });

  it('dismisses the card menu without swallowing the outside click', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      tools: [{
        resourceId: 'owned-tool', ownerMemberId: 'member-1', url: 'https://tool.test',
        name: 'Owned tool', label: 'Owned tool', description: 'Owned tool description',
        createdAt: '', updatedAt: '',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const onOutsideClick = vi.fn();
    const { container } = render(
      <>
        <CloudToolList
          workspaceId="workspace-1"
          workspaceMemberId="member-1"
          workspaceType="team"
        />
        <button type="button" onClick={onOutsideClick}>Other module</button>
      </>,
    );

    expect(await screen.findByText('Owned tool')).toBeTruthy();
    const menuButton = container.querySelector<HTMLButtonElement>('[class*="cardMenuBtn"]');
    expect(menuButton).toBeTruthy();
    fireEvent.click(menuButton!);
    expect(screen.getByText('personalScope.cloudToolDelete')).toBeTruthy();

    const outsideButton = screen.getByRole('button', { name: 'Other module' });
    fireEvent.pointerDown(outsideButton);
    fireEvent.click(outsideButton);

    expect(screen.queryByText('personalScope.cloudToolDelete')).toBeNull();
    expect(onOutsideClick).toHaveBeenCalledTimes(1);
  });

  it('shows card actions for the current member tool in My Publishes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      tools: [{
        resourceId: 'owned-published-tool', ownerMemberId: 'member-1', url: 'https://tool.test',
        name: 'Owned published tool', label: 'Owned published tool', description: 'Owned tool description',
        createdAt: '', updatedAt: '',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const { container } = render(
      <CloudToolList
        workspaceId="workspace-1"
        workspaceMemberId="member-1"
        workspaceType="team"
        ownerMemberId="member-1"
        mode="square"
        scope="public"
      />,
    );

    expect(await screen.findByText('Owned published tool')).toBeTruthy();
    const menuButtons = container.querySelectorAll<HTMLButtonElement>('[class*="cardMenuBtn"]');
    expect(menuButtons).toHaveLength(1);

    fireEvent.click(menuButtons[0]!);
    expect(screen.getByText('common.delete')).toBeTruthy();
    fireEvent.click(screen.getByText('squareScope.unpublish'));

    expect(screen.getByText('squareScope.unpublishConfirmTitle')).toBeTruthy();
    expect(screen.getByText('squareScope.unpublishConfirmDesc')).toBeTruthy();
    expect(screen.queryByText('personalScope.cloudToolDelete')).toBeNull();

    fireEvent.click(screen.getByText('common.cancel'));
    fireEvent.click(menuButtons[0]!);
    fireEvent.click(screen.getByText('common.delete'));

    expect(screen.getByText('squareScope.deleteConfirmTitle')).toBeTruthy();
    expect(screen.getByText('squareScope.deleteConfirmDesc')).toBeTruthy();
  });

  it('keeps official tool authors while showing owner actions in My Publishes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      tools: [
        {
          resourceId: 'himind-tool-record', ownerMemberId: 'member-1',
          url: 'http://himind.hikvision.com/login', name: 'HiMind', label: 'HiMind',
          description: '', publisherName: '张亚婷5', createdAt: '', updatedAt: '',
        },
        {
          resourceId: 'ai-research-tool-record', ownerMemberId: 'member-1',
          url: 'https://www.hikvision.com', name: '海康威视', label: '海康威视',
          description: '', publisherName: '石敬超', createdAt: '', updatedAt: '',
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const { container } = render(
      <CloudToolList
        workspaceId="workspace-1"
        workspaceMemberId="member-1"
        workspaceType="team"
        ownerMemberId="member-1"
        mode="square"
        scope="public"
      />,
    );

    expect(await screen.findByText('张亚婷5')).toBeTruthy();
    expect(screen.getByText('石敬超')).toBeTruthy();
    expect(screen.getByText('AI用研工作台')).toBeTruthy();
    expect(container.querySelectorAll('[class*="cardMenuBtn"]')).toHaveLength(2);
  });

  it('opens AI research before a failing background call and never gates the page', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tools: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'AI research login ticket could not be issued' },
      }), { status: 502, headers: { 'content-type': 'application/json' } }));

    render(
      <CloudToolList
        workspaceId="workspace-1"
        workspaceMemberId="member-1"
        workspaceType="team"
        mode="square"
        scope="public"
      />,
    );

    fireEvent.click((await screen.findAllByText('personalScope.cloudToolOpen'))[1]!);

    expect(openWorkspaceTabMock).toHaveBeenCalledWith({
      kind: 'external', url: 'https://drw.hikvision.com/',
      resourceKey: 'ai-research-workbench', title: 'AI用研工作台',
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
