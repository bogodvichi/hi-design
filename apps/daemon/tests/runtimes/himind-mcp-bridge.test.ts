import { describe, expect, it, vi } from 'vitest';

import {
  createHiMindAuthenticatedFetch,
  createHiMindTokenProvider,
  HIMIND_MCP_PROTOCOL_VERSION,
} from '../../src/runtimes/himind-mcp-bridge.js';

describe('HiMind MCP bridge authentication', () => {
  it('pins the supported upstream protocol to 2025-11-25', () => {
    expect(HIMIND_MCP_PROTOCOL_VERSION).toBe('2025-11-25');
  });

  it('caches a token and renews it before expiration', async () => {
    let now = 1_000;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      accessToken: `token-${now}`,
      expiresIn: 60,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = createHiMindTokenProvider({
      daemonUrl: 'http://127.0.0.1:7788/',
      toolToken: 'run-proof',
      fetchImpl,
      now: () => now,
      refreshSkewMs: 10_000,
    });

    await expect(provider.getAccessToken()).resolves.toBe('token-1000');
    now = 40_000;
    await expect(provider.getAccessToken()).resolves.toBe('token-1000');
    now = 51_001;
    await expect(provider.getAccessToken()).resolves.toBe('token-51001');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:7788/api/tools/himind/mcp-token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer run-proof' }),
      }),
    );
  });

  it('surfaces the daemon token error instead of hiding it behind an HTTP status', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'HIMIND_TOKEN_ISSUE_FAILED',
        message: 'central HiMind MCP authorization is not configured',
      },
    }), { status: 502, headers: { 'content-type': 'application/json' } }));
    const provider = createHiMindTokenProvider({
      daemonUrl: 'http://127.0.0.1:7788',
      toolToken: 'run-proof',
      fetchImpl,
    });

    await expect(provider.getAccessToken()).rejects.toThrow(
      'HIMIND_TOKEN_ISSUE_FAILED: central HiMind MCP authorization is not configured',
    );
  });

  it('reissues once and retries an upstream request after 401', async () => {
    let tokenCalls = 0;
    const upstreamAuth: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/api/tools/himind/mcp-token')) {
        tokenCalls += 1;
        return new Response(JSON.stringify({
          accessToken: `jwt-${tokenCalls}`,
          expiresIn: 300,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      upstreamAuth.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response('', { status: upstreamAuth.length === 1 ? 401 : 200 });
    });
    const authenticatedFetch = createHiMindAuthenticatedFetch({
      daemonUrl: 'http://127.0.0.1:7788',
      toolToken: 'run-proof',
      fetchImpl,
    });

    const response = await authenticatedFetch('https://proxy.example/mcp', {
      method: 'POST',
      body: '{"jsonrpc":"2.0"}',
    });

    expect(response.status).toBe(200);
    expect(tokenCalls).toBe(2);
    expect(upstreamAuth).toEqual(['Bearer jwt-1', 'Bearer jwt-2']);
  });
});
