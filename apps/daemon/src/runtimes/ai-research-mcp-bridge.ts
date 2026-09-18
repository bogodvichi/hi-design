import {
  type FetchLike,
  MCP_BRIDGE_PROTOCOL_VERSION,
  runMcpBridge,
} from './mcp-bridge.js';

export const AI_RESEARCH_MCP_PROTOCOL_VERSION = MCP_BRIDGE_PROTOCOL_VERSION;
// Unlike HiMind, the AI research workbench MCP is reached directly: the
// research service verifies the RS256 JWT itself, so there is no central HDW
// proxy in the path. The daemon still mints the JWT centrally (after OA
// validation) via the token endpoint below.
export const DEFAULT_AI_RESEARCH_MCP_URL = 'https://drw.hikvision.com/api/research-mcp';

const AI_RESEARCH_MCP_TOKEN_ENDPOINT = '/api/tools/ai-research/mcp-token';
const AI_RESEARCH_SERVICE_LABEL = 'AI research';

export interface RunAiResearchMcpBridgeOptions {
  upstreamUrl?: string | URL;
  daemonUrl?: string | URL;
  toolToken?: string;
  fetchImpl?: FetchLike;
}

export async function runAiResearchMcpBridge(
  options: RunAiResearchMcpBridgeOptions = {},
): Promise<void> {
  const upstreamUrl =
    options.upstreamUrl
    ?? process.env.OD_AI_RESEARCH_MCP_URL
    ?? DEFAULT_AI_RESEARCH_MCP_URL;
  await runMcpBridge({
    upstreamUrl,
    daemonUrl: options.daemonUrl ?? process.env.OD_DAEMON_URL ?? '',
    toolToken: options.toolToken ?? process.env.OD_TOOL_TOKEN ?? '',
    tokenEndpointPath: AI_RESEARCH_MCP_TOKEN_ENDPOINT,
    serviceLabel: AI_RESEARCH_SERVICE_LABEL,
    clientName: 'hidesign-ai-research-mcp-bridge',
    serverName: 'hidesign-ai-research-mcp',
    instructions:
      'AI research workbench report tools authenticated as the current HiDesign OA user.',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
