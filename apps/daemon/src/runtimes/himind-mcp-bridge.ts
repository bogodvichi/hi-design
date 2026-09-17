import {
  createMcpAuthenticatedFetch,
  createMcpTokenProvider,
  type FetchLike,
  MCP_BRIDGE_PROTOCOL_VERSION,
  runMcpBridge,
} from './mcp-bridge.js';

export const HIMIND_MCP_PROTOCOL_VERSION = MCP_BRIDGE_PROTOCOL_VERSION;
export const DEFAULT_HIMIND_MCP_PROXY_URL =
  'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web/hdw/api/mcp/himind';

// The daemon route that mints HiMind's short-lived RS256 JWT after validating
// the run's OA session.
const HIMIND_MCP_TOKEN_ENDPOINT = '/api/tools/himind/mcp-token';
const HIMIND_SERVICE_LABEL = 'HiMind';

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
  return createMcpTokenProvider({
    daemonUrl: options.daemonUrl,
    toolToken: options.toolToken,
    tokenEndpointPath: HIMIND_MCP_TOKEN_ENDPOINT,
    serviceLabel: HIMIND_SERVICE_LABEL,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.refreshSkewMs !== undefined ? { refreshSkewMs: options.refreshSkewMs } : {}),
  });
}

export function createHiMindAuthenticatedFetch(options: HiMindTokenProviderOptions): FetchLike {
  return createMcpAuthenticatedFetch({
    daemonUrl: options.daemonUrl,
    toolToken: options.toolToken,
    tokenEndpointPath: HIMIND_MCP_TOKEN_ENDPOINT,
    serviceLabel: HIMIND_SERVICE_LABEL,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.refreshSkewMs !== undefined ? { refreshSkewMs: options.refreshSkewMs } : {}),
  });
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
  const proxyUrl =
    options.proxyUrl
    ?? process.env.OD_HIMIND_MCP_PROXY_URL
    ?? DEFAULT_HIMIND_MCP_PROXY_URL;
  await runMcpBridge({
    upstreamUrl: proxyUrl,
    daemonUrl: options.daemonUrl ?? process.env.OD_DAEMON_URL ?? '',
    toolToken: options.toolToken ?? process.env.OD_TOOL_TOKEN ?? '',
    tokenEndpointPath: HIMIND_MCP_TOKEN_ENDPOINT,
    serviceLabel: HIMIND_SERVICE_LABEL,
    clientName: 'hidesign-himind-mcp-bridge',
    serverName: 'hidesign-himind-mcp',
    instructions: 'HiMind knowledge tools authenticated as the current HiDesign OA user.',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
