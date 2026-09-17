import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAiResearchMcpToken, fetchHiMindMcpToken } from '../src/http/hdw.js';
import { writeSsoConfigFile } from '../src/http/hik_logins/hicoo.js';
import {
  replaceManagedMcpServersWithBridges,
  resolveActiveManagedMcpBridges,
  resolveManagedMcpBridgeServerIds,
} from '../src/managed-mcp-bridges.js';

describe('managed MCP token issuance', () => {
  let dataDir: string | null = null;

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = null;
  });

  it('gets a short-lived HiMind token for the device-bound OA user', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-managed-mcp-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice',
      cookies: [{ name: 'oa_session', value: 'opaque-cookie', domain: 'oa.example' }],
      loginAt: Date.now(),
    });
    const post = vi.fn(async () => ({
      access_token: 'signed-user-jwt',
      token_type: 'Bearer',
      expires_in: 300,
    }));

    await expect(fetchHiMindMcpToken(dataDir, 'run-1', post)).resolves.toEqual({
      accessToken: 'signed-user-jwt',
      expiresIn: 300,
    });
    expect(post).toHaveBeenCalledWith(
      '/auth/himind/mcp-token',
      {
        username: 'alice',
        run_id: 'run-1',
        oa_cookies: [{ name: 'oa_session', value: 'opaque-cookie' }],
      },
    );
  });

  it('gets a short-lived AI research token from the ai-research endpoint', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-managed-mcp-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice',
      cookies: [{ name: 'oa_session', value: 'opaque-cookie', domain: 'oa.example' }],
      loginAt: Date.now(),
    });
    const post = vi.fn(async () => ({
      access_token: 'signed-research-jwt',
      token_type: 'Bearer',
      expires_in: 300,
    }));

    await expect(fetchAiResearchMcpToken(dataDir, 'run-1', post)).resolves.toEqual({
      accessToken: 'signed-research-jwt',
      expiresIn: 300,
    });
    expect(post).toHaveBeenCalledWith(
      '/auth/ai-research/mcp-token',
      {
        username: 'alice',
        run_id: 'run-1',
        oa_cookies: [{ name: 'oa_session', value: 'opaque-cookie' }],
      },
    );
  });

  it('does not request a token without a valid OA session', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-managed-mcp-'));
    const post = vi.fn();

    await expect(fetchHiMindMcpToken(dataDir, 'run-1', post)).resolves.toBeNull();
    await expect(fetchAiResearchMcpToken(dataDir, 'run-1', post)).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not misreport an upstream token rejection as a missing OA session', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-managed-mcp-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice',
      cookies: [{ name: 'oa_session', value: 'opaque-cookie', domain: 'oa.example' }],
      loginAt: Date.now(),
    });
    const post = vi.fn(async () => null);

    await expect(fetchAiResearchMcpToken(dataDir, 'run-1', post)).rejects.toThrow(
      /central HDW service/i,
    );
  });

  it('rejects a malformed central token response instead of treating it as logged out', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-managed-mcp-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice',
      cookies: [{ name: 'oa_session', value: 'opaque-cookie', domain: 'oa.example' }],
      loginAt: Date.now(),
    });
    const post = vi.fn(async () => ({
      access_token: '',
      token_type: 'Bearer',
      expires_in: 300,
    }));

    await expect(fetchHiMindMcpToken(dataDir, 'run-1', post)).rejects.toThrow(
      /token response.*invalid/i,
    );
  });
});

describe('managed MCP bridge substitution', () => {
  it('resolves only the enabled managed servers as active bridges', () => {
    const servers = [
      { id: 'himind', transport: 'http' as const, enabled: true, authMode: 'none' as const, url: 'https://himind.example/mcp' },
      { id: 'fde-research-reports', transport: 'http' as const, enabled: false, authMode: 'none' as const, url: 'https://drw.example/api/research-mcp' },
      { id: 'other', transport: 'http' as const, enabled: true, authMode: 'none' as const, url: 'https://other.example/mcp' },
    ];

    const active = resolveActiveManagedMcpBridges(servers, {});
    expect(active).toEqual([{ serverId: 'himind', cliArgs: ['mcp', 'himind'] }]);
  });

  it('recognizes every managed default server id', () => {
    const ids = resolveManagedMcpBridgeServerIds({});
    expect(ids.has('himind')).toBe(true);
    expect(ids.has('fde-research-reports')).toBe(true);
  });

  it('replaces only the active managed remote servers with stdio bridges', () => {
    const servers = [
      {
        id: 'himind',
        transport: 'http' as const,
        enabled: true,
        authMode: 'none' as const,
        url: 'https://himind.example/mcp',
        headers: { 'X-Trace': 'kept', Authorization: 'Bearer stale' },
      },
      {
        id: 'fde-research-reports',
        transport: 'http' as const,
        enabled: true,
        // Existing installations may still carry the old OAuth marker. The
        // managed bridge must win by id and replace that stale auth mode.
        authMode: 'oauth' as const,
        url: 'https://drw.example/api/research-mcp',
      },
      {
        id: 'other',
        transport: 'http' as const,
        enabled: true,
        authMode: 'none' as const,
        url: 'https://other.example/mcp',
      },
    ];

    const active = resolveActiveManagedMcpBridges(servers, {});
    const injected = replaceManagedMcpServersWithBridges(servers, active, {
      command: '/node',
      odBin: '/od',
    });

    expect(injected[0]).toEqual({
      id: 'himind',
      transport: 'stdio',
      enabled: true,
      authMode: 'none',
      command: '/node',
      args: ['/od', 'mcp', 'himind'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(injected[1]).toEqual({
      id: 'fde-research-reports',
      transport: 'stdio',
      enabled: true,
      authMode: 'none',
      command: '/node',
      args: ['/od', 'mcp', 'ai-research'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    // Non-managed servers pass through untouched.
    expect(injected[2]).toBe(servers[2]);
    expect(servers[0]?.headers?.Authorization).toBe('Bearer stale');
  });

  it('fails closed when a managed server is not remote HTTP', () => {
    const servers = [
      { id: 'himind', transport: 'stdio' as const, enabled: true, command: 'node' },
    ];
    const active = [{ serverId: 'himind', cliArgs: ['mcp', 'himind'] }];
    expect(() => replaceManagedMcpServersWithBridges(servers, active, {
      command: '/node',
      odBin: '/od',
    })).toThrow(/HTTP or SSE/i);
  });
});
