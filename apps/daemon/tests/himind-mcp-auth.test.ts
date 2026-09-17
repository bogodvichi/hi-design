import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchHiMindMcpToken } from '../src/http/hdw.js';
import { writeSsoConfigFile } from '../src/http/hik_logins/hicoo.js';
import { replaceHiMindMcpWithBridge } from '../src/himind-mcp-auth.js';

describe('HiMind MCP authorization', () => {
  let dataDir: string | null = null;

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = null;
  });

  it('gets a short-lived token for the device-bound OA user', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-himind-mcp-auth-'));
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

  it('does not request a token without a valid OA session', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-himind-mcp-auth-'));
    const post = vi.fn();

    await expect(fetchHiMindMcpToken(dataDir, 'run-1', post)).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not misreport an upstream token rejection as a missing OA session', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-himind-mcp-auth-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice',
      cookies: [{ name: 'oa_session', value: 'opaque-cookie', domain: 'oa.example' }],
      loginAt: Date.now(),
    });
    const post = vi.fn(async () => null);

    await expect(fetchHiMindMcpToken(dataDir, 'run-1', post)).rejects.toThrow(
      /central HDW service/i,
    );
  });

  it('rejects a malformed central token response instead of treating it as logged out', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-himind-mcp-auth-'));
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

  it('replaces only the configured HiMind remote server with a stdio bridge', () => {
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
        id: 'other',
        transport: 'http' as const,
        enabled: true,
        authMode: 'none' as const,
        url: 'https://other.example/mcp',
      },
    ];

    const injected = replaceHiMindMcpWithBridge(servers, {
      serverId: 'himind',
      command: '/node',
      args: ['/od', 'mcp', 'himind'],
    });

    expect(injected).toEqual([
      {
        id: 'himind',
        transport: 'stdio',
        enabled: true,
        authMode: 'none',
        command: '/node',
        args: ['/od', 'mcp', 'himind'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
      servers[1],
    ]);
    expect(servers[0]?.headers?.Authorization).toBe('Bearer stale');
  });

  it('fails closed when the configured server is not remote HTTP', () => {
    expect(() => replaceHiMindMcpWithBridge([
      {
        id: 'himind',
        transport: 'stdio',
        enabled: true,
        command: 'node',
      },
    ], {
      serverId: 'himind',
      command: '/node',
      args: ['/od', 'mcp', 'himind'],
    })).toThrow(/HTTP or SSE/i);
  });
});
