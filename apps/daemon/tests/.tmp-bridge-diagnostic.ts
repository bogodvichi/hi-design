import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveDaemonCliPath } from '../src/daemon-paths.js';

const envName = 'OD_MCP_BRIDGE_BENCH_DIAG_123456789ABC';
const upstreamScript = new URL('./.tmp-benchmark-mcp.mjs', import.meta.url).pathname;
const payload = JSON.stringify({
  server: {
    id: 'benchmark-mcp',
    label: 'Benchmark MCP',
    transport: 'stdio',
    enabled: true,
    command: process.execPath,
    args: [upstreamScript],
    env: {
      BENCH_MCP_LOG: '/tmp/hidesign-bridge-mcp.log',
      BENCH_MCP_TOKEN: 'MCP-BRIDGE-55119',
    },
  },
});

const odBin = resolveDaemonCliPath();
console.log('OD_BIN', odBin);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [odBin, 'mcp', 'external-bridge', '--config-env', envName],
  env: {
    ...getDefaultEnvironment(),
    ELECTRON_RUN_AS_NODE: '1',
    [envName]: payload,
  },
  stderr: 'inherit',
});
const client = new Client({ name: 'bridge-diagnostic', version: '1.0.0' }, { capabilities: {} });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log('TOOLS', JSON.stringify(tools));
  const result = await client.callTool({ name: 'get_benchmark_spec', arguments: {} });
  console.log('RESULT', JSON.stringify(result));
} finally {
  await client.close().catch(() => {});
}
