import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read only the managed server names from a project's `.mcp.json`.
 *
 * Project files may contain arbitrary commands, headers, and credentials, so
 * this discovery path intentionally ignores every server value. A matching id
 * is only an activation hint for the daemon-owned `od mcp <name>` bridge; the
 * project-provided command or remote credentials never reach the child agent.
 */
export async function readProjectManagedMcpBridgeServerIds(
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Set<string>> {
  const managedIds = resolveManagedMcpBridgeServerIds(env);
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(projectDir, '.mcp.json'), 'utf8'),
    );
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return new Set();
    return new Set(
      Object.keys(parsed.mcpServers).filter((id) => managedIds.has(id)),
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT' || error instanceof SyntaxError) return new Set();
    throw error;
  }
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
  return resolveManagedMcpBridgesForServerIds(
    servers.filter((server) => server.enabled).map((server) => server.id),
    env,
  );
}

export function resolveManagedMcpBridgesForServerIds(
  serverIds: Iterable<string>,
  env: NodeJS.ProcessEnv = process.env,
): ActiveManagedMcpBridge[] {
  const requestedIds = new Set(serverIds);
  const active: ActiveManagedMcpBridge[] = [];
  for (const descriptor of MANAGED_MCP_BRIDGES) {
    const serverId = env[descriptor.serverIdEnvVar]?.trim() || descriptor.defaultServerId;
    if (requestedIds.has(serverId)) {
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
 * Resolve bridges for one run. Persisted enabled servers remain available as
 * before; project-local managed servers are added only when their id is in the
 * runtime MCP plan (project binding, explicit/required turn intent, mention, or
 * run-scoped bundle). The intersection prevents unrelated stale project files
 * from silently re-enabling capabilities outside the current runtime plan.
 */
export function resolveRunManagedMcpBridges(
  servers: McpServerConfig[],
  projectConfiguredIds: Iterable<string>,
  selectedServerIds: Iterable<string>,
  env: NodeJS.ProcessEnv = process.env,
): ActiveManagedMcpBridge[] {
  const activeIds = new Set(
    servers.filter((server) => server.enabled).map((server) => server.id),
  );
  const selectedIds = new Set(selectedServerIds);
  for (const id of projectConfiguredIds) {
    if (selectedIds.has(id)) activeIds.add(id);
  }
  return resolveManagedMcpBridgesForServerIds(activeIds, env);
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
