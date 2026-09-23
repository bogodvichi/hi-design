import { createHash } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  inferMcpAuthModeForUrl,
  sanitizeMcpServer,
  type McpServerConfig,
} from '../mcp-config.js';
import {
  createLazyMcpBridgeServer,
  type FetchLike,
} from './mcp-bridge.js';
import type { RuntimeContext } from './types.js';

interface ExternalMcpBridgePayload {
  server: McpServerConfig;
  oauthAccessToken?: string;
}

export interface CodexExternalMcpBridgeInjection {
  bridges: NonNullable<RuntimeContext['mcpBridges']>;
  env: Record<string, string>;
}

function bridgeConfigEnvName(serverId: string): string {
  const readable = serverId.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 32);
  const digest = createHash('sha256').update(serverId).digest('hex').slice(0, 12).toUpperCase();
  return `OD_MCP_BRIDGE_${readable}_${digest}`;
}

/**
 * Build one isolated stdio bridge per selected external MCP server. The full
 * server config (including credentials) travels in a per-server environment
 * variable inherited only by that bridge; no secret is written to Codex argv
 * or exposed to Codex shell tools.
 */
export function buildCodexExternalMcpBridgeInjection(options: {
  servers: McpServerConfig[];
  selectedServerIds: Iterable<string>;
  managedServerIds: Iterable<string>;
  oauthTokens?: Record<string, string>;
  command: string;
  odBin: string;
}): CodexExternalMcpBridgeInjection {
  const selectedIds = new Set(options.selectedServerIds);
  const managedIds = new Set(options.managedServerIds);
  const bridges: NonNullable<RuntimeContext['mcpBridges']> = [];
  const env: Record<string, string> = {};

  for (const server of options.servers) {
    if (!server.enabled || !selectedIds.has(server.id) || managedIds.has(server.id)) continue;
    const envName = bridgeConfigEnvName(server.id);
    const payload: ExternalMcpBridgePayload = {
      server,
      ...(options.oauthTokens?.[server.id]
        ? { oauthAccessToken: options.oauthTokens[server.id] }
        : {}),
    };
    env[envName] = JSON.stringify(payload);
    bridges.push({
      id: server.id,
      command: options.command,
      args: [options.odBin, 'mcp', 'external-bridge', '--config-env', envName],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      envVars: [envName],
    });
  }

  return { bridges, env };
}

export function resolveMentionedMcpServerIds(
  text: string,
  availableServerIds: Iterable<string>,
): Set<string> {
  const available = new Set(availableServerIds);
  const mentioned = new Set<string>();
  for (const match of text.matchAll(/@([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
    const id = match[1];
    if (!id || !available.has(id)) continue;
    const previous = match.index > 0 ? text[match.index - 1] : '';
    if (previous && /[A-Za-z0-9._-]/.test(previous)) continue;
    mentioned.add(id);
  }
  return mentioned;
}

export function parseExternalMcpBridgePayload(raw: string): ExternalMcpBridgePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('external MCP bridge config is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('external MCP bridge config must be an object');
  }
  const record = parsed as Record<string, unknown>;
  const server = sanitizeMcpServer(record.server);
  if (!server || !server.enabled) {
    throw new Error('external MCP bridge server config is invalid or disabled');
  }
  const oauthAccessToken = typeof record.oauthAccessToken === 'string'
    ? record.oauthAccessToken.trim()
    : '';
  return {
    server,
    ...(oauthAccessToken ? { oauthAccessToken } : {}),
  };
}

function configuredHeaders(payload: ExternalMcpBridgePayload): Headers {
  const headers = new Headers(payload.server.headers);
  const hasAuthorization = Array.from(headers.keys())
    .some((name) => name.toLowerCase() === 'authorization');
  const authMode = payload.server.authMode
    ?? inferMcpAuthModeForUrl(payload.server.url);
  if (!hasAuthorization && authMode === 'oauth' && payload.oauthAccessToken) {
    headers.set('authorization', `Bearer ${payload.oauthAccessToken}`);
  }
  return headers;
}

function createConfiguredFetch(
  headers: Headers,
  fetchImpl: FetchLike = fetch,
): FetchLike {
  return async (url, init) => {
    const merged = new Headers(init?.headers);
    headers.forEach((value, name) => merged.set(name, value));
    return await fetchImpl(url, { ...init, headers: merged });
  };
}

export async function runExternalMcpBridge(
  rawConfig: string,
  options: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  const payload = parseExternalMcpBridgePayload(rawConfig);
  const { server } = payload;
  const lazyBridge = createLazyMcpBridgeServer({
    serverName: `hidesign-external-${server.id}`,
    instructions: `Run-scoped bridge for the selected ${server.label ?? server.id} MCP server.`,
    connectUpstream: async () => {
      const upstream = new Client(
        { name: `hidesign-external-${server.id}-client`, version: '1.0.0' },
        { capabilities: {} },
      );
      let transport: Transport;
      if (server.transport === 'stdio') {
        transport = new StdioClientTransport({
          command: server.command ?? '',
          args: server.args ?? [],
          env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
          stderr: 'inherit',
        });
      } else {
        const url = new URL(server.url ?? '');
        const configuredFetch = createConfiguredFetch(
          configuredHeaders(payload),
          options.fetchImpl,
        );
        // SDK 1.29's exact-optional declarations disagree on `sessionId`
        // between its concrete HTTP transport and the shared Transport type;
        // the runtime protocol shape is compatible.
        transport = (
          server.transport === 'sse'
            ? new SSEClientTransport(url, { fetch: configuredFetch })
            : new StreamableHTTPClientTransport(url, { fetch: configuredFetch })
        ) as unknown as Transport;
      }
      try {
        await upstream.connect(transport);
        if (!upstream.getServerCapabilities()?.tools) {
          throw new Error(`${server.label ?? server.id} MCP did not advertise tool support`);
        }
        return upstream;
      } catch (error) {
        await upstream.close().catch(() => {});
        throw error;
      }
    },
  });

  const stdio = new StdioServerTransport();
  try {
    await lazyBridge.server.connect(stdio);
    await new Promise<void>((resolve, reject) => {
      const close = () => resolve();
      stdio.onclose = close;
      stdio.onerror = reject;
      process.stdin.once('end', close);
      process.stdin.once('close', close);
    });
  } finally {
    await Promise.allSettled([
      lazyBridge.server.close(),
      lazyBridge.closeUpstream(),
    ]);
  }
}
