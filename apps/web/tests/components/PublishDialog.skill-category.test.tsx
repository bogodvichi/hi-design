// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { PublishDialog } from '../../src/components/PublishDialog';

const uploadSkillToCloudMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/providers/registry', () => ({
  openFolderDialog: vi.fn(),
  uploadSkillToCloud: uploadSkillToCloudMock,
}));

vi.mock('../../src/state/projects', () => ({
  listProjects: vi.fn(async () => []),
}));

vi.mock('../../src/collab/useWorkspaceContext', () => ({
  useWorkspaceContext: () => ({
    context: {
      workspaceId: 'workspace-1',
      workspaceType: 'team',
      workspaceMemberId: 'member-1',
      role: 'owner',
      memberStatus: 'active',
      lifecycleState: 'active',
      permissions: {},
    },
    loading: false,
  }),
}));

vi.mock('../../src/collab/workspace-identity', () => ({
  workspaceProjectHeaders: () => ({
    'x-od-workspace-id': 'workspace-1',
    'x-od-workspace-member-id': 'member-1',
    'x-od-workspace-type': 'team',
  }),
}));

vi.mock('../../src/utils/platform', () => ({
  isMacPlatform: () => false,
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PublishDialog Skill category', () => {
  beforeEach(() => {
    uploadSkillToCloudMock.mockReset();
    uploadSkillToCloudMock.mockResolvedValue({ ok: true, title: 'my-skill' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ exists: false })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requires a category and sends the canonical category with community publishing', async () => {
    const onPublish = vi.fn();
    render(
      <I18nProvider initial="zh-CN">
        <PublishDialog
          initialCategory="skill"
          onClose={() => {}}
          onPublish={onPublish}
        />
      </I18nProvider>,
    );

    const publishButton = screen.getByRole('button', { name: '确认发布' });
    expect(publishButton).toBeDisabled();

    const file = new File([
      '---\nname: my-skill\ndescription: Example\n---\n# Skill',
    ], 'SKILL.md', { type: 'text/markdown' });
    if (typeof file.text !== 'function') {
      Object.defineProperty(file, 'text', {
        value: async () => '---\nname: my-skill\ndescription: Example\n---\n# Skill',
      });
    }
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('SKILL.md')).toBeTruthy());
    expect(publishButton).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: '开发工具' }));
    await waitFor(() => expect(publishButton).not.toBeDisabled());
    fireEvent.click(publishButton);

    await waitFor(() => expect(uploadSkillToCloudMock).toHaveBeenCalledTimes(1));
    expect(uploadSkillToCloudMock.mock.calls[0]?.[2]).toBe('public');
    expect(uploadSkillToCloudMock.mock.calls[0]?.[3]).toBe('development_tools');
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
      name: 'my-skill',
      category: 'development_tools',
    })));
  });
});
