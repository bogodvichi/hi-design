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
  it('opens the HiMind SSO callback in an embedded workspace tab', async () => {
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
    await waitFor(() => expect(openWorkspaceTabMock).toHaveBeenCalledWith({
      kind: 'external',
      url: 'http://himind.hikvision.com/login',
      bootstrapUrl: launchUrl,
      resourceKey: 'himind',
      title: 'HiMind',
    }));
    expect(activateWorkspaceResourceMock).toHaveBeenCalledWith('himind');
  });

  it('opens the HiMind tab even when SSO ticket creation fails', async () => {
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

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    expect(openWorkspaceTabMock).toHaveBeenCalledTimes(1);
    expect(openWorkspaceTabMock).toHaveBeenCalledWith({
      kind: 'external',
      url: 'http://himind.hikvision.com/login',
      resourceKey: 'himind',
      title: 'HiMind',
    });
  });

  it('refreshes the SSO ticket when activating an open HiMind tab', async () => {
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
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/himind/launch',
      { method: 'POST' },
    ));
    expect(openWorkspaceTabMock).toHaveBeenCalledWith({
      kind: 'external',
      url: 'http://himind.hikvision.com/login',
      bootstrapUrl: launchUrl,
      resourceKey: 'himind',
      title: 'HiMind',
    });
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

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/ai-research/launch',
      { method: 'POST' },
    ));
    await waitFor(() => expect(openWorkspaceTabMock).toHaveBeenCalledWith({
      kind: 'external',
      url: 'https://drw.hikvision.com/',
      bootstrapUrl: launchUrl,
      resourceKey: 'ai-research-workbench',
      title: 'AI用研工作台',
    }));
    expect(openWorkspaceTabMock).toHaveBeenCalledTimes(1);
  });

  it('does not open the AI research login page when ticket creation fails', async () => {
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'AI research login ticket could not be issued',
    );
    expect(openWorkspaceTabMock).not.toHaveBeenCalled();
  });
});
