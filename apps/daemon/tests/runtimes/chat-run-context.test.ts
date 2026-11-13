import { describe, expect, it } from 'vitest';

import {
  mergeRunContextSelections,
  normalizeRunContextSelection,
  normalizeWorkspaceContextItems,
  renderRunContextPrompt,
  renderSelectedMcpRunContextPrompt,
} from '../../src/runtimes/chat-run-context.js';

describe('chat run context helpers', () => {
  it('preserves the latest viewing path when normalizing and merging run context', () => {
    expect(normalizeRunContextSelection({ currentFile: ' brief.md ' }).currentFile).toBe('brief.md');
    expect(normalizeRunContextSelection({ currentFile: 42 }).currentFile).toBeUndefined();
    expect(mergeRunContextSelections(
      { currentFile: 'old.md', mcpServerIds: ['docs'] },
      { currentFile: 'brief.md' },
    )).toEqual({ currentFile: 'brief.md', mcpServerIds: ['docs'] });
  });

  it.each([renderRunContextPrompt, renderSelectedMcpRunContextPrompt])(
    'keeps viewing context separate from explicit references in each prompt mode',
    (renderPrompt) => {
      const prompt = renderPrompt({ currentFile: 'brief.md' }, {});
      expect(prompt).toContain('### Currently viewed file');
      expect(prompt).toContain('"brief.md"');
      expect(prompt).toContain('not an explicit attachment or an instruction to edit');
      expect(prompt).toContain('Read it only when relevant');
      expect(prompt).not.toContain('1.');
    },
  );

  it('normalizes workspace context items and dedupes by kind/id', () => {
    expect(normalizeWorkspaceContextItems([
      { kind: 'browser', id: ' tab-1 ', label: ' Docs ', url: ' https://example.com/docs ' },
      { kind: 'browser', id: 'tab-1', label: 'Duplicate' },
      { kind: 'unknown', id: 'x', label: 'Ignored' },
      { kind: 'file', id: 'file-1', label: 'App', path: 'src/app.ts' },
      null,
    ])).toEqual([
      {
        kind: 'browser',
        id: 'tab-1',
        label: 'Docs',
        url: 'https://example.com/docs',
      },
      {
        kind: 'file',
        id: 'file-1',
        label: 'App',
        path: 'src/app.ts',
      },
    ]);
  });

  it('merges project metadata context before per-run context without duplicate ids', () => {
    expect(mergeRunContextSelections(
      { pluginIds: ['brand-kit'], connectorIds: ['figma'] },
      { pluginIds: ['brand-kit', 'motion'], mcpServerIds: ['browser'] },
    )).toEqual({
      pluginIds: ['brand-kit', 'motion'],
      mcpServerIds: ['browser'],
      connectorIds: ['figma'],
    });
  });

  it('renders selected workspace and connector context for the agent prompt', () => {
    const prompt = renderRunContextPrompt(
      {
        workspaceItems: [
          {
            kind: 'terminal',
            id: 'term-1',
            label: 'Dev server',
            tabId: 'terminal-tab',
          },
        ],
        connectorIds: ['figma'],
      },
      {
        contextConnectors: [
          {
            id: 'figma',
            name: 'Figma',
            provider: 'figma',
            status: 'connected',
          },
        ],
      },
    );

    expect(prompt).toContain('## Selected run context');
    expect(prompt).toContain('terminal: Dev server (`term-1`)');
    expect(prompt).toContain('Selected connectors');
    expect(prompt).toContain('- Figma (`figma`)');
  });

  it('treats a selected MCP as preferred when relevant, not as a mandatory no-op call', () => {
    const prompt = renderRunContextPrompt(
      { mcpServerIds: ['himind'] },
      { contextMcpServers: [{ id: 'himind', label: 'HiMind' }] },
    );

    expect(prompt).toContain('Use a selected server when it is relevant to the request');
    expect(prompt).toContain('Do not make a no-op tool call merely to satisfy the selection');
    expect(prompt).not.toContain('make at least one relevant tool call to each selected server');
    expect(prompt).toContain('- HiMind (`himind`)');
  });

  it('keeps project MCP bindings available without treating them as native turn selections', () => {
    const prompt = renderSelectedMcpRunContextPrompt(
      { workspaceItems: [{ id: 'brief', kind: 'file', label: 'brief.md' }] },
      { contextMcpServers: [{ id: 'himind', label: 'HiMind' }] },
    );

    expect(prompt).toBe('');
  });

  it('renders only explicit turn MCP intent for native prompt mode', () => {
    const prompt = renderSelectedMcpRunContextPrompt(
      {
        mcpServerIds: ['himind'],
        workspaceItems: [{ id: 'brief', kind: 'file', label: 'brief.md' }],
      },
      { contextMcpServers: [{ id: 'himind', label: 'HiMind' }] },
    );

    expect(prompt).toContain('## Selected run context');
    expect(prompt).toContain('Use a selected server when it is relevant to the request');
    expect(prompt).toContain('Do not make a no-op tool call merely to satisfy the selection');
    expect(prompt).toContain('- HiMind (`himind`)');
    expect(prompt).not.toContain('Active workspace context');
  });

  it('reserves mandatory tool calls for required MCP servers', () => {
    const prompt = renderSelectedMcpRunContextPrompt(
      {
        mcpServerIds: ['optional'],
        requiredMcpServerIds: ['himind'],
      },
      {
        contextMcpServers: [
          { id: 'optional', label: 'Optional MCP' },
          { id: 'himind', label: 'HiMind' },
        ],
      },
    );

    expect(prompt).toContain('### Selected MCP servers');
    expect(prompt).toContain('### Required MCP servers');
    expect(prompt).toContain('make at least one relevant tool call to each required server');
    expect(prompt).toContain('- HiMind (`himind`)');
  });
});
