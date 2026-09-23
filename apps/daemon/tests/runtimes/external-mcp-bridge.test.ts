import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCodexExternalMcpBridgeInjection,
  parseExternalMcpBridgePayload,
  readProjectMcpServerConfigs,
  resolveMentionedMcpServerIds,
} from '../../src/runtimes/external-mcp-bridge.js';

describe('Codex external MCP run bridge', () => {
  it('isolates selected stdio and HTTP configs in per-server environment variables', () => {
    const result = buildCodexExternalMcpBridgeInjection({
      servers: [
        {
          id: 'local-docs',
          transport: 'stdio',
          enabled: true,
          command: 'node',
          args: ['server.js'],
          env: { LOCAL_DOCS_TOKEN: 'stdio-secret' },
        },
        {
          id: 'remote-docs',
          transport: 'http',
          enabled: true,
          authMode: 'oauth',
          url: 'https://example.test/mcp',
          headers: { 'X-Tenant': 'alpha' },
        },
        {
          id: 'not-selected',
          transport: 'stdio',
          enabled: true,
          command: 'ignored',
        },
        {
          id: 'himind',
          transport: 'http',
          enabled: true,
          url: 'https://example.test/himind',
        },
      ],
      selectedServerIds: ['local-docs', 'remote-docs', 'himind'],
      managedServerIds: ['himind'],
      oauthTokens: { 'remote-docs': 'oauth-secret' },
      command: '/node',
      odBin: '/od',
    });

    expect(result.bridges.map((bridge) => bridge.id)).toEqual([
      'local-docs',
      'remote-docs',
    ]);
    const serializedArgs = JSON.stringify(result.bridges);
    expect(serializedArgs).not.toContain('stdio-secret');
    expect(serializedArgs).not.toContain('oauth-secret');

    for (const bridge of result.bridges) {
      expect(bridge.command).toBe('/node');
      expect(bridge.args.slice(0, 3)).toEqual(['/od', 'mcp', 'external-bridge']);
      expect(bridge.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
      expect(bridge.envVars).toHaveLength(1);
      const envName = bridge.envVars?.[0] ?? '';
      expect(bridge.args).toContain(envName);
      expect(result.env[envName]).toBeTruthy();
    }

    const payloads = Object.values(result.env).map(parseExternalMcpBridgePayload);
    expect(payloads.find((payload) => payload.server.id === 'local-docs'))
      .toMatchObject({ server: { env: { LOCAL_DOCS_TOKEN: 'stdio-secret' } } });
    expect(payloads.find((payload) => payload.server.id === 'remote-docs'))
      .toMatchObject({ oauthAccessToken: 'oauth-secret' });
  });

  it('recognizes any configured MCP id while ignoring email domains and unknown ids', () => {
    expect(resolveMentionedMcpServerIds(
      '@local-docs compare @remote-docs and @missing',
      ['local-docs', 'remote-docs'],
    )).toEqual(new Set(['local-docs', 'remote-docs']));
    expect(resolveMentionedMcpServerIds(
      'mail user@local-docs before searching',
      ['local-docs'],
    )).toEqual(new Set());
  });

  it('reads standard project .mcp.json entries without executing them', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'od-external-mcp-'));
    try {
      await writeFile(path.join(projectDir, '.mcp.json'), JSON.stringify({
        mcpServers: {
          local: {
            command: 'node',
            args: ['server.js'],
            env: { TOKEN: 'secret' },
          },
          remote: {
            type: 'sse',
            url: 'https://example.test/sse',
            headers: { 'X-Tenant': 'alpha' },
          },
          disabled: {
            command: 'ignored',
            disabled: true,
          },
        },
      }));

      await expect(readProjectMcpServerConfigs(projectDir)).resolves.toEqual([
        expect.objectContaining({
          id: 'local',
          transport: 'stdio',
          enabled: true,
          command: 'node',
          args: ['server.js'],
          env: { TOKEN: 'secret' },
        }),
        expect.objectContaining({
          id: 'remote',
          transport: 'sse',
          enabled: true,
          url: 'https://example.test/sse',
          headers: { 'X-Tenant': 'alpha' },
        }),
        expect.objectContaining({
          id: 'disabled',
          transport: 'stdio',
          enabled: false,
        }),
      ]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed or disabled bridge payloads', () => {
    expect(() => parseExternalMcpBridgePayload('{bad')).toThrow(/valid JSON/);
    expect(() => parseExternalMcpBridgePayload(JSON.stringify({
      server: {
        id: 'disabled',
        transport: 'stdio',
        enabled: false,
        command: 'node',
      },
    }))).toThrow(/invalid or disabled/);
  });
});
