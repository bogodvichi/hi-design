// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnifiedShareDialog } from '../../src/components/UnifiedShareDialog';
import { I18nProvider } from '../../src/i18n';
import { workspaceContextFixture } from '../helpers/workspace-context';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDialog(props: Partial<ComponentProps<typeof UnifiedShareDialog>> = {}) {
  return render(
    <I18nProvider initial="zh-CN">
      <UnifiedShareDialog
        projectId="project-1"
        workspaceId="workspace-1"
        projectName="项目一"
        workspaceContext={null}
        onClose={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('UnifiedShareDialog capabilities', () => {
  it('shows community, file and link sharing for a project creator', () => {
    renderDialog({ canPublishToCommunity: true, canShareFile: true });

    expect(screen.getByRole('tab', { name: '社区' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '分享文件' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '分享链接' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '社区' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows only share link for an allowed non-creator role', () => {
    renderDialog({ canPublishToCommunity: false, canShareFile: false });

    expect(screen.queryByRole('tab', { name: '社区' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '分享文件' })).toBeNull();
    expect(screen.getByRole('tab', { name: '分享链接' }).getAttribute('aria-selected')).toBe('true');
  });

  it('generates a link for an existing team project without implicitly moving its visibility', async () => {
    const workspaceContext = workspaceContextFixture({
      workspaceId: 'workspace-1',
      workspaceMemberId: 'member-1',
      role: 'member',
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/hdw/api/share-link/generate') {
        return Response.json({ code: 0, data: { token: 'team-token' } });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDialog({ workspaceContext, canPublishToCommunity: false, canShareFile: false });
    fireEvent.click(screen.getByRole('button', { name: '生成链接' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/hdw/api/share-link/generate')).toBe(true));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/move'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/workspace-scope'))).toBe(false);
  });

  it('never exposes generation to a guest, even if the link has not been created', async () => {
    renderDialog({ canPublishToCommunity: false, canShareFile: false, canGenerateLink: false });
    expect(screen.queryByRole('button', { name: '生成链接' })).toBeNull();
    expect(await screen.findByText('暂无分享链接，请联系团队成员生成')).toBeInTheDocument();
  });

  it('generates a shared-with-me link without owner workspace identity headers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/hdw/api/share-link/generate') {
        return new Response(JSON.stringify({ code: 0, data: { token: 'shared-token' } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderDialog({
      workspaceId: 'owner-workspace',
      workspaceContext: null,
      canPublishToCommunity: false,
      canShareFile: false,
    });

    fireEvent.click(screen.getByRole('button', { name: '生成链接' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/hdw/api/share-link/generate')).toBe(true);
    });

    const generateCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/hdw/api/share-link/generate',
    );
    expect(generateCall).toBeTruthy();
    const init = generateCall?.[1] as RequestInit;
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      project_id: 'project-1',
      workspace_id: 'owner-workspace',
    });
  });
});
