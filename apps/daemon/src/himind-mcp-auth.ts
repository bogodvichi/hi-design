import type { McpServerConfig } from './mcp-config.js';

export const DEFAULT_HIMIND_MCP_SERVER_ID = 'himind';

export function resolveHiMindMcpServerId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.OD_HIMIND_MCP_SERVER_ID?.trim() || DEFAULT_HIMIND_MCP_SERVER_ID;
}

export function hasEnabledHiMindMcpServer(
  servers: McpServerConfig[],
  serverId: string,
): boolean {
  return servers.some((server) => server.enabled && server.id === serverId);
}

export function replaceHiMindMcpWithBridge(
  servers: McpServerConfig[],
  input: { serverId: string; command: string; args: string[] },
): McpServerConfig[] {
  return servers.map((server) => {
    if (!server.enabled || server.id !== input.serverId) return server;
    if (server.transport !== 'http' && server.transport !== 'sse') {
      throw new Error('HiMind MCP bridge requires an HTTP or SSE server');
    }
    return {
      id: server.id,
      ...(server.label ? { label: server.label } : {}),
      ...(server.templateId ? { templateId: server.templateId } : {}),
      transport: 'stdio',
      enabled: true,
      authMode: 'none',
      command: input.command,
      args: [...input.args],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  });
}
