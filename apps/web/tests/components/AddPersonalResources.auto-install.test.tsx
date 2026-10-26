// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { AddMcpDialog } from '../../src/components/AddMcpDialog';
import { AddSkillDialog } from '../../src/components/AddSkillDialog';

const uploadSkillToCloudMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/providers/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/providers/registry')>()),
  uploadSkillToCloud: uploadSkillToCloudMock,
}));
vi.mock('../../src/components/McpConfigForm', () => ({
  McpConfigForm: ({ onSubmit }: { onSubmit: (input: { label: string; description: string; config: string }) => void }) => (
    <button type="button" onClick={() => onSubmit({
      label: 'My Personal MCP', description: 'MCP desc',
      config: JSON.stringify({ type: 'http', url: 'https://mcp.example' }),
    })}>Submit MCP test config</button>
  ),
}));

const personalWorkspace = {
  workspaceId: 'personal', workspaceMemberId: 'personal-member', workspaceType: 'team',
  role: 'owner', lifecycleState: 'active', memberStatus: 'active',
  permissions: { canShareProjects: true, canWriteSyncedFiles: true },
} as WorkspaceCollabContext;
const response = (body: unknown, status = 200) => Response.json(body, { status });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  uploadSkillToCloudMock.mockReset();
});

describe('Personal Skill/MCP newly added resources', () => {
  it('creates and connects a new MCP before reporting success', async () => {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/mcp/cloud/check?')) return response({ exists: false });
      if (url === '/api/workspace/mcp/cloud') return response({
        template: { id: 'my-personal-mcp', resourceId: 'res-mcp-original', label: 'My Personal MCP', transport: 'http' },
      });
      if (url.startsWith('/api/workspace/mcp/cloud/res-mcp-original/install?')) {
        return response({ installed: true, serverId: 'cloud-local-server' });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<I18nProvider initial="zh-CN">
      <AddMcpDialog open onClose={onClose} onAdded={onAdded} workspaceContext={personalWorkspace} />
    </I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Submit MCP test config' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/mcp/cloud/res-mcp-original/install?home_workspace_id=personal', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({
        'x-od-workspace-id': 'personal', 'x-od-workspace-member-id': 'personal-member',
      }),
    }));
    expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cloud-local-server', label: 'My Personal MCP', transport: 'http',
    }));
  });

  it('does not pretend an MCP is connected when local install fails', async () => {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/mcp/cloud/check?')) return response({ exists: false });
      if (url === '/api/workspace/mcp/cloud') return response({
        template: { id: 'my-personal-mcp', resourceId: 'res-mcp-original', label: 'My Personal MCP', transport: 'http' },
      });
      if (url.includes('/res-mcp-original/install?')) return response({ error: 'LOCAL_MCP_UNAVAILABLE' }, 500);
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<I18nProvider initial="zh-CN">
      <AddMcpDialog open onClose={onClose} onAdded={onAdded} workspaceContext={personalWorkspace} />
    </I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Submit MCP test config' }));
    await screen.findByText(/自动连接失败/u);
    expect(onAdded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uploads then installs a Personal Skill instead of showing an uninstalled resource as added', async () => {
    uploadSkillToCloudMock.mockResolvedValue({ ok: true, title: 'my-skill', resourceId: 'res-skill-source' });
    const onClose = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/skills/cloud/check?')) return response({ exists: false });
      if (url.includes('/skills/cloud/res-skill-source/install?')) return response({ installed: true, localId: 'my-skill' });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<I18nProvider initial="zh-CN">
      <AddSkillDialog open onClose={onClose} workspaceContext={personalWorkspace} />
    </I18nProvider>);
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(['---\nname: skill-demo\n---\nbody'], 'SKILL.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'text', { value: async () => '---\nname: skill-demo\n---\nbody' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(uploadSkillToCloudMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/skills/cloud/res-skill-source/install?home_workspace_id=personal', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'x-od-workspace-id': 'personal' }),
    }));
  });
});
