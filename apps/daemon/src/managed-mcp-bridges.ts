import type { McpServerConfig } from './mcp-config.js';

// Daemon-managed MCP bridges rewrite a user's remote MCP server entry into a
// local stdio subprocess (`od mcp <name>`) so the agent never receives the
// user's OA identity or the upstream bearer token — the bridge subprocess mints
// a short-lived JWT per call. Each descriptor names the default server id it
// backs (matching an `MCP_TEMPLATES` id), the env var that overrides that id,
// and the `od` CLI args that launch the bridge.
export interface ManagedMcpBridgeDescriptor {
  defaultServerId: string;
  serverIdEnvVar: string;
  cliArgs: readonly string[];
  env?: Readonly<Record<string, string>>;
}

export const MANAGED_MCP_BRIDGES: readonly ManagedMcpBridgeDescriptor[] = [
  {
    defaultServerId: 'himind',
    serverIdEnvVar: 'OD_HIMIND_MCP_SERVER_ID',
    cliArgs: ['mcp', 'himind'],
  },
  {
    defaultServerId: 'fde-research-reports',
    serverIdEnvVar: 'OD_AI_RESEARCH_MCP_SERVER_ID',
    cliArgs: ['mcp', 'ai-research'],
    // drw.hikvision.com chains to the corporate CA installed in the OS trust
    // store. Node does not consult that store by default, so the bridge must
    // opt in instead of disabling TLS verification or relying on a personal
    // NODE_EXTRA_CA_CERTS path.
    env: { NODE_USE_SYSTEM_CA: '1' },
  },
];

export interface ActiveManagedMcpBridge {
  serverId: string;
  cliArgs: string[];
  env?: Record<string, string>;
}

/**
 * The resolved (env-overridable) server id for every managed bridge. Used to
 * recognize which configured MCP server ids are daemon-managed regardless of
 * whether they are enabled in a given run.
 */
export function resolveManagedMcpBridgeServerIds(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  return new Set(
    MANAGED_MCP_BRIDGES.map(
      (descriptor) => env[descriptor.serverIdEnvVar]?.trim() || descriptor.defaultServerId,
    ),
  );
}

/**
 * Resolve which managed bridges are backing an enabled server in this run's MCP
 * config. Each entry carries the resolved (env-overridable) server id and the
 * `od` CLI args that launch its stdio bridge.
 */
export function resolveActiveManagedMcpBridges(
  servers: McpServerConfig[],
  env: NodeJS.ProcessEnv = process.env,
): ActiveManagedMcpBridge[] {
  const active: ActiveManagedMcpBridge[] = [];
  for (const descriptor of MANAGED_MCP_BRIDGES) {
    const serverId = env[descriptor.serverIdEnvVar]?.trim() || descriptor.defaultServerId;
    if (servers.some((server) => server.enabled && server.id === serverId)) {
      active.push({
        serverId,
        cliArgs: [...descriptor.cliArgs],
        ...(descriptor.env ? { env: { ...descriptor.env } } : {}),
      });
    }
  }
  return active;
}

/**
 * Rewrite every enabled managed remote server into its daemon-owned stdio
 * bridge. Non-managed servers and disabled entries pass through untouched.
 * Fails closed if a managed id is configured with a non-remote transport, since
 * the bridge only makes sense in front of an HTTP/SSE upstream.
 */
export function replaceManagedMcpServersWithBridges(
  servers: McpServerConfig[],
  bridges: ActiveManagedMcpBridge[],
  input: { command: string; odBin: string },
): McpServerConfig[] {
  const byServerId = new Map(bridges.map((bridge) => [bridge.serverId, bridge]));
  return servers.map((server) => {
    const bridge = byServerId.get(server.id);
    if (!server.enabled || !bridge) return server;
    if (server.transport !== 'http' && server.transport !== 'sse') {
      throw new Error(
        `Managed MCP bridge "${server.id}" requires an HTTP or SSE server`,
      );
    }
    return {
      id: server.id,
      ...(server.label ? { label: server.label } : {}),
      ...(server.templateId ? { templateId: server.templateId } : {}),
      transport: 'stdio',
      enabled: true,
      authMode: 'none',
      command: input.command,
      args: [input.odBin, ...bridge.cliArgs],
      env: { ELECTRON_RUN_AS_NODE: '1', ...bridge.env },
    };
  });
}
