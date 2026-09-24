import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const token = process.env.BENCH_MCP_TOKEN || 'MCP-FIXTURE-UNSET';
const logPath = process.env.BENCH_MCP_LOG || '';

const server = new Server(
  { name: 'hidesign-benchmark-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'get_benchmark_spec',
    description: 'Return the deterministic benchmark fixture that must be used verbatim.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'get_benchmark_spec') {
    throw new Error('unknown tool');
  }
  if (logPath) {
    fs.appendFileSync(logPath, JSON.stringify({
      at: Date.now(),
      tool: request.params.name,
      token,
    }) + '\n');
  }
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        token,
        title: 'Benchmark MCP Dashboard',
        requirement: 'Include the token exactly once in the generated mcp-result.md file.',
      }),
    }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
await new Promise((resolve) => {
  const done = () => resolve(undefined);
  transport.onclose = done;
  process.stdin.once('end', done);
  process.stdin.once('close', done);
});
