import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export const HIMIND_MCP_PROTOCOL_VERSION = '2025-11-25';
export const DEFAULT_HIMIND_MCP_PROXY_URL =
  'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web/hdw/api/mcp/himind';

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

type HiMindTokenResponse = {
  accessToken?: unknown;
  expiresIn?: unknown;
};

type HiMindTokenErrorResponse = {
  error?: {
    code?: unknown;
    message?: unknown;
  };
};

export interface HiMindTokenProviderOptions {
  daemonUrl: string | URL;
  toolToken: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  refreshSkewMs?: number;
}

export function createHiMindTokenProvider(options: HiMindTokenProviderOptions): {
  getAccessToken(forceRefresh?: boolean): Promise<string>;
} {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const refreshSkewMs = options.refreshSkewMs ?? 30_000;
  const daemonUrl = String(options.daemonUrl).replace(/\/$/, '');
  const toolToken = options.toolToken.trim();
  if (!daemonUrl) throw new Error('OD_DAEMON_URL is required for HiMind MCP');
  if (!toolToken) throw new Error('OD_TOOL_TOKEN is required for HiMind MCP');

  let cached: { accessToken: string; refreshAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  const issue = async (): Promise<string> => {
    const response = await fetchImpl(`${daemonUrl}/api/tools/himind/mcp-token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${toolToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as HiMindTokenErrorResponse | null;
      const code = typeof errorBody?.error?.code === 'string'
        ? errorBody.error.code.trim()
        : '';
      const message = typeof errorBody?.error?.message === 'string'
        ? errorBody.error.message.trim().slice(0, 240)
        : '';
      const detail = [code, message].filter(Boolean).join(': ');
      throw new Error(
        `HiMind MCP token request failed (${response.status})${detail ? `: ${detail}` : ''}`,
      );
    }
    const body = await response.json() as HiMindTokenResponse;
    const accessToken = typeof body.accessToken === 'string'
      ? body.accessToken.trim()
      : '';
    const expiresIn = Number(body.expiresIn);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('HiMind MCP token response is invalid');
    }
    cached = {
      accessToken,
      refreshAt: now() + Math.max(0, expiresIn * 1000 - refreshSkewMs),
    };
    return accessToken;
  };

  return {
    async getAccessToken(forceRefresh = false) {
      if (!forceRefresh && cached && now() < cached.refreshAt) {
        return cached.accessToken;
      }
      if (!inFlight) {
        inFlight = issue().finally(() => {
          inFlight = null;
        });
      }
      return await inFlight;
    },
  };
}

export function createHiMindAuthenticatedFetch(options: HiMindTokenProviderOptions): FetchLike {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenProvider = createHiMindTokenProvider(options);

  const invoke = async (
    url: string | URL,
    init: RequestInit | undefined,
    forceRefresh: boolean,
  ): Promise<Response> => {
    const accessToken = await tokenProvider.getAccessToken(forceRefresh);
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${accessToken}`);
    return await fetchImpl(url, { ...init, headers });
  };

  return async (url, init) => {
    const first = await invoke(url, init, false);
    if (first.status !== 401) return first;
    await first.body?.cancel().catch(() => {});
    return await invoke(url, init, true);
  };
}

export interface RunHiMindMcpBridgeOptions {
  proxyUrl?: string | URL;
  daemonUrl?: string | URL;
  toolToken?: string;
  fetchImpl?: FetchLike;
}

export async function runHiMindMcpBridge(
  options: RunHiMindMcpBridgeOptions = {},
): Promise<void> {
  const proxyUrl = new URL(
    options.proxyUrl
      ?? process.env.OD_HIMIND_MCP_PROXY_URL
      ?? DEFAULT_HIMIND_MCP_PROXY_URL,
  );
  const daemonUrl = options.daemonUrl ?? process.env.OD_DAEMON_URL ?? '';
  const toolToken = options.toolToken ?? process.env.OD_TOOL_TOKEN ?? '';
  const authenticatedFetch = createHiMindAuthenticatedFetch({
    daemonUrl,
    toolToken,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const upstream = new Client(
    { name: 'hidesign-himind-mcp-bridge', version: '1.0.0' },
    { capabilities: {} },
  );
  const upstreamTransport = new StreamableHTTPClientTransport(proxyUrl, {
    fetch: authenticatedFetch,
  });
  // SDK 1.29's exact-optional declarations disagree on `sessionId` between
  // its concrete transport and shared Transport interface; runtime shapes
  // are compatible.
  await upstream.connect(upstreamTransport as unknown as Transport);

  if (upstreamTransport.protocolVersion !== HIMIND_MCP_PROTOCOL_VERSION) {
    await upstream.close();
    throw new Error(
      `HiMind MCP negotiated ${upstreamTransport.protocolVersion ?? 'no protocol version'}; `
      + `${HIMIND_MCP_PROTOCOL_VERSION} is required`,
    );
  }
  if (!upstream.getServerCapabilities()?.tools) {
    await upstream.close();
    throw new Error('HiMind MCP did not advertise tool support');
  }

  const bridge = new Server(
    { name: 'hidesign-himind-mcp', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: 'HiMind knowledge tools authenticated as the current HiDesign OA user.',
    },
  );
  bridge.setRequestHandler(ListToolsRequestSchema, async request => {
    return await upstream.listTools(request.params);
  });
  bridge.setRequestHandler(CallToolRequestSchema, async request => {
    return await upstream.callTool(request.params);
  });

  const stdio = new StdioServerTransport();
  try {
    await bridge.connect(stdio);
    await new Promise<void>(resolve => {
      const sdkOnClose = stdio.onclose;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      stdio.onclose = () => {
        sdkOnClose?.();
        done();
      };
      const closeForStdin = () => {
        void stdio.close().catch(() => done());
      };
      process.stdin.once('end', closeForStdin);
      process.stdin.once('close', closeForStdin);
    });
  } finally {
    await Promise.allSettled([bridge.close(), upstream.close()]);
  }
}
