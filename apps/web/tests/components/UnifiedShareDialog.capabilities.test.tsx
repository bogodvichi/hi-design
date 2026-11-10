// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as toastContext from '../../src/components/toast-context';
import { UnifiedShareDialog } from '../../src/components/UnifiedShareDialog';
import { I18nProvider } from '../../src/i18n';
import { workspaceContextFixture } from '../helpers/workspace-context';

const RUNTIME_PUBLIC_BASE = 'https://hdw.example.test/hik-plugin/hidesign-web';

beforeEach(() => {
  stubHdwFetch();
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

function stubHdwFetch(options: {
  existingData?: unknown;
  generatedData?: unknown;
  syncIntentStatus?: number;
  syncIntentData?: unknown;
} = {}) {
  const {
    existingData = null,
    generatedData = { token: 'generated-token' },
    syncIntentStatus = 200,
    syncIntentData = { ok: true, syncState: 'synced', publishedVersion: 1 },
  } = options;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/hdw/runtime-config') {
      return Response.json({ sharePublicBase: `${RUNTIME_PUBLIC_BASE}/` });
    }
    if (
      url === '/api/projects/project-1/collab/sync-intent'
      && init?.method === 'POST'
    ) {
      return Response.json(syncIntentData, { status: syncIntentStatus });
    }
    if (url.startsWith('/api/hdw/api/share-link?')) {
      return Response.json({ code: 0, data: existingData });
    }
    if (url === '/api/hdw/api/share-link/generate' && init?.method === 'POST') {
      return Response.json({ code: 0, data: generatedData });
    }
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function getEnabledGenerateButton(): Promise<HTMLButtonElement> {
  const button = screen.getByRole('button', { name: '生成链接' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
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

  it('uploads the personal project before generating a team link', async () => {
    const workspaceContext = workspaceContextFixture({
      workspaceId: 'kt7pwus8k23k0sy2x52avt7xv',
      workspaceMemberId: 'member-1',
      role: 'member',
    });
    const fetchMock = stubHdwFetch({ generatedData: { token: 'team-token' } });
    renderDialog({ workspaceContext, canPublishToCommunity: false, canShareFile: false });
    fireEvent.click(await getEnabledGenerateButton());
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        ([url]) => String(url) === '/api/hdw/api/share-link/generate',
      )).toBe(true);
    });

    const syncIndex = fetchMock.mock.calls.findIndex(
      ([url]) => String(url) === '/api/projects/project-1/collab/sync-intent',
    );
    const generateIndex = fetchMock.mock.calls.findIndex(
      ([url]) => String(url) === '/api/hdw/api/share-link/generate',
    );
    expect(syncIndex).toBeGreaterThan(-1);
    expect(generateIndex).toBeGreaterThan(syncIndex);

    const syncCall = fetchMock.mock.calls[syncIndex];
    const syncInit = syncCall?.[1] as RequestInit;
    const syncHeaders = new Headers(syncInit.headers);
    expect(syncHeaders.get('x-od-workspace-id')).toBe('kt7pwus8k23k0sy2x52avt7xv');
    expect(syncHeaders.get('x-od-workspace-member-id')).toBe('member-1');
    expect(JSON.parse(String(syncInit.body))).toEqual({
      event: 'project_team_share_requested',
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/move'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/workspace-scope'))).toBe(false);

    expect(await screen.findByDisplayValue(
      `${RUNTIME_PUBLIC_BASE}/hdw/share/team-token`,
    )).toBeTruthy();
  });

  it('generates a member link from the published team project without uploading read-only content', async () => {
    const fetchMock = stubHdwFetch({ syncIntentStatus: 403 });
    renderDialog({
      workspaceContext: workspaceContextFixture({ workspaceId: 'workspace-1', workspaceMemberId: 'viewer', role: 'member' }),
      canPublishToCommunity: false, canShareFile: false, publishBeforeGenerate: false,
    });
    fireEvent.click(await getEnabledGenerateButton());
    expect(await screen.findByDisplayValue(`${RUNTIME_PUBLIC_BASE}/hdw/share/generated-token`)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sync-intent'))).toBe(false);
  });

  it('reports a generation error instead of claiming there is no share link', async () => {
    const notify = vi.spyOn(toastContext, 'notifyToast').mockImplementation(() => {});
    stubHdwFetch({ generatedData: null });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/hdw/runtime-config') return Response.json({ sharePublicBase: RUNTIME_PUBLIC_BASE });
      if (init?.method === 'POST') return Response.json({ code: -1, error: 'No HTML files found in the project manifest' });
      return Response.json({ code: 0, data: null });
    });
    renderDialog({ canPublishToCommunity: false, canShareFile: false });
    fireEvent.click(await getEnabledGenerateButton());
    await waitFor(() => expect(screen.getByRole('button', { name: '生成链接' })).not.toBeDisabled());
    expect(screen.queryByText('暂无分享链接')).toBeNull();
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error', message: expect.not.stringContaining('暂无分享链接') }));
  });

  it('uses the runtime workspace and member identity for every owner request', async () => {
    const runtimeWorkspaceId = 'kt7pwus8k23k0sy2x52avt7xv';
    const workspaceContext = workspaceContextFixture({
      workspaceId: runtimeWorkspaceId,
      workspaceMemberId: 'member-shared-team',
      role: 'member',
    });
    const fetchMock = stubHdwFetch({ generatedData: { token: 'owner-token' } });
    renderDialog({
      workspaceId: 'stale-workspace-prop',
      workspaceContext,
      canPublishToCommunity: false,
      canShareFile: false,
    });

    const existingLinkCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => String(url).startsWith('/api/hdw/api/share-link?'),
      );
      expect(call).toBeTruthy();
      return call!;
    });
    const existingLinkUrl = new URL(
      String(existingLinkCall[0]),
      'https://daemon.example.test',
    );
    const existingLinkHeaders = new Headers(
      (existingLinkCall[1] as RequestInit | undefined)?.headers,
    );
    expect(existingLinkUrl.searchParams.get('workspace_id')).toBe(runtimeWorkspaceId);
    expect(existingLinkHeaders.get('x-od-workspace-id')).toBe(runtimeWorkspaceId);
    expect(existingLinkHeaders.get('x-od-workspace-member-id')).toBe('member-shared-team');

    fireEvent.click(await getEnabledGenerateButton());
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        ([url]) => String(url) === '/api/hdw/api/share-link/generate',
      )).toBe(true);
    });

    const syncCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/projects/project-1/collab/sync-intent',
    );
    const syncHeaders = new Headers((syncCall?.[1] as RequestInit | undefined)?.headers);
    expect(syncHeaders.get('x-od-workspace-id')).toBe(runtimeWorkspaceId);
    expect(syncHeaders.get('x-od-workspace-member-id')).toBe('member-shared-team');

    const generateCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/hdw/api/share-link/generate',
    );
    const generateHeaders = new Headers(
      (generateCall?.[1] as RequestInit | undefined)?.headers,
    );
    expect(generateHeaders.get('x-od-workspace-id')).toBe(runtimeWorkspaceId);
    expect(generateHeaders.get('x-od-workspace-member-id')).toBe('member-shared-team');
    expect(JSON.parse(String((generateCall?.[1] as RequestInit | undefined)?.body))).toEqual({
      project_id: 'project-1',
      workspace_id: runtimeWorkspaceId,
      public_base: RUNTIME_PUBLIC_BASE,
    });
  });

  it('short-circuits link generation when the team upload fails', async () => {
    const workspaceContext = workspaceContextFixture({
      workspaceId: 'kt7pwus8k23k0sy2x52avt7xv',
      workspaceMemberId: 'member-1',
      role: 'member',
    });
    const fetchMock = stubHdwFetch({
      syncIntentStatus: 502,
      syncIntentData: { error: 'TEAM_PROJECT_PUBLISH_UNAVAILABLE' },
    });
    renderDialog({ workspaceContext, canPublishToCommunity: false, canShareFile: false });

    fireEvent.click(await getEnabledGenerateButton());

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        ([url]) => String(url) === '/api/projects/project-1/collab/sync-intent',
      )).toBe(true);
      expect(screen.getByRole('button', { name: '生成链接' })).not.toBeDisabled();
    });
    expect(fetchMock.mock.calls.some(
      ([url]) => String(url) === '/api/hdw/api/share-link/generate',
    )).toBe(false);
  });

  it('requires confirmed sync state before generating the link', async () => {
    const workspaceContext = workspaceContextFixture({
      workspaceId: 'kt7pwus8k23k0sy2x52avt7xv',
      workspaceMemberId: 'member-1',
      role: 'member',
    });
    const fetchMock = stubHdwFetch({
      syncIntentData: { ok: true, syncState: 'pending_upload' },
    });
    renderDialog({ workspaceContext, canPublishToCommunity: false, canShareFile: false });

    fireEvent.click(await getEnabledGenerateButton());

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        ([url]) => String(url) === '/api/projects/project-1/collab/sync-intent',
      )).toBe(true);
      expect(screen.getByRole('button', { name: '生成链接' })).not.toBeDisabled();
    });
    expect(fetchMock.mock.calls.some(
      ([url]) => String(url) === '/api/hdw/api/share-link/generate',
    )).toBe(false);
  });

  it('never exposes generation to a guest, even if the link has not been created', async () => {
    renderDialog({ canPublishToCommunity: false, canShareFile: false, canGenerateLink: false });
    expect(screen.queryByRole('button', { name: '生成链接' })).toBeNull();
    expect(await screen.findByText('暂无分享链接，请联系团队成员生成')).toBeInTheDocument();
  });

  it('generates a shared-with-me link without owner workspace identity headers', async () => {
    const fetchMock = stubHdwFetch({ generatedData: { token: 'shared-token' } });

    renderDialog({
      workspaceId: 'owner-workspace',
      workspaceContext: null,
      canPublishToCommunity: false,
      canShareFile: false,
    });

    fireEvent.click(await getEnabledGenerateButton());

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
      public_base: RUNTIME_PUBLIC_BASE,
    });
    expect(fetchMock.mock.calls.some(
      ([input]) => String(input) === '/api/projects/project-1/collab/sync-intent',
    )).toBe(false);
  });

  it('re-syncs the project before every link generation', async () => {
    const workspaceContext = workspaceContextFixture({
      workspaceId: 'kt7pwus8k23k0sy2x52avt7xv',
      workspaceMemberId: 'member-1',
      role: 'member',
    });
    const fetchMock = stubHdwFetch();
    renderDialog({ workspaceContext, canPublishToCommunity: false, canShareFile: false });

    fireEvent.click(await getEnabledGenerateButton());
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(
        ([url]) => String(url) === '/api/projects/project-1/collab/sync-intent',
      )).toHaveLength(1);
    });
    await screen.findByDisplayValue(`${RUNTIME_PUBLIC_BASE}/hdw/share/generated-token`);

    fireEvent.click(screen.getByRole('button', { name: '重新生成链接' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(
        ([url]) => String(url) === '/api/projects/project-1/collab/sync-intent',
      )).toHaveLength(2);
    });
  });

  it('requests the runtime share base and prefers the full URL returned by HDW', async () => {
    const fullUrl = 'https://share.example.test/published/existing-token';
    const fetchMock = stubHdwFetch({
      existingData: {
        token: 'existing-token',
        url: fullUrl,
      },
    });

    renderDialog({ canPublishToCommunity: false, canShareFile: false });

    expect(await screen.findByDisplayValue(fullUrl)).toBeTruthy();
    const configCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/hdw/runtime-config',
    );
    expect(configCall?.[1]).toMatchObject({ cache: 'no-store' });

    const shareLinkCall = fetchMock.mock.calls.find(
      ([input]) => String(input).startsWith('/api/hdw/api/share-link?'),
    );
    expect(shareLinkCall).toBeTruthy();
    const requestUrl = new URL(
      String(shareLinkCall?.[0]),
      'https://daemon.example.test',
    );
    expect(requestUrl.searchParams.get('project_id')).toBe('project-1');
    expect(requestUrl.searchParams.get('workspace_id')).toBe('workspace-1');
    expect(requestUrl.searchParams.get('public_base')).toBe(RUNTIME_PUBLIC_BASE);
  });

  it('shows the generate affordance when HDW returns a null data payload', async () => {
    stubHdwFetch({ existingData: null });

    renderDialog({ canPublishToCommunity: false, canShareFile: false });

    expect(await screen.findByText('点击右下角的"生成链接"以创建分享链接。')).toBeTruthy();
    expect(await getEnabledGenerateButton()).toBeTruthy();
  });
});
