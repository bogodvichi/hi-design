// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudMcpList } from '../../src/components/CloudMcpList';
import { McpLogo, resolveMcpLogoKey } from '../../src/components/McpLogo';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/components/McpLogo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/McpLogo')>();
  return { ...actual, resolveMcpLogoKey: vi.fn(actual.resolveMcpLogoKey) };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const modes = ['personal', 'team', 'square', 'shared'] as const;

describe('cloud MCP logo input normalization', () => {
  it.each(modes)('normalizes nullable %s metadata while retaining the existing logo and fallback', async (mode) => {
    const keys: unknown[] = [undefined, null, 'prism', 'legacy-logo', 17];
    const templates = keys.map((logoKey, index) => ({
      id: `mcp-${index}`, resourceId: `resource-${index}`, label: `MCP ${index}`,
      description: 'Test connector', transport: 'stdio', command: 'test-mcp', category: 'utilities',
      ownerMemberId: 'me', version: null, versionId: null, createdAt: '', updatedAt: '',
      ...(logoKey === undefined ? {} : { logoKey }),
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/mcp/servers') {
        return Response.json({ servers: [{ id: 'mcp-1', templateId: 'mcp-1', workspaceId: 'workspace', transport: 'stdio', enabled: true }] });
      }
      if (path.startsWith('/api/workspace/mcp/cloud?')) return Response.json({ templates });
      if (path === '/api/resource-share/shared-with-me?kind=mcp') {
        return Response.json({ resources: templates.map((template) => ({
          resourceId: template.resourceId, ownerMemberId: 'me', metadata: template,
          sharedByDisplayname: 'Other member', homeWorkspaceId: 'workspace',
        })) });
      }
      throw new Error(`Unexpected request: ${path}`);
    }));

    render(<I18nProvider initial="en"><CloudMcpList workspaceId="workspace" workspaceMemberId="me" workspaceType="team" mode={mode} /></I18nProvider>);
    await screen.findByText('MCP 4');

    // In-memory list items obey CloudMcpTemplate: logoKey is a string or absent,
    // never null or an unvalidated non-string from a catalog/share response.
    for (const index of [0, 1, 4]) {
      expect(resolveMcpLogoKey).toHaveBeenCalledWith(undefined, `mcp-${index}`);
    }
    expect(resolveMcpLogoKey).toHaveBeenCalledWith('prism', 'mcp-2');
    expect(resolveMcpLogoKey).toHaveBeenCalledWith('legacy-logo', 'mcp-3');

    for (const [index, key] of keys.entries()) {
      const card = screen.getByText(`MCP ${index}`).closest('article');
      const svg = card?.querySelector('svg[viewBox="0 0 48 48"]');
      const expectedKey = resolveMcpLogoKey(typeof key === 'string' ? key : undefined, `mcp-${index}`);
      expect(svg?.outerHTML).toBe(renderToStaticMarkup(<McpLogo logoKey={expectedKey} size={40} />));
    }
  });
});
