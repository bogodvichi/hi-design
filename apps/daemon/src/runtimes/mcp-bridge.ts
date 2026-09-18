import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Shared upstream protocol version for every daemon-owned MCP bridge. HiMind
// and the AI research workbench both pin the same negotiated version; a single
// constant keeps them from drifting apart.
export const MCP_BRIDGE_PROTOCOL_VERSION = '2025-11-25';

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

type McpTokenResponse = {
  accessToken?: unknown;
  expiresIn?: unknown;
};

type McpTokenErrorResponse = {
  error?: {
    code?: unknown;
    message?: unknown;
  };
};

export interface McpTokenProviderOptions {
  daemonUrl: string | URL;
  toolToken: string;
  // The daemon route that mints the short-lived upstream access token, e.g.
  // `/api/tools/himind/mcp-token`. Distinct per service so a token minted for
  // one MCP audience cannot be replayed against another.
  tokenEndpointPath: string;
  // Human label used only in error messages ("HiMind", "AI research").
  serviceLabel: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  refreshSkewMs?: number;
}

export function createMcpTokenProvider(options: McpTokenProviderOptions): {
  getAccessToken(forceRefresh?: boolean): Promise<string>;
} {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const refreshSkewMs = options.refreshSkewMs ?? 30_000;
  const daemonUrl = String(options.daemonUrl).replace(/\/$/, '');
  const toolToken = options.toolToken.trim();
  const label = options.serviceLabel;
  const tokenEndpointPath = options.tokenEndpointPath;
  if (!daemonUrl) throw new Error(`OD_DAEMON_URL is required for ${label} MCP`);
  if (!toolToken) throw new Error(`OD_TOOL_TOKEN is required for ${label} MCP`);

  let cached: { accessToken: string; refreshAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  const issue = async (): Promise<string> => {
    const response = await fetchImpl(`${daemonUrl}${tokenEndpointPath}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${toolToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as McpTokenErrorResponse | null;
      const code = typeof errorBody?.error?.code === 'string'
        ? errorBody.error.code.trim()
        : '';
      const message = typeof errorBody?.error?.message === 'string'
        ? errorBody.error.message.trim().slice(0, 240)
        : '';
      const detail = [code, message].filter(Boolean).join(': ');
      throw new Error(
        `${label} MCP token request failed (${response.status})${detail ? `: ${detail}` : ''}`,
      );
    }
    const body = await response.json() as McpTokenResponse;
    const accessToken = typeof body.accessToken === 'string'
      ? body.accessToken.trim()
      : '';
    const expiresIn = Number(body.expiresIn);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error(`${label} MCP token response is invalid`);
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

export function createMcpAuthenticatedFetch(options: McpTokenProviderOptions): FetchLike {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenProvider = createMcpTokenProvider(options);

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

export interface RunMcpBridgeOptions {
  // Upstream MCP endpoint the bridge connects to. For HiMind this is the
  // central HDW HTTPS proxy; for the AI research workbench it is the research
  // MCP endpoint directly (it verifies the JWT itself).
  upstreamUrl: string | URL;
  daemonUrl: string | URL;
  toolToken: string;
  tokenEndpointPath: string;
  serviceLabel: string;
  // Names/instructions the bridge advertises to the agent-facing MCP client.
  clientName: string;
  serverName: string;
  instructions: string;
  fetchImpl?: FetchLike;
}

export async function runMcpBridge(options: RunMcpBridgeOptions): Promise<void> {
  const upstreamUrl = new URL(String(options.upstreamUrl));
  const label = options.serviceLabel;
  const authenticatedFetch = createMcpAuthenticatedFetch({
    daemonUrl: options.daemonUrl,
    toolToken: options.toolToken,
    tokenEndpointPath: options.tokenEndpointPath,
    serviceLabel: label,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const upstream = new Client(
    { name: options.clientName, version: '1.0.0' },
    { capabilities: {} },
  );
  const upstreamTransport = new StreamableHTTPClientTransport(upstreamUrl, {
    fetch: authenticatedFetch,
  });
  // SDK 1.29's exact-optional declarations disagree on `sessionId` between
  // its concrete transport and shared Transport interface; runtime shapes
  // are compatible.
  await upstream.connect(upstreamTransport as unknown as Transport);

  if (upstreamTransport.protocolVersion !== MCP_BRIDGE_PROTOCOL_VERSION) {
    await upstream.close();
    throw new Error(
      `${label} MCP negotiated ${upstreamTransport.protocolVersion ?? 'no protocol version'}; `
      + `${MCP_BRIDGE_PROTOCOL_VERSION} is required`,
    );
  }
  if (!upstream.getServerCapabilities()?.tools) {
    await upstream.close();
    throw new Error(`${label} MCP did not advertise tool support`);
  }

  const bridge = new Server(
    { name: options.serverName, version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: options.instructions,
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
